/**
 * Kavora CRM — read-only summary views.
 *
 * Mirror the SQL views created by `src/db/migrations/0004_summary_views.sql`.
 * `.existing()` tells Drizzle these views are owned by the migration file, NOT
 * by the TS schema — so `drizzle-kit` won't try to emit CREATE VIEW statements.
 *
 * Usage:
 *   import { contactsSummaryView, type ContactSummary } from "@/db/views";
 *   import { db } from "@/db";
 *
 *   const rows: ContactSummary[] = await db.select().from(contactsSummaryView);
 *   //                                                            ^^^^^^^^^^^^^^^^
 *   //              typed via $inferSelect — nb_deals, nb_calls, nb_sms, last_activity_at
 */

import {
  integer,
  pgView,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { contactStatus } from "./schema";

export const contactsSummaryView = pgView("contacts_summary", {
  id: uuid("id").notNull(),
  org_id: varchar("org_id", { length: 64 }).notNull(),
  first_name: text("first_name").notNull(),
  last_name: text("last_name"),
  email: text("email"),
  phone: varchar("phone", { length: 32 }),
  status: contactStatus("status").notNull(),
  company_id: uuid("company_id"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull(),
  deleted_at: timestamp("deleted_at", { withTimezone: true }),
  nb_deals: integer("nb_deals").notNull().default(0),
  nb_calls: integer("nb_calls").notNull().default(0),
  nb_sms: integer("nb_sms").notNull().default(0),
  last_activity_at: timestamp("last_activity_at", { withTimezone: true }),
}).existing();

export const companiesSummaryView = pgView("companies_summary", {
  id: uuid("id").notNull(),
  org_id: varchar("org_id", { length: 64 }).notNull(),
  name: text("name").notNull(),
  domain: text("domain"),
  industry: text("industry"),
  size: text("size"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull(),
  nb_contacts: integer("nb_contacts").notNull().default(0),
  nb_deals: integer("nb_deals").notNull().default(0),
  nb_open_deals: integer("nb_open_deals").notNull().default(0),
}).existing();

export type ContactSummary = typeof contactsSummaryView.$inferSelect;
export type CompanySummary = typeof companiesSummaryView.$inferSelect;