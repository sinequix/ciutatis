import { pgTable, uuid, text, timestamp, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";

export const publicRequests = pgTable(
  "public_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    publicId: text("public_id").notNull(),
    institutionSlug: text("institution_slug").notNull(),
    submissionMode: text("submission_mode").notNull(),
    ownerUserId: text("owner_user_id"),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    recoveryTokenHash: text("recovery_token_hash"),
    category: text("category").notNull(),
    locationLabel: text("location_label"),
    publicTitle: text("public_title").notNull(),
    publicSummary: text("public_summary").notNull(),
    publicDescription: text("public_description").notNull(),
    publicStatus: text("public_status").notNull().default("received"),
    piiDetected: boolean("pii_detected").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    issueUniqueIdx: uniqueIndex("public_requests_issue_id_idx").on(table.issueId),
    publicIdUniqueIdx: uniqueIndex("public_requests_public_id_idx").on(table.publicId),
    companyStatusIdx: index("public_requests_company_status_idx").on(table.companyId, table.publicStatus),
    institutionSlugIdx: index("public_requests_institution_slug_idx").on(table.institutionSlug),
    ownerUserIdx: index("public_requests_owner_user_idx").on(table.ownerUserId),
  }),
);

