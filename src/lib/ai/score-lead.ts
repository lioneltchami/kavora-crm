import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { anthropicConfigured, env } from "@/lib/env";
import { redactPII } from "@/lib/pii";
import { db } from "@/db";
import { contacts, leadScores, activities, aiSummaries, KAVORA_ORG_ID } from "@/db/schema";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";

/**
 * Score a contact's likelihood to close (0-100) using recent activity
 * + AI-extracted summaries + the contact's profile. Returns the score
 * and rationale.
 *
 * Defended against PII (sanitized before send) and malformed model output
 * (zod-validated; invalid scores are skipped).
 */

const ScorePayloadSchema = z.object({
  score: z.number().finite().min(0).max(100),
  rationale: z.string().max(500),
});

export type ScoreResult = {
  contactId: string;
  score: number;
  rationale: string;
};

export async function scoreContact(contactId: string): Promise<ScoreResult | null> {
  if (!anthropicConfigured) return null;

  const c = await db
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.id, contactId),
        eq(contacts.orgId, KAVORA_ORG_ID),
        isNull(contacts.deletedAt),
      ),
    )
    .limit(1);
  if (!c[0]) return null;
  const contact = c[0];

  const since = new Date(Date.now() - 30 * 86_400_000);
  const recentActivities = await db
    .select()
    .from(activities)
    .where(and(eq(activities.contactId, contactId), gte(activities.occurredAt, since)))
    .orderBy(desc(activities.occurredAt))
    .limit(20);

  // Fetch the AI-extracted summaries for those activities so the rubric
  // prompt sees structured signals (next actions, topics), not just raw text.
  const recentActivityIds = recentActivities.map((a) => a.id);
  const summaries =
    recentActivityIds.length > 0
      ? await db
          .select({
            activityId: aiSummaries.activityId,
            summary: aiSummaries.summary,
            nextActions: aiSummaries.nextActions,
            topics: aiSummaries.topics,
            sentiment: aiSummaries.sentiment,
          })
          .from(aiSummaries)
          .where(inArray(aiSummaries.activityId, recentActivityIds))
      : [];

  const prompt = `Score this contact's likelihood to close as a customer (0-100). Use these signals:

Contact:
${JSON.stringify(
  {
    firstName: contact.firstName,
    lastName: contact.lastName,
    status: contact.status,
    profileNotes: contact.profileNotes,
  },
  null,
  2,
)}

Recent activities (${recentActivities.length}):
${recentActivities.map((a) => `- [${a.type}] ${redactPII(a.summary ?? "")}`).join("\n")}

AI-extracted summaries for those activities (${summaries.length}):
${summaries
  .map(
    (s) =>
      `- summary: ${redactPII(s.summary)} | next: ${(s.nextActions ?? []).join("; ")} | topics: ${(s.topics ?? []).join(", ")} | sentiment: ${s.sentiment}`,
  )
  .join("\n")}

Return strict JSON: {"score": 0-100, "rationale": "<= 30 words"}`;

  try {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: env.ANTHROPIC_MODEL_HAIKU,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content.filter((c) => c.type === "text").map((c) => c.text).join("");
    const cleaned = text.replace(/```json|```/g, "").trim();
    const parsed = ScorePayloadSchema.safeParse(JSON.parse(cleaned));
    if (!parsed.success) {
      console.warn("[score] model returned invalid payload", parsed.error.flatten());
      return null;
    }
    const score = Math.round(parsed.data.score);

    await db.insert(leadScores).values({
      orgId: KAVORA_ORG_ID,
      contactId,
      score,
      rationale: parsed.data.rationale,
    });

    return { contactId, score, rationale: parsed.data.rationale };
  } catch (err) {
    console.error("[score] failed", err);
    return null;
  }
}
