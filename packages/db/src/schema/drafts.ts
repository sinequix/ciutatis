import { pgEnum, pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const emailDraftStatus = pgEnum("email_draft_status", ["draft", "sent", "scheduled"]);

export const emailDrafts = pgTable(
  "email_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    userId: uuid("user_id").notNull(),
    subject: text("subject").notNull(),
    contentHtml: text("content_html"),
    contentText: text("content_text"),
    recipients: jsonb("recipients").$type<Array<{ email: string; name?: string | null }>>(),
    templateId: text("template_id"),
    status: emailDraftStatus("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    companyStatusIdx: index("email_drafts_company_status_idx").on(table.companyId, table.status),
    companyDeletedIdx: index("email_drafts_company_deleted_idx").on(table.companyId, table.deletedAt),
  }),
);
