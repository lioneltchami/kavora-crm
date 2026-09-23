import { db } from "@/db";
import { phoneNumbers, KAVORA_ORG_ID } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatPhoneForDisplay } from "@/lib/phone";
import { PhoneNumberActions } from "@/components/settings/phone-number-actions";
import { twilioConfigured } from "@/lib/env";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function PhoneNumbersPage() {
  const rows = await db
    .select()
    .from(phoneNumbers)
    .where(eq(phoneNumbers.orgId, KAVORA_ORG_ID))
    .orderBy(desc(phoneNumbers.createdAt));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Phone numbers"
        description="Your working Twilio numbers. Buy new ones or release existing ones."
      />

      {!twilioConfigured && (
        <div className="rounded-md border border-amber-500 bg-amber-50 p-4 text-sm dark:bg-amber-950/20">
          Twilio is not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in your
          environment to enable number management.
        </div>
      )}

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-sm text-muted-foreground">
              You don't have any phone numbers yet. Once Twilio is configured, use the form below to buy
              a US local or toll-free number and wire it up to your CRM.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{formatPhoneForDisplay(p.number)}</CardTitle>
                    <p className="text-sm text-muted-foreground">{p.friendlyName ?? "—"}</p>
                  </div>
                  <Badge variant={p.status === "active" ? "success" : "secondary"}>{p.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <Capability label="Voice" enabled={Boolean(p.capabilities?.voice)} />
                  <Capability label="SMS" enabled={Boolean(p.capabilities?.sms)} />
                  <Capability label="MMS" enabled={Boolean(p.capabilities?.mms)} />
                </div>
                <div className="text-xs text-muted-foreground">
                  <p>
                    Voice webhook: <code className="rounded bg-muted px-1">{p.voiceUrl ?? "—"}</code>
                  </p>
                  <p>
                    SMS webhook: <code className="rounded bg-muted px-1">{p.smsUrl ?? "—"}</code>
                  </p>
                </div>
                <PhoneNumberActions id={p.id} status={p.status} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Buy a new number</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {twilioConfigured
              ? "Search and purchase numbers from Twilio. They are wired up to your CRM webhooks automatically."
              : "Configure Twilio credentials above to enable buying numbers."}
          </p>
          {twilioConfigured && (
            <Link
              href="/settings/phone-numbers/buy"
              className="mt-3 inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Search available numbers →
            </Link>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Capability({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="rounded-md border bg-background p-2 text-center">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xs font-semibold ${enabled ? "text-emerald-600" : "text-muted-foreground"}`}>
        {enabled ? "Yes" : "No"}
      </div>
    </div>
  );
}
