import "server-only";

/**
 * Pre-LLM PII redaction.
 *
 * Strips obvious PII patterns (SSN, credit card numbers, US bank routing
 * numbers, API key shapes) from a string before it's sent to an LLM. The
 * original is preserved in the DB; only the LLM-facing copy is sanitized.
 *
 * Conservative by design: false positives (over-redaction) are acceptable;
 * false negatives (PII leaking to the model) are not.
 */

const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const CC_RE = /\b(?:\d[ -]?){13,19}\b/g;
const ROUTING_RE = /\b\d{9}\b/g;
const API_KEY_RE = /\b(?:sk-[A-Za-z0-9_-]{16,}|voyage-[A-Za-z0-9_-]{16,}|sk-ant-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{12,}|ghp_[A-Za-z0-9]{20,})\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

export function redactPII(input: string): string {
  if (!input) return input;
  return input
    .replace(SSN_RE, "[REDACTED-SSN]")
    .replace(CC_RE, "[REDACTED-CC]")
    .replace(ROUTING_RE, (m) => (/^\d{9}$/.test(m) ? "[REDACTED-ROUTING]" : m))
    .replace(API_KEY_RE, "[REDACTED-API-KEY]")
    .replace(EMAIL_RE, "[REDACTED-EMAIL]");
}
