// Stub file for upstream authz features not in Ciutatis
// Company member roles service

import type { Request } from "express";
import { forbidden, HttpError, unauthorized } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { responsibleUserAuthzShadowMode } from "../services/authorization.js";

function throwOrShadowResponsibleUserCompanyAccessDeny(
  req: Request,
  companyId: string,
  code: "RESPONSIBLE_USER_UNAUTHORIZED" | "RESPONSIBLE_USER_UNAVAILABLE",
  message: string,
) {
  logger.warn({
    authzMode: responsibleUserAuthzShadowMode() ? "shadow" : "enforce",
    code,
    action: "company_access",
    companyId,
    actorAgentId: req.actor.agentId ?? null,
    responsibleUserId: req.actor.onBehalfOfUserId ?? null,
    method: req.method,
  }, "responsible-user company access intersection denied");
  if (responsibleUserAuthzShadowMode()) return;
  throw new HttpError(403, message, { code });
}

export type ActorType = "system" | "agent" | "user" | "plugin";

export interface ActorInfo {
  actorType: ActorType;
  actorId: string;
  agentId: string | null;
  runId?: string | null;
}

export function assertAuthenticated(req?: Request): void {
  if (!req?.actor || req.actor.type === "none") {
    throw unauthorized();
  }
}

export function assertInstanceAdmin(_req?: Request): void {
  assertAuthenticated(_req);
  if (_req?.actor.type === "board" && (_req.actor.source === "local_implicit" || _req.actor.isInstanceAdmin)) {
    return;
  }
  throw forbidden();
}

export function assertBoard(req: Request): void {
  assertAuthenticated(req);
  if (req.actor.type !== "board") {
    throw forbidden("Board access required");
  }
}

export function assertCompanyAccess(req: Request, companyId: string): void {
  assertAuthenticated(req);
  if (req.actor.type === "board" && req.actor.source === "local_implicit") return;
  if (req.actor.isInstanceAdmin) return;
  if (req.actor.type === "board") {
    const allowed = new Set(req.actor.companyIds ?? []);
    if (allowed.has(companyId)) return;
  }
  if (req.actor.type === "agent") {
    if (req.actor.companyId === companyId) return;
    throw forbidden("Agent key cannot access another company");
  }
  throw forbidden();
}

export function getActorInfo(req: Request): ActorInfo {
  if (req.actor?.type === "agent" && req.actor.agentId) {
    return {
      actorType: "agent",
      actorId: req.actor.agentId,
      agentId: req.actor.agentId,
      runId: req.actor.runId ?? null,
    };
  }
  if (req.actor?.type === "board" && req.actor.userId) {
    return {
      actorType: "user",
      actorId: req.actor.userId,
      agentId: null,
      runId: req.actor.runId ?? null,
      actorSource,
    };
  }
  return {
    actorType: "system",
    actorId: "board",
    agentId: null,
  };
}

export function assertBoardOrgAccess(req: Request, orgId: string): void {
  assertBoard(req);
  if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
  if (orgId !== "instance") {
    assertCompanyAccess(req, orgId);
    return;
  }
  if ((req.actor.companyIds ?? []).length > 0) return;
  if ((req.actor.memberships ?? []).some((membership) => membership.status === "active")) return;
  throw forbidden();
}
