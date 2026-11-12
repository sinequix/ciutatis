// Stub - productivity-review not in Ciutatis V1 scope
// This file exists only to satisfy upstream imports

export const PRODUCTIVITY_REVIEW_ORIGIN_KIND = "productivity_review";

export interface ProductivityReviewService {
  createReview(): Promise<unknown>;
  getReview(): Promise<unknown>;
  // Upstream-only methods for heartbeat integration
  isProductivityReviewContinuationHoldActive(_input: {
    companyId: string;
    issueId: string;
    agentId: string | null;
  }): Promise<{
    held: boolean;
    reviewIdentifier?: string | null;
    reviewIssueId?: string | null;
    trigger?: string | null;
    reason?: string | null;
  }>;
  recordContinuationHold(_input: {
    companyId: string;
    issueId: string;
    runId: string;
    agentId: string | null;
    reviewIssueId?: string | null;
    trigger?: string | null;
    reason?: string | null;
  }): Promise<void>;
  // Upstream-only: reconciliation for heartbeat.ts
  reconcileProductivityReviews(_opts?: { now?: Date; companyId?: string }): Promise<{
    created: number;
    updated: number;
    failed: number;
  }>;
}

export interface WakeupOptions {
  force?: boolean;
  reason?: string;
}

export function productivityReviewService(
  _db?: unknown,
  _hooks?: { enqueueWakeup?: (agentId: string, opts?: WakeupOptions) => Promise<unknown> }
): ProductivityReviewService {
  return {
    async createReview() {
      return null;
    },
    async getReview() {
      return null;
    },
    async isProductivityReviewContinuationHoldActive() {
      return { held: false };
    },
    async recordContinuationHold() {
      // No-op
    },
    async reconcileProductivityReviews() {
      return { created: 0, updated: 0, failed: 0 };
    },
  };
}
