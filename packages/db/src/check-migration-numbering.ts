import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const migrationsDir = fileURLToPath(new URL("./migrations", import.meta.url));
const journalPath = fileURLToPath(new URL("./migrations/meta/_journal.json", import.meta.url));

// Present on disk before this branch and intentionally not in the journal.
// Journaling it would make the migrator run its tenant UPDATEs.
const UNJOURNALED_BASELINE = new Set(["0082_argentina_tenant_routing.sql"]);

type JournalFile = {
  entries?: Array<{
    tag?: string;
  }>;
};

async function main() {
  const migrationFiles = (await readdir(migrationsDir))
    .filter((entry) => entry.endsWith(".sql"))
    .sort();
  const rawJournal = await readFile(journalPath, "utf8");
  const journal = JSON.parse(rawJournal) as JournalFile;
  const entries = journal.entries ?? [];
  const tags = entries.map((entry, index) => {
    if (typeof entry.tag !== "string" || entry.tag.length === 0) {
      throw new Error(`Migration journal entry ${index} is missing a tag`);
    }
    return entry.tag;
  });

  const fileSet = new Set(migrationFiles);
  const journalFiles = new Set(tags.map((tag) => `${tag}.sql`));

  for (const file of journalFiles) {
    if (!fileSet.has(file)) {
      throw new Error(`Journal entry has no migration file: ${file}`);
    }
  }

  for (const file of fileSet) {
    if (!journalFiles.has(file) && !UNJOURNALED_BASELINE.has(file)) {
      throw new Error(`Migration file is missing from the journal: ${file}`);
    }
  }

  for (const file of UNJOURNALED_BASELINE) {
    if (!fileSet.has(file)) {
      throw new Error(`Baseline migration file is gone: ${file}`);
    }
    if (journalFiles.has(file)) {
      throw new Error(`Baseline migration is now journaled and should leave the baseline: ${file}`);
    }
  }
}

await main();
