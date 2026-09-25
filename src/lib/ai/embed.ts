import "server-only";
import { embeddingsConfigured, env } from "@/lib/env";

/**
 * Compute embeddings for a piece of content and store in pgvector.
 *
 * Provider abstraction: prefer Voyage (cheaper, better for retrieval), fall
 * back to OpenAI text-embedding-3-small if VOYAGE_API_KEY isn't set.
 *
 * Idempotency: deletes any existing chunks for the same (orgId, sourceType,
 * sourceId) before inserting. Safe to retry without bloating the RAG index.
 *
 * Returns the inserted embedding ids, or null if embeddings are not configured.
 */

export type EmbedProvider = "voyage" | "openai";

let provider: EmbedProvider | null = null;

function resolveProvider(): EmbedProvider | null {
  if (provider) return provider;
  if (env.VOYAGE_API_KEY) provider = "voyage";
  else if (env.OPENAI_API_KEY) provider = "openai";
  return provider;
}

async function embedWithVoyage(texts: string[]): Promise<number[][]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: env.EMBEDDING_MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`Voyage ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return json.data.map((d) => d.embedding);
}

async function embedWithOpenAI(texts: string[]): Promise<number[][]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texts }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return json.data.map((d) => d.embedding);
}

/**
 * Chunk content (naive split on paragraphs + length cap) and embed each chunk.
 */
function chunkContent(text: string, maxChars = 1200): string[] {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let buf = "";
  for (const p of paragraphs) {
    if ((buf + "\n\n" + p).length > maxChars && buf.length > 0) {
      out.push(buf);
      buf = p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf) out.push(buf);
  return out.length > 0 ? out : [text.slice(0, maxChars)];
}

export async function embedActivity(opts: {
  sourceType: "call" | "sms" | "note" | "summary";
  sourceId: string;
  content: string;
  orgId: string;
}): Promise<string[] | null> {
  if (!embeddingsConfigured) {
    console.warn("[embed] no embeddings provider configured");
    return null;
  }
  const p = resolveProvider();
  if (!p) return null;

  const chunks = chunkContent(opts.content);
  let vectors: number[][] = [];
  try {
    vectors = p === "voyage" ? await embedWithVoyage(chunks) : await embedWithOpenAI(chunks);
  } catch (err) {
    console.error("[embed] provider call failed", err);
    return null;
  }

  const { adminPool } = await import("@/db");
  // Idempotency: wipe existing chunks for this (org, source) before re-insert.
  // Without this, retries would double the RAG index.
  await adminPool.query(
    `DELETE FROM embeddings WHERE org_id = $1 AND source_type = $2 AND source_id = $3`,
    [opts.orgId, opts.sourceType, opts.sourceId],
  );

  const insertedIds: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const vec = vectors[i]!;
    const vecLiteral = `[${vec.join(",")}]`;
    const result = await adminPool.query<{ id: string }>(
      `INSERT INTO embeddings (org_id, source_type, source_id, chunk_index, content, embedding)
       VALUES ($1, $2, $3, $4, $5, $6::vector)
       RETURNING id`,
      [opts.orgId, opts.sourceType, opts.sourceId, i, chunk, vecLiteral],
    );
    insertedIds.push(result.rows[0]?.id ?? "");
  }
  return insertedIds.filter(Boolean);
}

/**
 * Retrieve top-k similar chunks for a query.
 */
export async function retrieveSimilar(opts: {
  orgId: string;
  query: string;
  topK?: number;
}): Promise<Array<{ id: string; sourceType: string; sourceId: string; content: string; similarity: number }>> {
  if (!embeddingsConfigured) return [];
  const p = resolveProvider();
  if (!p) return [];

  const [vec] = p === "voyage" ? await embedWithVoyage([opts.query]) : await embedWithOpenAI([opts.query]);
  const vecLiteral = `[${vec!.join(",")}]`;

  const { adminPool } = await import("@/db");
  const result = await adminPool.query<{
    id: string;
    source_type: string;
    source_id: string;
    content: string;
    similarity: number;
  }>(
    `SELECT id, source_type, source_id, content,
            1 - (embedding <=> $1::vector) AS similarity
       FROM embeddings
      WHERE org_id = $2
      ORDER BY embedding <=> $1::vector
      LIMIT $3`,
    [vecLiteral, opts.orgId, opts.topK ?? 6],
  );
  return result.rows.map((r) => ({
    id: r.id,
    sourceType: r.source_type,
    sourceId: r.source_id,
    content: r.content,
    similarity: Number(r.similarity),
  }));
}
