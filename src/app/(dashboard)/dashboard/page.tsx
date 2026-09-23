import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Phone, MessageSquare, Users, Briefcase } from "lucide-react";
import { db } from "@/db";
import {
  calls,
  contacts,
  deals,
  KAVORA_ORG_ID,
  smsMessages,
  leadScores,
} from "@/db/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { HotLeads } from "@/components/dashboard/hot-leads";

export const dynamic = "force-dynamic";

async function getStats() {
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [contactsTotal, dealsOpen, callsWeek, smsWeek, hot] = await Promise.all([
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(contacts)
      .where(eq(contacts.orgId, KAVORA_ORG_ID)),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(deals)
      .where(and(eq(deals.orgId, KAVORA_ORG_ID), eq(deals.status, "open"))),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(calls)
      .where(and(eq(calls.orgId, KAVORA_ORG_ID), gte(calls.createdAt, since))),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(smsMessages)
      .where(and(eq(smsMessages.orgId, KAVORA_ORG_ID), gte(smsMessages.createdAt, since))),
    // Hot leads — order DESC, fetch the highest-scoring contacts and join names.
    db
      .select({
        contactId: leadScores.contactId,
        score: leadScores.score,
        rationale: leadScores.rationale,
        scoredAt: leadScores.scoredAt,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
      })
      .from(leadScores)
      .innerJoin(contacts, eq(contacts.id, leadScores.contactId))
      .where(eq(leadScores.orgId, KAVORA_ORG_ID))
      .orderBy(desc(leadScores.score), desc(leadScores.scoredAt))
      .limit(5),
  ]);
  return {
    contactsTotal: contactsTotal[0]?.count ?? 0,
    dealsOpen: dealsOpen[0]?.count ?? 0,
    callsWeek: callsWeek[0]?.count ?? 0,
    smsWeek: smsWeek[0]?.count ?? 0,
    hotLeads: hot,
  };
}

export default async function DashboardPage() {
  const stats = await getStats();

  const tiles = [
    { label: "Contacts", value: stats.contactsTotal, icon: Users, href: "/contacts" },
    { label: "Open deals", value: stats.dealsOpen, icon: Briefcase, href: "/deals" },
    { label: "Calls (7d)", value: stats.callsWeek, icon: Phone, href: "/calls" },
    { label: "SMS (7d)", value: stats.smsWeek, icon: MessageSquare, href: "/inbox" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Your Kavora CRM at a glance. Click any tile for details.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <Link key={t.label} href={t.href}>
              <Card className="transition-colors hover:bg-secondary/30">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {t.label}
                  </CardTitle>
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{t.value}</div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hot leads</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {stats.hotLeads.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No scores yet — the weekly lead-scoring cron runs every Sunday.
              </p>
            ) : (
              <HotLeads
                leads={stats.hotLeads.map((h) => ({
                  contactId: h.contactId,
                  score: h.score,
                  rationale: h.rationale,
                  scoredAt: h.scoredAt,
                  firstName: h.firstName,
                  lastName: h.lastName,
                }))}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Getting started</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <strong>1.</strong> Buy a Twilio phone number in{" "}
              <Link href="/settings/phone-numbers" className="underline">
                Settings → Phone numbers
              </Link>
              .
            </p>
            <p>
              <strong>2.</strong> Set your cell as the inbound routing target in{" "}
              <Link href="/settings/team" className="underline">
                Settings → Team
              </Link>
              .
            </p>
            <p>
              <strong>3.</strong> Configure AI providers (Anthropic, Deepgram, Voyage) and paste a few
              past emails/SMS as voice examples in{" "}
              <Link href="/settings/ai" className="underline">
                Settings → AI style
              </Link>
              .
            </p>
            <p>
              <strong>4.</strong> Add your first contact in{" "}
              <Link href="/contacts" className="underline">
                Contacts
              </Link>{" "}
              and call it from the contact page.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
