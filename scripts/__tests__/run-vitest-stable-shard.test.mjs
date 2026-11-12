import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = path.join(repoRoot, "scripts", "run-vitest-stable.mjs");

function dryRun(args) {
  const result = spawnSync(process.execPath, [script, ...args, "--dry-run"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return result;
}

function dryRunJson(args) {
  const result = dryRun(args);
  assert.equal(result.status, 0, `expected success for ${args.join(" ")}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

const SHARD_COUNT = 3;

test("the general-server shards form a complete, non-overlapping partition", () => {
  const shards = Array.from({ length: SHARD_COUNT }, (_, index) =>
    dryRunJson(["--mode", "general", "--group", "general-server", "--shard-index", String(index), "--shard-count", String(SHARD_COUNT)]),
  );

  const total = shards[0].generalServerSuiteCount;
  assert.ok(total > 0, "expected a non-empty general-server suite set");

  const seen = new Set();
  let selectedTotal = 0;
  for (const shard of shards) {
    assert.equal(shard.generalServerSuiteCount, total, "suite count must be stable across shards");
    for (const file of shard.selectedGeneralServerSuites) {
      assert.ok(!seen.has(file), `suite assigned to more than one shard: ${file}`);
      seen.add(file);
      selectedTotal += 1;
    }
  }

  // Every suite runs exactly once: union covers the whole set with no overlap.
  assert.equal(selectedTotal, total, "every suite must be selected exactly once");
  assert.equal(seen.size, total, "union of shards must cover the whole suite set");
});

test("a route/authz suite never leaks into the general-server shards", () => {
  const shard = dryRunJson(["--mode", "general", "--group", "general-server", "--shard-index", "0", "--shard-count", SHARD_COUNT.toString()]);
  for (const file of shard.selectedGeneralServerSuites) {
    assert.ok(
      !/[^/]*(?:route|routes|authz)[^/]*\.test\.ts$/.test(file),
      `route/authz suite must stay in the serialized lane, not general-server: ${file}`,
    );
  }
});

test("shard flags are rejected for the parallel workspace groups", () => {
  const result = dryRun(["--mode", "general", "--group", "general-workspaces-a", "--shard-index", "0", "--shard-count", "3"]);
  assert.notEqual(result.status, 0, "workspace groups must not accept shard flags");
});

function workspaceProjectName(dir) {
  const configPath = path.join(repoRoot, dir, "vitest.config.ts");
  if (existsSync(configPath)) {
    const named = readFileSync(configPath, "utf8").match(/name:\s*"([^"]+)"/);
    if (named) return named[1];
  }

  const pkg = JSON.parse(readFileSync(path.join(repoRoot, dir, "package.json"), "utf8"));
  return pkg.name;
}

function rootVitestProjectDirs() {
  const config = readFileSync(path.join(repoRoot, "vitest.config.ts"), "utf8");
  const block = config.match(/projects:\s*\[([\s\S]*?)\]/);
  assert.ok(block, "root vitest config must declare projects");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

test("non-server projects match the root vitest workspace", () => {
  const payload = dryRunJson(["--mode", "general"]);
  const workspaceProjects = rootVitestProjectDirs()
    .filter((dir) => dir !== "server")
    .map((dir) => workspaceProjectName(dir));

  assert.deepEqual(payload.nonServerProjects, workspaceProjects);
  assert.equal(payload.nonServerProjects.includes("@paperclipai/ui"), false);
  assert.equal(payload.nonServerProjects.includes("@paperclipai/adapter-cursor-local"), true);

  const grouped = [...payload.generalWorkspacesAProjects, ...payload.generalWorkspacesBProjects];
  assert.deepEqual(grouped.toSorted(), [...payload.nonServerProjects].toSorted());
  assert.equal(new Set(grouped).size, grouped.length, "workspace groups must not overlap");
});
