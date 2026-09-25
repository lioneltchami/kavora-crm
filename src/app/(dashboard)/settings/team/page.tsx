import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RoutingForm } from "@/components/settings/routing-form";
import { formatPhoneForDisplay } from "@/lib/phone";
import { requireDbUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function TeamSettingsPage() {
  const { ctx, dbRow } = await requireDbUser();
  const team = await db.select().from(users).where(eq(users.orgId, ctx.orgId));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        description="Invite teammates and set your inbound-call routing phone."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your routing phone</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            When your Twilio number receives a call, we dial each team member who has a routing
            phone set. Calls go to whoever picks up first; if nobody answers, the caller hears a
            voicemail.
          </p>
          <RoutingForm initialPhone={dbRow.phoneForRouting ?? ""} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Team members</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            {team.map((u) => (
              <div key={u.id} className="flex items-center justify-between py-3 text-sm">
                <div>
                  <p className="font-medium">{u.name ?? u.email}</p>
                  <p className="text-xs text-muted-foreground">{u.email}</p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-muted-foreground">
                    Routes: {formatPhoneForDisplay(u.phoneForRouting)}
                  </span>
                  <span className="rounded bg-muted px-2 py-1 font-medium uppercase">{u.role}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Invite teammates via{" "}
            <a href="https://dashboard.clerk.com" className="underline">
              Clerk dashboard
            </a>
            . New users are auto-synced into this list via webhook.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
