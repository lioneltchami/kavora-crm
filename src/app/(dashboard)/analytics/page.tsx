import { db } from "@/db";
import { calls, smsMessages, deals, contacts, KAVORA_ORG_ID } from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const [callsAgg, smsAgg, dealsAgg, contactsAgg] = await Promise.all([
    db
      .select({
        count: sql<number>`COUNT(*)::int`,
        duration: sql<number>`COALESCE(SUM(${calls.durationSeconds}), 0)::int`,
      })
      .from(calls)
      .where(and(eq(calls.orgId, KAVORA_ORG_ID), gte(calls.createdAt, since30))),
    db
      .select({
        count: sql<number>`COUNT(*)::int`,
        inbound: sql<number>`SUM(CASE WHEN ${smsMessages.direction} = 'inbound' THEN 1 ELSE 0 END)::int`,
      })
      .from(smsMessages)
      .where(and(eq(smsMessages.orgId, KAVORA_ORG_ID), gte(smsMessages.createdAt, since30))),
    db
      .select({
        open: sql<number>`SUM(CASE WHEN ${deals.status} = 'open' THEN 1 ELSE 0 END)::int`,
        won: sql<number>`SUM(CASE WHEN ${deals.status} = 'won' THEN 1 ELSE 0 END)::int`,
        lost: sql<number>`SUM(CASE WHEN ${deals.status} = 'lost' THEN 1 ELSE 0 END)::int`,
        valueWonCents: sql<number>`COALESCE(SUM(CASE WHEN ${deals.status} = 'won' THEN ${deals.valueCents} ELSE 0 END), 0)::int`,
      })
      .from(deals)
      .where(eq(deals.orgId, KAVORA_ORG_ID)),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(contacts)
      .where(eq(contacts.orgId, KAVORA_ORG_ID)),
  ]);

  const stats = {
    contacts: contactsAgg[0]?.count ?? 0,
    calls30d: callsAgg[0]?.count ?? 0,
    callMinutes30d: Math.round(((callsAgg[0]?.duration ?? 0) / 60) * 10) / 10,
    sms30d: smsAgg[0]?.count ?? 0,
    smsInbound30d: smsAgg[0]?.inbound ?? 0,
    openDeals: dealsAgg[0]?.open ?? 0,
    wonDeals: dealsAgg[0]?.won ?? 0,
    lostDeals: dealsAgg[0]?.lost ?? 0,
    wonValueCents: dealsAgg[0]?.valueWonCents ?? 0,
  };

  const winRate =
    stats.wonDeals + stats.lostDeals > 0
      ? Math.round((stats.wonDeals / (stats.wonDeals + stats.lostDeals)) * 100)
      : 0;

  const tiles = [
    { label: "Contacts", value: stats.contacts.toLocaleString() },
    { label: "Calls (30d)", value: `${stats.calls30d} · ${stats.callMinutes30d} min` },
    { label: "SMS (30d)", value: `${stats.sms30d} (${stats.smsInbound30d} inbound)` },
    {
      label: "Won value",
      value: (stats.wonValueCents / 100).toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
      }),
    },
    { label: "Open deals", value: stats.openDeals.toLocaleString() },
    { label: "Win rate", value: `${winRate}%` },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" description="Last 30 days. AI cost dashboard coming in Phase 5." />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">{t.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{t.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
