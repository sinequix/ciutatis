import type { RoutineRevision } from "@paperclipai/shared";
import { api } from "./client";

export interface RestoreRoutineRevisionResponse {
  routine: unknown;
  revision: RoutineRevision;
  restoredFromRevisionNumber: number;
  secretMaterials: unknown[];
}

export const routinesApi = {
  listRevisions: (routineId: string) =>
    api.get<RoutineRevision[]>(`/routines/${encodeURIComponent(routineId)}/revisions`),
  restoreRevision: (
    routineId: string,
    revisionId: string,
    data: { changeSummary: string | null },
  ) =>
    api.post<RestoreRoutineRevisionResponse>(
      `/routines/${encodeURIComponent(routineId)}/revisions/${encodeURIComponent(revisionId)}/restore`,
      data,
    ),
};
