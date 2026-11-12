import type {
  IssueCommentMetadata,
  IssueCommentMetadataRow,
  IssueCommentPresentation,
} from "@paperclipai/shared";
import type {
  SystemNoticeMetadataRow,
  SystemNoticeMetadataSection,
  SystemNoticeProps,
  SystemNoticeTone,
} from "../components/SystemNotice";

const TONE_LABEL: Record<SystemNoticeTone, string> = {
  neutral: "System notice",
  info: "System notice",
  success: "System notice",
  warning: "System warning",
  danger: "System alert",
};

function metadataRowText(row: { label?: string | null }, fallback: string) {
  const label = row.label?.trim();
  return label && label.length > 0 ? label : fallback;
}

function isSystemNoticeTone(value: string | undefined): value is SystemNoticeTone {
  return value === "neutral" || value === "info" || value === "success" || value === "warning" || value === "danger";
}

function mapMetadataRow(
  row: IssueCommentMetadataRow,
  ctx: { runAgentId?: string | null },
): SystemNoticeMetadataRow | null {
  switch (row.type) {
    case "text":
      return { kind: "text", label: metadataRowText(row, "Detail"), value: row.text ?? "" };
    case "code":
      return { kind: "code", label: metadataRowText(row, "Code"), value: row.code ?? "" };
    case "key_value":
      return { kind: "text", label: metadataRowText(row, "Value"), value: row.value ?? "" };
    case "issue_link": {
      const identifier = row.identifier ?? null;
      if (!identifier) {
        return { kind: "text", label: metadataRowText(row, "Task"), value: row.title ?? "unknown" };
      }
      return {
        kind: "issue",
        label: metadataRowText(row, "Task"),
        identifier,
        href: `/issues/${identifier}`,
        ...(row.title ? { title: row.title } : {}),
      };
    }
    case "agent_link": {
      const agentId = row.agentId ?? "";
      const name = row.name?.trim() || agentId.slice(0, 8) || "agent";
      return {
        kind: "agent",
        label: metadataRowText(row, "Agent"),
        name,
        ...(agentId ? { href: `/agents/${agentId}` } : {}),
      };
    }
    case "run_link": {
      if (!row.runId) return null;
      const runAgentId = ctx.runAgentId ?? null;
      const href = runAgentId ? `/agents/${runAgentId}/runs/${row.runId}` : undefined;
      return {
        kind: "run",
        label: metadataRowText(row, "Run"),
        runId: row.runId,
        ...(href ? { href } : {}),
        ...(row.title ? { status: row.title } : {}),
      };
    }
    default:
      return null;
  }
}

export function mapCommentMetadataToSystemNoticeSections(
  metadata: IssueCommentMetadata | null | undefined,
  ctx: { runAgentId?: string | null } = {},
): SystemNoticeMetadataSection[] {
  if (!metadata || !Array.isArray(metadata.sections)) return [];
  return metadata.sections
    .map((section) => {
      const rows = section.rows
        .map((row) => mapMetadataRow(row, ctx))
        .filter((r): r is SystemNoticeMetadataRow => r !== null);
      if (rows.length === 0) return null;
      const out: SystemNoticeMetadataSection = { rows };
      if (section.title) out.title = section.title;
      return out;
    })
    .filter((s): s is SystemNoticeMetadataSection => s !== null);
}

export function systemNoticeLabelForTone(
  tone: SystemNoticeTone,
  presentationTitle?: string | null,
): string {
  const trimmed = presentationTitle?.trim();
  if (trimmed && trimmed.length > 0) return trimmed;
  return TONE_LABEL[tone];
}

export function buildSystemNoticeProps(input: {
  presentation: IssueCommentPresentation | null;
  metadata: IssueCommentMetadata | null;
  body: import("react").ReactNode;
  timestamp?: string;
  source?: SystemNoticeProps["source"];
  runAgentId?: string | null;
}): SystemNoticeProps {
  const tone: SystemNoticeTone = isSystemNoticeTone(input.presentation?.tone)
    ? input.presentation.tone
    : "neutral";
  const label = systemNoticeLabelForTone(tone, input.presentation?.title);
  const detailsDefaultOpen = Boolean(input.presentation?.detailsDefaultOpen);
  const sections = mapCommentMetadataToSystemNoticeSections(input.metadata, {
    runAgentId: input.runAgentId ?? null,
  });
  return {
    tone,
    label,
    body: input.body,
    detailsDefaultOpen,
    ...(sections.length > 0 ? { metadata: sections } : {}),
    ...(input.timestamp ? { timestamp: input.timestamp } : {}),
    ...(input.source ? { source: input.source } : {}),
  };
}
