export interface IssueTimelineEvent {
  id: string;
  createdAt: Date | string;
  actorType?: "user" | "agent" | "system" | string | null;
  actorId?: string | null;
  statusChange?: {
    from: string | null;
    to: string;
  };
  assigneeChange?: {
    from: { agentId: string | null; userId: string | null };
    to: { agentId: string | null; userId: string | null };
  };
}
