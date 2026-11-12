import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, documents, issueComments, issueDocuments, issues, projects } from "@paperclipai/db";
import type {
  CompanySearchQuery,
  CompanySearchResponse,
  CompanySearchResult,
  CompanySearchScope,
  CompanySearchSnippet,
} from "@paperclipai/shared";
import { companyArtifactsService } from "./company-artifacts.js";
import { visibleIssueCondition } from "./issue-visibility.js";

export const COMPANY_SEARCH_BRANCH_FETCH_LIMIT = 251;

type IssueRow = typeof issues.$inferSelect;
type AgentRow = typeof agents.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;

type SearchField = {
  field: "identifier" | "title" | "description" | "comment" | "document" | "agent" | "project";
  label: string;
  text: string;
  hrefHash?: string;
  sourceLabel?: string | null;
};

type MatchResult = {
  score: number;
  matchedFields: Set<CompanySearchResult["matchedFields"][number]>;
  snippets: CompanySearchSnippet[];
  sourceLabel: string | null;
  hrefHash: string | null;
};

export interface CompanySearchService {
  search(companyId: string, query: CompanySearchQuery): Promise<CompanySearchResponse>;
  indexCompany(companyId: string): Promise<void>;
}

export function companySearchBranchFetchLimit(limit: number, offset: number): number {
  return Math.min(COMPANY_SEARCH_BRANCH_FETCH_LIMIT, Math.max(1, limit + offset + 1));
}

function normalize(text: string): string {
  return text.toLowerCase();
}

function tokensFor(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function issueHref(issue: Pick<IssueRow, "id" | "identifier">, hash: string | null = null): string {
  return `/issues/${encodeURIComponent(issue.identifier ?? issue.id)}${hash ?? ""}`;
}

function findHighlight(text: string, tokens: string[]): CompanySearchSnippet["highlights"] {
  const lower = normalize(text);
  const ranges: CompanySearchSnippet["highlights"] = [];
  for (const token of tokens) {
    const index = lower.indexOf(token);
    if (index !== -1) ranges.push({ start: index, end: index + token.length });
  }
  return ranges.sort((a, b) => a.start - b.start).slice(0, 8);
}

function snippetFor(field: SearchField, tokens: string[]): CompanySearchSnippet | null {
  const highlights = findHighlight(field.text, tokens);
  if (highlights.length === 0 && field.text.length === 0) return null;
  const firstHit = highlights[0]?.start ?? 0;
  const start = Math.max(0, firstHit - 80);
  const end = Math.min(field.text.length, start + 220);
  const text = `${start > 0 ? "..." : ""}${field.text.slice(start, end)}${end < field.text.length ? "..." : ""}`;
  const offsetHighlights = highlights
    .filter((range) => range.end >= start && range.start <= end)
    .map((range) => ({
      start: Math.max(0, range.start - start + (start > 0 ? 3 : 0)),
      end: Math.max(0, range.end - start + (start > 0 ? 3 : 0)),
    }));
  return {
    field: field.field,
    label: field.label,
    text,
    highlights: offsetHighlights,
  };
}

function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i]![0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i]![j] = Math.min(dp[i]![j]!, dp[i - 2]![j - 2]! + 1);
      }
    }
  }
  return dp[a.length]![b.length]!;
}

function bigrams(value: string): Set<string> {
  const out = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    out.add(value.slice(index, index + 2));
  }
  return out;
}

function fuzzyWordMatch(token: string, text: string): boolean {
  if (!/^[a-z0-9]{5,}$/.test(token)) return false;
  const words = normalize(text).match(/[a-z0-9]+/g) ?? [];
  const tokenBigrams = bigrams(token);
  for (const word of words) {
    if (Math.abs(word.length - token.length) > 3) continue;
    if (distance(token, word) <= 2) return true;
    const wordBigrams = bigrams(word);
    let overlap = 0;
    for (const gram of tokenBigrams) {
      if (wordBigrams.has(gram)) overlap += 1;
    }
    if ((2 * overlap) / Math.max(1, tokenBigrams.size + wordBigrams.size) >= 0.58) return true;
  }
  return false;
}

function fieldMatchesToken(field: SearchField, token: string): boolean {
  const lower = normalize(field.text);
  if (lower.includes(token)) return true;
  return field.field === "title" && fuzzyWordMatch(token, field.text);
}

function matchFields(fields: SearchField[], query: string, scope: CompanySearchScope): MatchResult | null {
  const tokens = tokensFor(query);
  if (tokens.length === 0) return null;
  const matchedFields = new Set<CompanySearchResult["matchedFields"][number]>();
  const snippets: CompanySearchSnippet[] = [];
  let score = 0;
  let sourceLabel: string | null = null;
  let hrefHash: string | null = null;

  for (const token of tokens) {
    const matchingFields = fields.filter((field) => fieldMatchesToken(field, token));
    if (matchingFields.length === 0) return null;
    for (const field of matchingFields) {
      matchedFields.add(field.field);
      if (!sourceLabel && field.sourceLabel) sourceLabel = field.sourceLabel;
      if (!hrefHash && field.hrefHash) hrefHash = field.hrefHash;
      score += field.field === "identifier"
        ? 500
        : field.field === "title"
          ? 160
          : field.field === "agent" || field.field === "project"
            ? 140
            : 90;
      const snippet = snippetFor(field, tokens);
      if (snippet && !snippets.some((existing) => existing.field === snippet.field && existing.text === snippet.text)) {
        snippets.push(snippet);
      }
    }
  }

  if (scope === "issues" && !["identifier", "title", "description"].some((field) => matchedFields.has(field))) return null;
  if (scope === "comments" && !matchedFields.has("comment")) return null;
  if (scope === "documents" && !matchedFields.has("document")) return null;

  return { score, matchedFields, snippets: snippets.slice(0, 4), sourceLabel, hrefHash };
}

function issueResult(issue: IssueRow, match: MatchResult): CompanySearchResult {
  const exactIdentifierBoost = issue.identifier && match.matchedFields.has("identifier") ? 1000 : 0;
  return {
    id: issue.id,
    type: "issue",
    score: match.score + exactIdentifierBoost,
    title: issue.title,
    href: issueHref(issue, match.hrefHash),
    matchedFields: Array.from(match.matchedFields),
    sourceLabel: match.sourceLabel,
    snippet: match.snippets[0]?.text ?? issue.description ?? null,
    snippets: match.snippets,
    issue: {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      status: issue.status as never,
      priority: issue.priority as never,
      assigneeAgentId: issue.assigneeAgentId,
      assigneeUserId: issue.assigneeUserId,
      projectId: issue.projectId,
      updatedAt: iso(issue.updatedAt) ?? new Date(0).toISOString(),
    },
    updatedAt: iso(issue.updatedAt),
    previewImageUrl: null,
  };
}

function agentResult(agent: AgentRow, match: MatchResult): CompanySearchResult {
  return {
    id: agent.id,
    type: "agent",
    score: match.score,
    title: agent.name,
    href: `/agents/${encodeURIComponent(agent.id)}`,
    matchedFields: Array.from(match.matchedFields),
    sourceLabel: agent.role,
    snippet: match.snippets[0]?.text ?? agent.capabilities ?? agent.title,
    snippets: match.snippets,
    updatedAt: iso(agent.updatedAt),
    previewImageUrl: null,
  };
}

function projectResult(project: ProjectRow, match: MatchResult): CompanySearchResult {
  return {
    id: project.id,
    type: "project",
    score: match.score,
    title: project.name,
    href: `/projects/${encodeURIComponent(project.id)}`,
    matchedFields: Array.from(match.matchedFields),
    sourceLabel: project.status,
    snippet: match.snippets[0]?.text ?? project.description,
    snippets: match.snippets,
    updatedAt: iso(project.updatedAt),
    previewImageUrl: null,
  };
}

function sortResults(a: CompanySearchResult, b: CompanySearchResult): number {
  const scoreDiff = b.score - a.score;
  if (scoreDiff !== 0) return scoreDiff;
  const updatedDiff = new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime();
  if (updatedDiff !== 0) return updatedDiff;
  return a.title.localeCompare(b.title);
}

export function companySearchService(db: Db): CompanySearchService {
  return {
    async search(companyId, query) {
      const normalizedQuery = query.q.trim().toLowerCase();
      if (!normalizedQuery) {
        return {
          query: query.q,
          normalizedQuery,
          scope: query.scope,
          limit: query.limit,
          offset: query.offset,
          results: [],
          countsByType: { issue: 0, agent: 0, project: 0 },
          hasMore: false,
        };
      }

      const [issueRows, commentRows, documentRows, agentRows, projectRows] = await Promise.all([
        db.select().from(issues).where(and(eq(issues.companyId, companyId), isNull(issues.hiddenAt))),
        db.select().from(issueComments).where(eq(issueComments.companyId, companyId)),
        db
          .select({
            issueId: issueDocuments.issueId,
            key: issueDocuments.key,
            title: documents.title,
            body: documents.latestBody,
            updatedAt: documents.updatedAt,
          })
          .from(issueDocuments)
          .innerJoin(documents, eq(issueDocuments.documentId, documents.id))
          .where(eq(issueDocuments.companyId, companyId)),
        query.scope === "all" || query.scope === "agents"
          ? db.select().from(agents).where(eq(agents.companyId, companyId))
          : Promise.resolve([]),
        query.scope === "all" || query.scope === "projects"
          ? db.select().from(projects).where(eq(projects.companyId, companyId))
          : Promise.resolve([]),
      ]);

      const commentsByIssue = new Map<string, typeof commentRows>();
      for (const comment of commentRows) {
        const list = commentsByIssue.get(comment.issueId) ?? [];
        list.push(comment);
        commentsByIssue.set(comment.issueId, list);
      }
      const documentsByIssue = new Map<string, typeof documentRows>();
      for (const document of documentRows) {
        const list = documentsByIssue.get(document.issueId) ?? [];
        list.push(document);
        documentsByIssue.set(document.issueId, list);
      }

      const results: CompanySearchResult[] = [];
      for (const issue of issueRows) {
        const fields: SearchField[] = [];
        if (query.scope === "all" || query.scope === "issues") {
          if (issue.identifier) fields.push({ field: "identifier", label: "Identifier", text: issue.identifier });
          fields.push({ field: "title", label: "Title", text: issue.title });
          if (issue.description) fields.push({ field: "description", label: "Description", text: issue.description });
        }
        if (query.scope === "all" || query.scope === "comments") {
          for (const comment of commentsByIssue.get(issue.id) ?? []) {
            fields.push({
              field: "comment",
              label: "Comment",
              text: comment.body,
              hrefHash: `#comment-${comment.id}`,
              sourceLabel: "Comment",
            });
          }
        }
        if (query.scope === "all" || query.scope === "documents") {
          for (const document of documentsByIssue.get(issue.id) ?? []) {
            fields.push({
              field: "document",
              label: document.title ?? document.key,
              text: `${document.title ?? ""}\n${document.body}`,
              hrefHash: `#document-${document.key}`,
              sourceLabel: document.title ?? document.key,
            });
          }
        }
        const match = matchFields(fields, normalizedQuery, query.scope);
        if (match) results.push(issueResult(issue, match));
      }

      if (query.scope === "all" || query.scope === "agents") {
        for (const agent of agentRows) {
          const match = matchFields(
            [
              { field: "agent", label: "Agent", text: agent.name },
              { field: "agent", label: "Role", text: agent.role },
              ...(agent.title ? [{ field: "agent" as const, label: "Title", text: agent.title }] : []),
              ...(agent.capabilities ? [{ field: "agent" as const, label: "Capabilities", text: agent.capabilities }] : []),
            ],
            normalizedQuery,
            query.scope,
          );
          if (match) results.push(agentResult(agent, match));
        }
      }

      if (query.scope === "all" || query.scope === "projects") {
        for (const project of projectRows) {
          const match = matchFields(
            [
              { field: "project", label: "Project", text: project.name },
              ...(project.description ? [{ field: "project" as const, label: "Description", text: project.description }] : []),
            ],
            normalizedQuery,
            query.scope,
          );
          if (match) results.push(projectResult(project, match));
        }
      }

      results.sort(sortResults);
      const countsByType = {
        issue: results.filter((result) => result.type === "issue").length,
        agent: results.filter((result) => result.type === "agent").length,
        project: results.filter((result) => result.type === "project").length,
      };
      const windowEnd = query.offset + query.limit;
      return {
        query: query.q,
        normalizedQuery,
        scope: query.scope,
        limit: query.limit,
        offset: query.offset,
        results: results.slice(query.offset, windowEnd),
        countsByType,
        hasMore: results.length > windowEnd,
      };
    },
    async indexCompany() {
      // The current implementation computes search results live from normalized company-scoped tables.
    },
  };
}
