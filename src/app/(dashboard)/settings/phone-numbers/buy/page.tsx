import { PageHeader } from "@/components/dashboard/page-header";
import { listAvailableNumbers } from "@/actions/settings";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatPhoneForDisplay } from "@/lib/phone";
import { BuyNumberButton } from "@/components/settings/buy-number-button";
import { twilioConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function BuyNumberPage({
  searchParams,
}: {
  searchParams: Promise<{ areaCode?: string; type?: "local" | "tollfree" }>;
}) {
  const sp = await searchParams;
  const numbers = twilioConfigured
    ? await listAvailableNumbers({
        areaCode: sp.areaCode,
        type: sp.type ?? "local",
      })
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Buy a phone number"
        description="Pick a number and it will be wired to your CRM webhooks automatically."
      />

      {!twilioConfigured && (
        <div className="rounded-md border border-amber-500 bg-amber-50 p-4 text-sm dark:bg-amber-950/20">
          Twilio is not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in your
          environment to search and buy numbers.
        </div>
      )}

      <form className="flex items-end gap-3">
        <div className="space-y-1">
          <label className="text-sm font-medium">Area code</label>
          <input
            name="areaCode"
            defaultValue={sp.areaCode ?? ""}
            placeholder="e.g. 303"
            className="h-10 w-32 rounded-md border bg-background px-3 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Type</label>
          <select
            name="type"
            defaultValue={sp.type ?? "local"}
            className="h-10 rounded-md border bg-background px-3 text-sm"
          >
            <option value="local">Local</option>
            <option value="tollfree">Toll-free</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={!twilioConfigured}
          className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Search
        </button>
      </form>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {numbers.map((n) => (
          <Card key={n.sid}>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-center justify-between">
                <p className="font-mono text-lg">{formatPhoneForDisplay(n.phoneNumber)}</p>
                <Badge variant="outline">{n.locality ?? n.region ?? "US"}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{n.friendlyName}</p>
              <div className="flex gap-2 text-xs">
                {n.capabilities.voice && <Badge variant="secondary">Voice</Badge>}
                {n.capabilities.sms && <Badge variant="secondary">SMS</Badge>}
                {n.capabilities.mms && <Badge variant="secondary">MMS</Badge>}
              </div>
              <BuyNumberButton phoneNumber={n.phoneNumber} />
            </CardContent>
          </Card>
        ))}
        {numbers.length === 0 && twilioConfigured && (
          <p className="col-span-full text-sm text-muted-foreground">
            No numbers available — try a different area code.
          </p>
        )}
      </div>
    </div>
  );
}
