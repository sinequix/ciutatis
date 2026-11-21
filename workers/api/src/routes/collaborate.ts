import { Hono } from "hono";
import { publicContributions } from "@ciutatis/db-cloudflare";
import type { AppEnv } from "../lib/types.js";

// Public "Collaborate" intake: citizens drop a document, we recognise exact
// re-uploads (no reprocessing cost) and otherwise parse + process it through
// Superparser. This worker is a thin, guarded proxy — Superparser owns the
// hashing, dedup, and extraction.

const PUBLIC_COMPANY_ID = "public-contributions";
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

// Coarse per-IP abuse limit for an anonymous public upload path. Fixed window,
// backed by the session KV. Eventually-consistent KV is fine here — this is a
// cost/abuse guard, not an exact quota.
const RATE_LIMIT_MAX = 12;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

type RateState = { count: number; resetAt: number };

async function checkRateLimit(
  kv: KVNamespace | undefined,
  ip: string,
): Promise<{ ok: boolean; retryAfterSec: number }> {
  if (!kv) return { ok: true, retryAfterSec: 0 };
  const key = `collab-rl:${ip}`;
  const now = Date.now();
  let count = 0;
  let resetAt = now + RATE_LIMIT_WINDOW_MS;
  const raw = await kv.get(key);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as RateState;
      if (parsed.resetAt > now) {
        count = parsed.count;
        resetAt = parsed.resetAt;
      }
    } catch {
      // Corrupt entry — treat as a fresh window.
    }
  }
  if (count >= RATE_LIMIT_MAX) {
    return { ok: false, retryAfterSec: Math.ceil((resetAt - now) / 1000) };
  }
  await kv.put(key, JSON.stringify({ count: count + 1, resetAt } satisfies RateState), {
    expirationTtl: Math.ceil((resetAt - now) / 1000) + 5,
  });
  return { ok: true, retryAfterSec: 0 };
}

function isUploadedFile(value: unknown): value is File {
  return typeof value === "object" && value !== null && value instanceof File;
}

function collaborateFailureStatus(status: number): 400 | 413 | 415 | 422 | 500 | 502 {
  if (status === 401) return 502;
  if (status === 400 || status === 413 || status === 415 || status === 422 || status === 500) {
    return status;
  }
  return 502;
}

const ALLOWED_EXTENSIONS = ["pdf", "csv", "xlsx", "xls", "txt", "md", "json"];
const ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "text/csv",
  "text/plain",
  "text/markdown",
  "application/json",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream", // browsers fall back to this for some files
];

export function collaborateRoutes() {
  const app = new Hono<AppEnv>();

  app.post("/", async (c) => {
    const baseUrl = c.env.SUPERPARSER_URL?.replace(/\/+$/, "");
    if (!baseUrl) {
      return c.json(
        { error: "Document parsing isn't available yet.", code: "superparser_unconfigured" },
        503,
      );
    }

    const ip =
      c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const rate = await checkRateLimit(c.env.CIUTATIS_SESSIONS, ip);
    if (!rate.ok) {
      return c.json(
        { error: "Too many uploads from this connection. Please try again later.", code: "rate_limited" },
        429,
        { "Retry-After": String(rate.retryAfterSec) },
      );
    }

    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ error: "Expected a multipart form upload." }, 400);
    }

    const uploaded: unknown = form.get("file");
    if (!isUploadedFile(uploaded)) {
      return c.json({ error: "Attach a document under the 'file' field." }, 400);
    }
    const file = uploaded;
    if (file.size === 0) {
      return c.json({ error: "The uploaded file is empty." }, 400);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return c.json(
        { error: `File is too large. The maximum is ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.` },
        413,
      );
    }

    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    const typeAllowed =
      ALLOWED_CONTENT_TYPES.includes(file.type) || ALLOWED_EXTENSIONS.includes(ext);
    if (!typeAllowed) {
      return c.json(
        { error: "Unsupported file type. Upload a PDF, spreadsheet, or text document." },
        415,
      );
    }

    const upstream = new FormData();
    upstream.append("company_id", PUBLIC_COMPANY_ID);
    upstream.append("file", file, file.name);

    const headers: Record<string, string> = {};
    if (c.env.SUPERPARSER_SHARED_SECRET) {
      headers["Authorization"] = `Bearer ${c.env.SUPERPARSER_SHARED_SECRET}`;
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/v1/collaborate`, {
        method: "POST",
        body: upstream,
        headers,
      });
    } catch {
      return c.json({ error: "Couldn't reach the document parser. Please try again shortly." }, 502);
    }

    const text = await response.text();
    if (!response.ok) {
      return c.json(
        { error: "The document parser couldn't process this file.", detail: text.slice(0, 500) },
        collaborateFailureStatus(response.status),
      );
    }

    // Attribute the contribution to the citizen if they're signed in. Best-effort:
    // a logging failure must never break the user's result. Anonymous uploads
    // (actor.type !== "board") create no row.
    const actor = c.get("actor");
    if (actor.type === "board" && actor.userId) {
      try {
        const payload = JSON.parse(text) as {
          status?: string;
          contentHash?: string;
          document?: { id?: string; classification?: { label?: string } | null } | null;
        };
        await c.get("db").insert(publicContributions).values({
          userId: actor.userId,
          contentHash: payload.contentHash ?? "",
          filename: file.name,
          contentType: file.type || null,
          status: payload.status ?? "ingested",
          documentId: payload.document?.id ?? null,
          classificationLabel: payload.document?.classification?.label ?? null,
        });
      } catch {
        // Swallow — attribution is non-critical.
      }
    }

    return new Response(text, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  return app;
}
