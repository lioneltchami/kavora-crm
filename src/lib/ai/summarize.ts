import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { anthropicConfigured, env } from "@/lib/env";
import { redactPII } from "@/lib/pii";

/**
 * Summarize a piece of text using Claude Haiku. Returns a structured
 * `{ summary, nextActions, sentiment, topics }` payload.
 *
 * If Anthropic isn't configured, returns null — callers must handle.
 *
 * PII redaction is applied to the input before it's sent to the LLM.
 * The original is preserved in the DB.
 */

export type Summary = {
  summary: string;
  nextActions: string[];
  sentiment: "positive" | "neutral" | "negative";
  topics: string[];
};

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (!anthropicConfigured) throw new Error("ANTHROPIC_API_KEY missing");
  if (!cachedClient) cachedClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return cachedClient;
}

const SYSTEM_PROMPT = `You are a CRM assistant for a small AI agency. Given a raw conversation snippet, return a strict JSON object with these fields:
- "summary": one short paragraph (<= 80 words) describing what happened.
- "nextActions": array of 1-3 concrete next steps a human should take.
- "sentiment": "positive" | "neutral" | "negative".
- "topics": array of 1-4 short topic tags.
The input has been pre-redacted of obvious PII (SSN, credit-card, API keys, emails). Do NOT echo any PII that remains — paraphrase instead.
Respond with ONLY the JSON object. No prose, no markdown fences.`;

export async function summarizeSms(opts: {
  body: string;
  contactPhone: string;
  direction: "inbound" | "outbound";
}): Promise<Summary | null> {
  if (!anthropicConfigured || opts.body.trim().length === 0) return null;

  try {
    const client = getClient();
    const sanitized = redactPII(opts.body);
    const msg = await client.messages.create({
      model: env.ANTHROPIC_MODEL_HAIKU,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Direction: ${opts.direction}\nFrom/To: ${opts.contactPhone}\nBody:\n"""${sanitized}"""`,
        },
      ],
    });
    const text = msg.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
    return parseSummary(text);
  } catch (err) {
    console.error("[ai] summarizeSms failed", err);
    return null;
  }
}

export async function summarizeCallTranscript(opts: {
  transcript: string;
  contactName?: string | null;
}): Promise<Summary | null> {
  if (!anthropicConfigured || opts.transcript.trim().length === 0) return null;

  try {
    const client = getClient();
    const sanitized = redactPII(opts.transcript.slice(0, 12_000));
    const msg = await client.messages.create({
      model: env.ANTHROPIC_MODEL_HAIKU,
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Call with: ${opts.contactName ?? "unknown contact"}\nTranscript:\n"""${sanitized}"""`,
        },
      ],
    });
    const text = msg.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
    return parseSummary(text);
  } catch (err) {
    console.error("[ai] summarizeCallTranscript failed", err);
    return null;
  }
}

function parseSummary(text: string): Summary | null {
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    const obj = JSON.parse(cleaned);
    return {
      summary: String(obj.summary ?? ""),
      nextActions: Array.isArray(obj.nextActions) ? obj.nextActions.map(String) : [],
      sentiment:
        obj.sentiment === "positive" || obj.sentiment === "negative" ? obj.sentiment : "neutral",
      topics: Array.isArray(obj.topics) ? obj.topics.map(String) : [],
    };
  } catch {
    return null;
  }
}
