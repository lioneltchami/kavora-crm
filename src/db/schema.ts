/**
 * Kavora CRM — Drizzle schema.
 *
 * Single-tenant for v1: every table carries `orgId` (always "kavora") so a future
 * multi-tenant migration is a column-add + RLS rewrite rather than a rebuild.
 *
 * Conventions:
 *  - Primary keys are UUIDv4 generated server-side.
 *  - `createdAt` / `updatedAt` on every mutable table.
 *  - All money is `valueCents` (integer) + `currency` (ISO 4217).
 *  - All phone numbers stored in E.164 format (`+1XXXXXXXXXX`).
 *  - Twilio SIDs kept on the relevant rows for idempotent webhook handling.
 */

import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const userRole = pgEnum("user_role", ["owner", "admin", "member"]);
export const contactStatus = pgEnum("contact_status", [
  "lead",
  "active",
  "customer",
  "archived",
]);
export const dealStatus = pgEnum("deal_status", ["open", "won", "lost"]);
export const callDirection = pgEnum("call_direction", ["inbound", "outbound"]);
export const callStatus = pgEnum("call_status", [
  "queued",
  "ringing",
  "in-progress",
  "completed",
  "busy",
  "failed",
  "no-answer",
]);
export const smsDirection = pgEnum("sms_direction", ["inbound", "outbound"]);
export const smsStatus = pgEnum("sms_status", [
  "queued",
  "sending",
  "sent",
  "delivered",
  "read",
  "failed",
]);
export const activityType = pgEnum("activity_type", [
  "call",
  "sms",
  "note",
  "email",
  "meeting",
  "stage-change",
]);
export const aiDraftChannel = pgEnum("ai_draft_channel", ["email", "sms"]);
export const phoneNumberStatus = pgEnum("phone_number_status", [
  "active",
  "released",
]);
export const contactChannelType = pgEnum("contact_channel_type", [
  "work",
  "home",
  "other",
]);

// ─── Organizations (single-row for v1) ────────────────────────────────────────

export const organizations = pgTable(
  "organizations",
  {
    id: varchar("id", { length: 64 }).primaryKey(), // e.g. "kavora"
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("organizations_name_idx").on(t.name)],
);

// ─── Users (synced from Clerk via webhook) ────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: varchar("id", { length: 64 }).primaryKey(), // Clerk user_id
    orgId: varchar("org_id", { length: 64 })
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    imageUrl: text("image_url"),
    role: userRole("role").notNull().default("member"),
    /** E.164; used as a Twilio `<Dial>` forwarding target for inbound calls. */
    phoneForRouting: varchar("phone_for_routing", { length: 32 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("users_org_idx").on(t.orgId),
    uniqueIndex("users_email_idx").on(t.email),
  ],
);

// ─── Companies ────────────────────────────────────────────────────────────────

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: varchar("org_id", { length: 64 })
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    domain: text("domain"),
    industry: text("industry"),
    size: text("size"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("companies_org_idx").on(t.orgId),
    uniqueIndex("companies_org_domain_idx").on(t.orgId, t.domain),
  ],
);

// ─── Contacts ─────────────────────────────────────────────────────────────────

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: varchar("org_id", { length: 64 })
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    email: text("email"),
    /** E.164 */
    phone: varchar("phone", { length: 32 }),
    companyId: uuid("company_id").references(() => companies.id, {
      onDelete: "set null",
    }),
    source: text("source"),
    status: contactStatus("status").notNull().default("lead"),
    ownerUserId: varchar("owner_user_id", { length: 64 }).references(
      () => users.id,
      { onDelete: "set null" },
    ),
    /** Free-form AI-extracted profile notes. */
    profileNotes: text("profile_notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Soft-delete tombstone; NULL = active. Set by `softDeleteContact`. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("contacts_org_idx").on(t.orgId),
    uniqueIndex("contacts_org_phone_idx").on(t.orgId, t.phone),
    index("contacts_org_email_idx").on(t.orgId, t.email),
    index("contacts_owner_idx").on(t.ownerUserId),
  ],
);

// ─── Pipelines & Stages ──────────────────────────────────────────────────────

export const pipelines = pgTable(
  "pipelines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: varchar("org_id", { length: 64 })
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("pipelines_org_idx").on(t.orgId)],
);

export const pipelineStages = pgTable(
  "pipeline_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: varchar("org_id", { length: 64 })
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    order: integer("order").notNull().default(0),
    isWon: boolean("is_won").notNull().default(false),
    isLost: boolean("is_lost").notNull().default(false),
    color: varchar("color", { length: 16 }),
  },
  (t) => [
    index("stages_pipeline_idx").on(t.pipelineId),
    uniqueIndex("stages_pipeline_order_idx").on(t.pipelineId, t.order),
  ],
);

// ─── Deals ────────────────────────────────────────────────────────────────────

export const deals = pgTable(
  "deals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: varchar("org_id", { length: 64 })
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    companyId: uuid("company_id").references(() => companies.id, {
      onDelete: "set null",
    }),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "restrict" }),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => pipelineStages.id, { onDelete: "restrict" }),
    valueCents: integer("value_cents").notNull().default(0),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    status: dealStatus("status").notNull().default("open"),
    ownerUserId: varchar("owner_user_id", { length: 64 }).references(
      () => users.id,
      { onDelete: "set null" },
    ),
    expectedCloseDate: timestamp("expected_close_date", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("deals_org_idx").on(t.orgId),
    index("deals_org_stage_idx").on(t.orgId, t.stageId),
    index("deals_contact_idx").on(t.contactId),
    index("deals_company_idx").on(t.companyId),
  ],
);

// ─── Tags ─────────────────────────────────────────────────────────────────────

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: varchar("org_id", { length: 64 })
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: varchar("color", { length: 16 }),
  },
  (t) => [uniqueIndex("tags_org_name_idx").on(t.orgId, t.name)],
);

export const contactTags = pgTable(
  "contact_tags",
  {
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.contactId, t.tagId] })],
);

// ─── Notes ────────────────────────────────────────────────────────────────────

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: varchar("org_id", { length: 64 })
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "cascade",
    }),
    dealId: uuid("deal_id").references(() => deals.id, {
      onDelete: "cascade",
    }),
    authorUserId: varchar("author_user_id", { length: 64 }).references(
      () => users.id,
      { onDelete: "set null" },
    ),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("notes_contact_idx").on(t.contactId),
    index("notes_deal_idx").on(t.dealId),
  ],
);

// ─── Phone numbers (Twilio) ───────────────────────────────────────────────────

export const phoneNumbers = pgTable(
  "phone_numbers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: varchar("org_id", { length: 64 })
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    twilioSid: varchar("twilio_sid", { length: 64 }).notNull(),
    /** E.164 */
    number: varchar("number", { length: 32 }).notNull(),
    friendlyName: text("friendly_name"),
    capabilities: jsonb("capabilities").$type<{
      voice?: boolean;
      sms?: boolean;
      mms?: boolean;
    }>(),
    voiceUrl: text("voice_url"),
    smsUrl: text("sms_url"),
    status: phoneNumberStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("phone_numbers_twilio_sid_idx").on(t.twilioSid),
    uniqueIndex("phone_numbers_number_idx").on(t.number),
  ],
);

// ─── Calls ────────────────────────────────────────────────────────────────────

export const calls = pgTable(
  "calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: varchar("org_id", { length: 64 })
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    dealId: uuid("deal_id").references(() => deals.id, {
      onDelete: "set null",
    }),
    phoneNumberId: uuid("phone_number_id").references(() => phoneNumbers.id, {
      onDelete: "set null",
    }),
    twilioCallSid: varchar("twilio_call_sid", { length: 64 }).notNull(),
    direction: callDirection("direction").notNull(),
    fromNumber: varchar("from_number", { length: 32 }).notNull(),
    toNumber: varchar("to_number", { length: 32 }).notNull(),
    status: callStatus("status").notNull().default("queued"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationSeconds: integer("duration_seconds"),
    recordingUrl: text("recording_url"),
    /** Path inside Supabase Storage bucket `call-recordings/`. */
    recordingPath: text("recording_path"),
    transcript: text("transcript"),
    transcriptStatus: varchar("transcript_status", { length: 32 })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("calls_twilio_sid_idx").on(t.twilioCallSid),
    index("calls_org_idx").on(t.orgId),
    index("calls_contact_idx").on(t.contactId),
  ],
);

// ─── SMS Messages ─────────────────────────────────────────────────────────────

export const smsMessages = pgTable(
  "sms_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: varchar("org_id", { length: 64 })
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    dealId: uuid("deal_id").references(() => deals.id, {
      onDelete: "set null",
    }),
    phoneNumberId: uuid("phone_number_id").references(() => phoneNumbers.id, {
      onDelete: "set null",
    }),
    twilioMessageSid: varchar("twilio_message_sid", { length: 64 }).notNull(),
    direction: smsDirection("direction").notNull(),
    fromNumber: varchar("from_number", { length: 32 }).notNull(),
    toNumber: varchar("to_number", { length: 32 }).notNull(),
    body: text("body").notNull(),
    mediaUrls: jsonb("media_urls").$type<string[]>().default([]),
    status: smsStatus("status").notNull().default("queued"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    errorCode: integer("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sms_twilio_sid_idx").on(t.twilioMessageSid),
    index("sms_org_idx").on(t.orgId),
    index("sms_contact_idx").on(t.contactId),
  ],
);

// ─── Activities (polymorphic timeline) ────────────────────────────────────────

export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: varchar("org_id", { length: 64 })
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    type: activityType("type").notNull(),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "cascade",
    }),
    dealId: uuid("deal_id").references(() => deals.id, {
      onDelete: "cascade",
    }),
    /** Foreign-key to the underlying record (call.id, sms.id, note.id). */
    refId: uuid("ref_id"),
    summary: text("summary"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("activities_org_idx").on(t.orgId),
    index("activities_contact_idx").on(t.contactId),
    index("activities_deal_idx").on(t.dealId),
    index("activities_type_idx").on(t.type),
  ],
);

// ─── AI Summaries ─────────────────────────────────────────────────────────────

export const aiSummaries = pgTable(
  "ai_summaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: varchar("org_id", { length: 64 })
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    activityId: uuid("activity_id").references(() => activities.id, {
      onDelete: "cascade",
    }),
    summary: text("summary").notNull(),
    nextActions: jsonb("next_actions").$type<string[]>().default([]),
    sentiment: varchar("sentiment", { length: 16 }),
    topics: jsonb("topics").$type<string[]>().default([]),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("ai_summaries_activity_idx").on(t.activityId)],
);

// ─── AI Drafts ────────────────────────────────────────────────────────────────

export const aiDrafts = pgTable(
  "ai_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: varchar("org_id", { length: 64 })
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "cascade",
    }),
    authorUserId: varchar("author_user_id", { length: 64 }).references(
      () => users.id,
      { onDelete: "set null" },
    ),
    prompt: text("prompt").notNull(),
    retrievedContextIds: jsonb("retrieved_context_ids")
      .$type<string[]>()
      .default([]),
    draftBody: text("draft_body").notNull(),
    channel: aiDraftChannel("channel").notNull(),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [
    index("ai_drafts_contact_idx").on(t.contactId),
    index("ai_drafts_org_idx").on(t.orgId),
  ],
);

// ─── AI Style (per-user voice profile) ────────────────────────────────────────

export const aiStyles = pgTable(
  "ai_styles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: varchar("org_id", { length: 64 })
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    examples: jsonb("examples").$type<string[]>().default([]),
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("ai_styles_user_idx").on(t.userId)],
);

// ─── Lead Scores ──────────────────────────────────────────────────────────────

export const leadScores = pgTable(
  "lead_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: varchar("org_id", { length: 64 })
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    score: integer("score").notNull(), // 0-100
    rationale: text("rationale").notNull(),
    scoredAt: timestamp("scored_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("lead_scores_contact_idx").on(t.contactId),
    index("lead_scores_org_score_idx").on(t.orgId, t.score),
  ],
);

// ─── Embeddings (pgvector, populated by RAG indexing job) ─────────────────────
//
// Drizzle doesn't ship first-class pgvector typings yet, so we use `text` for the
// SQL definition here and add the pgvector column + index in a hand-written SQL
// migration (see src/db/migrations/0001_init.sql).

export const embeddings = pgTable(
  "embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: varchar("org_id", { length: 64 })
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** e.g. "call", "sms", "note", "summary" */
    sourceType: varchar("source_type", { length: 32 }).notNull(),
    sourceId: uuid("source_id").notNull(),
    chunkIndex: integer("chunk_index").notNull().default(0),
    content: text("content").notNull(),
    /** Vector column populated by raw SQL migration (`embedding vector(1024)`). */
    embedding: text("embedding"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("embeddings_org_source_idx").on(t.orgId, t.sourceType, t.sourceId),
  ],
);

// ─── Audit log ────────────────────────────────────────────────────────────────

export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    orgId: varchar("org_id", { length: 64 }).notNull(),
    actorUserId: varchar("actor_user_id", { length: 64 }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    meta: jsonb("meta").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_org_idx").on(t.orgId),
    index("audit_entity_idx").on(t.entity, t.entityId),
    index("audit_created_idx").on(t.createdAt),
  ],
);

// ─── Relations ────────────────────────────────────────────────────────────────

export const organizationsRelations = relations(organizations, ({ many }) => ({
  users: many(users),
  contacts: many(contacts),
  deals: many(deals),
  companies: many(companies),
  pipelines: many(pipelines),
}));

export const usersRelations = relations(users, ({ many, one }) => ({
  org: one(organizations, { fields: [users.orgId], references: [organizations.id] }),
  ownedContacts: many(contacts),
  ownedDeals: many(deals),
  notes: many(notes),
}));

export const contactsRelations = relations(contacts, ({ many, one }) => ({
  org: one(organizations, { fields: [contacts.orgId], references: [organizations.id] }),
  company: one(companies, { fields: [contacts.companyId], references: [companies.id] }),
  owner: one(users, { fields: [contacts.ownerUserId], references: [users.id] }),
  deals: many(deals),
  calls: many(calls),
  sms: many(smsMessages),
  notes: many(notes),
  tags: many(contactTags),
}));

export const companiesRelations = relations(companies, ({ many }) => ({
  contacts: many(contacts),
  deals: many(deals),
}));

export const dealsRelations = relations(deals, ({ one }) => ({
  org: one(organizations, { fields: [deals.orgId], references: [organizations.id] }),
  contact: one(contacts, { fields: [deals.contactId], references: [contacts.id] }),
  company: one(companies, { fields: [deals.companyId], references: [companies.id] }),
  pipeline: one(pipelines, { fields: [deals.pipelineId], references: [pipelines.id] }),
  stage: one(pipelineStages, { fields: [deals.stageId], references: [pipelineStages.id] }),
  owner: one(users, { fields: [deals.ownerUserId], references: [users.id] }),
}));

export const pipelinesRelations = relations(pipelines, ({ many }) => ({
  stages: many(pipelineStages),
  deals: many(deals),
}));

export const stagesRelations = relations(pipelineStages, ({ one, many }) => ({
  pipeline: one(pipelines, { fields: [pipelineStages.pipelineId], references: [pipelines.id] }),
  deals: many(deals),
}));

export const callsRelations = relations(calls, ({ one }) => ({
  contact: one(contacts, { fields: [calls.contactId], references: [contacts.id] }),
  deal: one(deals, { fields: [calls.dealId], references: [deals.id] }),
  phoneNumber: one(phoneNumbers, {
    fields: [calls.phoneNumberId],
    references: [phoneNumbers.id],
  }),
}));

export const smsRelations = relations(smsMessages, ({ one }) => ({
  contact: one(contacts, { fields: [smsMessages.contactId], references: [contacts.id] }),
  deal: one(deals, { fields: [smsMessages.dealId], references: [deals.id] }),
  phoneNumber: one(phoneNumbers, {
    fields: [smsMessages.phoneNumberId],
    references: [phoneNumbers.id],
  }),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  contacts: many(contactTags),
}));

export const contactTagsRelations = relations(contactTags, ({ one }) => ({
  contact: one(contacts, { fields: [contactTags.contactId], references: [contacts.id] }),
  tag: one(tags, { fields: [contactTags.tagId], references: [tags.id] }),
}));

export const activitiesRelations = relations(activities, ({ one, many }) => ({
  contact: one(contacts, { fields: [activities.contactId], references: [contacts.id] }),
  deal: one(deals, { fields: [activities.dealId], references: [deals.id] }),
  summaries: many(aiSummaries),
}));

// ─── Inferred types ───────────────────────────────────────────────────────────

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type Deal = typeof deals.$inferSelect;
export type NewDeal = typeof deals.$inferInsert;
export type Pipeline = typeof pipelines.$inferSelect;
export type PipelineStage = typeof pipelineStages.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type PhoneNumber = typeof phoneNumbers.$inferSelect;
export type Call = typeof calls.$inferSelect;
export type NewCall = typeof calls.$inferInsert;
export type SmsMessage = typeof smsMessages.$inferSelect;
export type NewSmsMessage = typeof smsMessages.$inferInsert;
export type Activity = typeof activities.$inferSelect;
export type AiSummary = typeof aiSummaries.$inferSelect;
export type AiDraft = typeof aiDrafts.$inferSelect;
export type AiStyle = typeof aiStyles.$inferSelect;
export type LeadScore = typeof leadScores.$inferSelect;
export type Embedding = typeof embeddings.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferSelect;

// ─── Contact channels (multi-value, normalized — T2-1) ────────────────────────
// Replaces the legacy single-value `contacts.email` / `contacts.phone` columns
// (kept in place for backward compatibility). See T2-1 in docs/research/atomic-crm.

export const contactEmails = pgTable(
  "contact_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    type: contactChannelType("type").notNull().default("work"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("contact_emails_contact_idx").on(t.contactId)],
);

export const contactPhones = pgTable(
  "contact_phones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    phoneE164: varchar("phone_e164", { length: 32 }).notNull(),
    type: contactChannelType("type").notNull().default("work"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("contact_phones_contact_idx").on(t.contactId),
    index("contact_phones_e164_idx").on(t.phoneE164),
  ],
);

export const contactEmailsRelations = relations(contactEmails, ({ one }) => ({
  contact: one(contacts, {
    fields: [contactEmails.contactId],
    references: [contacts.id],
  }),
}));

export const contactPhonesRelations = relations(contactPhones, ({ one }) => ({
  contact: one(contacts, {
    fields: [contactPhones.contactId],
    references: [contacts.id],
  }),
}));

export type ContactEmail = typeof contactEmails.$inferSelect;
export type NewContactEmail = typeof contactEmails.$inferInsert;
export type ContactPhone = typeof contactPhones.$inferSelect;
export type NewContactPhone = typeof contactPhones.$inferInsert;

/**
 * Back-compat alias for the canonical Kavora organization id.
 *
 * @deprecated Use `currentOrgId()` from `@/lib/org` instead. The hardcoded
 * value survives only because external code paths (tests, scripts) may
 * still reference it; new code must read the org id from the Clerk session
 * at request time via the helper. Will be removed once those references
 * have been migrated.
 */
export const KAVORA_ORG_ID = "kavora";

/** Suppress unused-import warning for sql helper; kept for future raw queries. */
void sql;
