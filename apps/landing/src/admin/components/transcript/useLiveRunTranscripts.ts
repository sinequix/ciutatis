import { useEffect, useMemo, useRef, useState } from "react";
import type { LiveEvent } from "@paperclipai/shared";
import { heartbeatsApi, type LiveRunForIssue } from "../../api/heartbeats";
import { buildTranscript, getUIAdapter, type RunLogChunk, type TranscriptEntry } from "../../adapters";

const LOG_POLL_INTERVAL_MS = 2000;
const LOG_READ_LIMIT_BYTES = 256_000;

interface UseLiveRunTranscriptsOptions {
  runs: LiveRunForIssue[];
  companyId?: string | null;
  maxChunksPerRun?: number;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function isTerminalStatus(status: string): boolean {
  return status === "failed" || status === "timed_out" || status === "cancelled" || status === "interrupted" || status === "succeeded";
}

function parsePersistedLogContent(
  runId: string,
  content: string,
  pendingByRun: Map<string, string>,
): Array<RunLogChunk & { dedupeKey: string }> {
  if (!content) return [];

  const pendingKey = `${runId}:records`;
  const combined = `${pendingByRun.get(pendingKey) ?? ""}${content}`;
  const split = combined.split("\n");
  pendingByRun.set(pendingKey, split.pop() ?? "");

  const parsed: Array<RunLogChunk & { dedupeKey: string }> = [];
  for (const line of split) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const raw = JSON.parse(trimmed) as { ts?: unknown; stream?: unknown; chunk?: unknown; seq?: unknown };
      const stream = raw.stream === "stderr" || raw.stream === "system" ? raw.stream : "stdout";
      const chunk = typeof raw.chunk === "string" ? raw.chunk : "";
      const ts = typeof raw.ts === "string" ? raw.ts : new Date().toISOString();
      if (!chunk) continue;
      parsed.push({
        ts,
        stream,
        chunk,
        seq: readChunkSeq(raw.seq),
        dedupeKey: `log:${runId}:${ts}:${stream}:${chunk}`,
      });
    } catch {
      // Ignore malformed log rows.
    }
  }

  return parsed;
}

export function useLiveRunTranscripts({
  runs,
  companyId,
  maxChunksPerRun = 200,
}: UseLiveRunTranscriptsOptions) {
  const [chunksByRun, setChunksByRun] = useState<Map<string, RunLogChunk[]>>(new Map());
  const seenChunkKeysRef = useRef(new Set<string>());
  // Highest sequenced chunk trimmed out of a run's retained window; older
  // records re-delivered by the other transport are dropped instead of being
  // re-inserted ahead of newer output.
  const trimmedSeqFloorByRunRef = useRef(new Map<string, number>());
  const pendingLogRowsByRunRef = useRef(new Map<string, string>());
  const logOffsetByRunRef = useRef(new Map<string, number>());

  const runById = useMemo(() => new Map(runs.map((run) => [run.id, run])), [runs]);
  const activeRunIds = useMemo(
    () => new Set(runs.filter((run) => !isTerminalStatus(run.status)).map((run) => run.id)),
    [runs],
  );
  const runIdsKey = useMemo(
    () => runs.map((run) => run.id).sort((a, b) => a.localeCompare(b)).join(","),
    [runs],
  );

  const appendChunks = (runId: string, chunks: Array<RunLogChunk & { dedupeKey: string }>) => {
    if (chunks.length === 0) return;
    setChunksByRun((prev) => {
      const next = new Map(prev);
      const existing = [...(next.get(runId) ?? [])];
      let changed = false;

      for (const chunk of chunks) {
        // Sequenced log chunks (persisted rows and websocket log payloads)
        // dedupe and order by the server-assigned monotonic seq. Identical
        // token deltas from ACP-style adapters often share the same
        // millisecond ts and chunk text, so content-based keys drop real
        // output; seq keeps every record and restores emit order when the
        // websocket and the poller interleave.
        if (typeof chunk.seq === "number") {
          const seqFloor = trimmedSeqFloorByRunRef.current.get(runId) ?? 0;
          if (chunk.seq <= seqFloor) continue;
          const duplicateAt = existing.findIndex((item) => item.seq === chunk.seq);
          if (duplicateAt !== -1) {
            // Same record arrived via the other delivery path. Prefer the
            // longer payload: websocket chunks may be tail-truncated while
            // the persisted row is complete.
            if (chunk.chunk.length > existing[duplicateAt]!.chunk.length) {
              existing[duplicateAt] = { ts: chunk.ts, stream: chunk.stream, chunk: chunk.chunk, seq: chunk.seq };
              changed = true;
            }
            continue;
          }
          // Insert in seq order relative to the trailing sequenced chunks so
          // late-arriving records from the slower delivery path land where
          // they were emitted. Unsequenced chunks act as an ordering barrier.
          let insertAt = existing.length;
          while (insertAt > 0) {
            const prior = existing[insertAt - 1]!;
            if (typeof prior.seq !== "number" || prior.seq < chunk.seq) break;
            insertAt -= 1;
          }
          existing.splice(insertAt, 0, { ts: chunk.ts, stream: chunk.stream, chunk: chunk.chunk, seq: chunk.seq });
          changed = true;
          continue;
        }

        if (!isStructuredStreamingTextDelta(chunk.chunk)) {
          if (seenChunkKeysRef.current.has(chunk.dedupeKey)) continue;
          seenChunkKeysRef.current.add(chunk.dedupeKey);
        }
        existing.push({ ts: chunk.ts, stream: chunk.stream, chunk: chunk.chunk });
        changed = true;
      }

      if (!changed) return prev;
      if (seenChunkKeysRef.current.size > 12000) {
        seenChunkKeysRef.current.clear();
      }
      if (existing.length > maxChunksPerRun) {
        const trimmed = existing.splice(0, existing.length - maxChunksPerRun);
        let seqFloor = trimmedSeqFloorByRunRef.current.get(runId) ?? 0;
        for (const item of trimmed) {
          if (typeof item.seq === "number" && item.seq > seqFloor) seqFloor = item.seq;
        }
        if (seqFloor > 0) trimmedSeqFloorByRunRef.current.set(runId, seqFloor);
      }
      next.set(runId, existing);
      return next;
    });
  };

  useEffect(() => {
    const knownRunIds = new Set(runs.map((run) => run.id));
    setChunksByRun((prev) => {
      const next = new Map<string, RunLogChunk[]>();
      for (const [runId, chunks] of prev) {
        if (knownRunIds.has(runId)) {
          next.set(runId, chunks);
        }
      }
      return next.size === prev.size ? prev : next;
    });

    for (const key of pendingLogRowsByRunRef.current.keys()) {
      const runId = key.replace(/:records$/, "");
      if (!knownRunIds.has(runId)) {
        pendingLogRowsByRunRef.current.delete(key);
      }
    }
    for (const runId of logOffsetByRunRef.current.keys()) {
      if (!knownRunIds.has(runId)) {
        logOffsetByRunRef.current.delete(runId);
      }
    }
  }, [runs]);

  useEffect(() => {
    if (runs.length === 0) return;

    let cancelled = false;

    const readRunLog = async (run: LiveRunForIssue) => {
      const offset = logOffsetByRunRef.current.get(run.id) ?? 0;
      try {
        const result = await heartbeatsApi.log(run.id, offset, LOG_READ_LIMIT_BYTES);
        if (cancelled) return;

        appendChunks(run.id, parsePersistedLogContent(run.id, result.content, pendingLogRowsByRunRef.current));

        if (result.nextOffset !== undefined) {
          logOffsetByRunRef.current.set(run.id, result.nextOffset);
          return;
        }
        if (result.content.length > 0) {
          logOffsetByRunRef.current.set(run.id, offset + result.content.length);
        }
      } catch {
        // Ignore log read errors while output is initializing.
      }
    };

    const readAll = async () => {
      await Promise.all(runs.map((run) => readRunLog(run)));
    };

    void readAll();
    const interval = window.setInterval(() => {
      void readAll();
    }, LOG_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [runIdsKey, runs]);

  useEffect(() => {
    if (!companyId || activeRunIds.size === 0) return;

    let closed = false;
    let reconnectTimer: number | null = null;
    let socket: WebSocket | null = null;

    const scheduleReconnect = () => {
      if (closed) return;
      reconnectTimer = window.setTimeout(connect, 1500);
    };

    const connect = () => {
      if (closed) return;
      const url = buildSameOriginWebSocketUrl(
        `/api/companies/${encodeURIComponent(companyId)}/events/ws`,
      );
      socket = new WebSocket(url);

      socket.onmessage = (message) => {
        const raw = typeof message.data === "string" ? message.data : "";
        if (!raw) return;

        let event: LiveEvent;
        try {
          event = JSON.parse(raw) as LiveEvent;
        } catch {
          return;
        }

        if (event.companyId !== companyId) return;
        const payload = event.payload ?? {};
        const runId = readString(payload["runId"]);
        if (!runId || !activeRunIds.has(runId)) return;
        if (!runById.has(runId)) return;

        if (event.type === "heartbeat.run.log") {
          const chunk = readString(payload["chunk"]);
          if (!chunk) return;
          const ts = readString(payload["ts"]) ?? event.createdAt;
          const stream =
            readString(payload["stream"]) === "stderr"
              ? "stderr"
              : readString(payload["stream"]) === "system"
                ? "system"
                : "stdout";
          appendChunks(runId, [{
            ts,
            stream,
            chunk,
            seq: readChunkSeq(payload["seq"]),
            dedupeKey: `log:${runId}:${ts}:${stream}:${chunk}`,
          }]);
          return;
        }

        if (event.type === "heartbeat.run.event") {
          const seq = typeof payload["seq"] === "number" ? payload["seq"] : null;
          const eventType = readString(payload["eventType"]) ?? "event";
          const messageText = readString(payload["message"]) ?? eventType;
          appendChunks(runId, [{
            ts: event.createdAt,
            stream: eventType === "error" ? "stderr" : "system",
            chunk: messageText,
            dedupeKey: `socket:event:${runId}:${seq ?? `${eventType}:${messageText}:${event.createdAt}`}`,
          }]);
          return;
        }

        if (event.type === "heartbeat.run.status") {
          const status = readString(payload["status"]) ?? "updated";
          appendChunks(runId, [{
            ts: event.createdAt,
            stream: isTerminalStatus(status) && status !== "succeeded" ? "stderr" : "system",
            chunk: `run ${status}`,
            dedupeKey: `socket:status:${runId}:${status}:${readString(payload["finishedAt"]) ?? ""}`,
          }]);
        }
      };

      socket.onerror = () => {
        socket?.close();
      };

      socket.onclose = () => {
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (socket) {
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close(1000, "live_run_transcripts_unmount");
      }
    };
  }, [activeRunIds, companyId, runById]);

  const transcriptByRun = useMemo(() => {
    const next = new Map<string, TranscriptEntry[]>();
    for (const run of runs) {
      const adapter = getUIAdapter(run.adapterType);
      next.set(run.id, buildTranscript(chunksByRun.get(run.id) ?? [], adapter.parseStdoutLine));
    }
    return next;
  }, [chunksByRun, runs]);

  return {
    transcriptByRun,
    hasOutputForRun(runId: string) {
      return (chunksByRun.get(runId)?.length ?? 0) > 0;
    },
  };
}
