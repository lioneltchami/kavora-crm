import "server-only";

/**
 * Extracts Twilio form params from a Request and asserts they are all strings.
 *
 * `formData.entries()` yields `[string, FormDataEntryValue]` where the value
 * can be a string OR a File. Twilio only sends strings, but TS needs the cast.
 */
export async function readTwilioParams(req: Request): Promise<Record<string, string>> {
  const fd = await req.formData();
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}
