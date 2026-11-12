import type { AdapterConfigFieldsProps } from "./types";
import {
  DraftInput,
  Field,
  help,
} from "../components/agent-config-primitives";
import { RuntimeServicesJsonField } from "./runtime-json-fields";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

type WorkspaceStrategyType = "project_primary" | "git_worktree";

function parseWorkspaceStrategyType(value: unknown): WorkspaceStrategyType {
  const record = asRecord(value);
  return record.type === "git_worktree" ? "git_worktree" : "project_primary";
}

function buildWorkspaceStrategy(
  type: WorkspaceStrategyType,
  current: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (type !== "git_worktree") return undefined;
  const next: Record<string, unknown> = { type: "git_worktree" };
  const baseRef = typeof current.baseRef === "string" ? current.baseRef.trim() : "";
  const branchTemplate = typeof current.branchTemplate === "string" ? current.branchTemplate.trim() : "";
  const worktreeParentDir = typeof current.worktreeParentDir === "string" ? current.worktreeParentDir.trim() : "";
  if (baseRef) next.baseRef = baseRef;
  if (branchTemplate) next.branchTemplate = branchTemplate;
  if (worktreeParentDir) next.worktreeParentDir = worktreeParentDir;
  return next;
}

export function LocalWorkspaceRuntimeFields({
  isCreate,
  values,
  set,
  config,
  eff,
  mark,
}: AdapterConfigFieldsProps) {
  const currentStrategy = isCreate
    ? {
        type: values?.workspaceStrategyType === "git_worktree" ? "git_worktree" : "project_primary",
        ...(values?.workspaceBaseRef ? { baseRef: values.workspaceBaseRef } : {}),
        ...(values?.workspaceBranchTemplate ? { branchTemplate: values.workspaceBranchTemplate } : {}),
        ...(values?.worktreeParentDir ? { worktreeParentDir: values.worktreeParentDir } : {}),
      }
    : asRecord(eff("adapterConfig", "workspaceStrategy", config.workspaceStrategy));

  const strategyType = parseWorkspaceStrategyType(currentStrategy);

  const updateEditWorkspaceStrategy = (patch: Partial<Record<"type" | "baseRef" | "branchTemplate" | "worktreeParentDir", string>>) => {
    const nextType = (patch.type === "git_worktree" ? "git_worktree" : patch.type === "project_primary" ? "project_primary" : strategyType) as WorkspaceStrategyType;
    const current = {
      ...currentStrategy,
      ...patch,
    };
    mark("adapterConfig", "workspaceStrategy", buildWorkspaceStrategy(nextType, current));
  };

  return (
    <>
      <Field label="Execution workspace strategy" hint={help.workspaceStrategy}>
        <select
          className={inputClass}
          value={strategyType}
          onChange={(event) => {
            const nextType = event.target.value === "git_worktree" ? "git_worktree" : "project_primary";
            if (isCreate) {
              set?.({ workspaceStrategyType: nextType });
              return;
            }
            updateEditWorkspaceStrategy({ type: nextType });
          }}
        >
          <option value="project_primary">Project primary workspace</option>
          <option value="git_worktree">Issue-scoped git worktree</option>
        </select>
      </Field>

      {strategyType === "git_worktree" && (
        <>
          <Field label="Base git ref" hint={help.workspaceBaseRef}>
            <DraftInput
              value={
                isCreate
                  ? values?.workspaceBaseRef ?? ""
                  : String(currentStrategy.baseRef ?? "")
              }
              onCommit={(value) => {
                if (isCreate) {
                  set?.({ workspaceBaseRef: value });
                  return;
                }
                updateEditWorkspaceStrategy({ baseRef: value });
              }}
              immediate
              className={inputClass}
              placeholder="main"
            />
          </Field>

          <Field label="Branch template" hint={help.workspaceBranchTemplate}>
            <DraftInput
              value={
                isCreate
                  ? values?.workspaceBranchTemplate ?? ""
                  : String(currentStrategy.branchTemplate ?? "")
              }
              onCommit={(value) => {
                if (isCreate) {
                  set?.({ workspaceBranchTemplate: value });
                  return;
                }
                updateEditWorkspaceStrategy({ branchTemplate: value });
              }}
              immediate
              className={inputClass}
              placeholder="{{issue.identifier}}-{{slug}}"
            />
          </Field>

          <Field label="Worktree parent directory" hint={help.worktreeParentDir}>
            <DraftInput
              value={
                isCreate
                  ? values?.worktreeParentDir ?? ""
                  : String(currentStrategy.worktreeParentDir ?? "")
              }
              onCommit={(value) => {
                if (isCreate) {
                  set?.({ worktreeParentDir: value });
                  return;
                }
                updateEditWorkspaceStrategy({ worktreeParentDir: value });
              }}
              immediate
              className={inputClass}
              placeholder=".paperclip/worktrees"
            />
          </Field>
        </>
      )}

      <RuntimeServicesJsonField
        isCreate={isCreate}
        values={values}
        set={set}
        config={config}
        mark={mark}
      />
    </>
  );
}
