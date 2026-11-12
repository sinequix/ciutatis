import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { publicRequests } from "./public_requests.js";
import { issues } from "./issues.js";

export const publicRequestUpdates = pgTable(
  "public_request_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicRequestId: uuid("public_request_id").notNull().references(() => publicRequests.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("system"),
    actorLabel: text("actor_label").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    publicRequestIdx: index("public_request_updates_public_request_idx").on(table.publicRequestId, table.createdAt),
    issueIdx: index("public_request_updates_issue_idx").on(table.issueId),
  }),
);

