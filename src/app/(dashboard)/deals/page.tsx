import { db } from "@/db";
import { deals, pipelines, pipelineStages, contacts } from "@/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import { PageHeader } from "@/components/dashboard/page-header";
import { NewDealButton } from "@/components/deals/new-deal-button";
import { KanbanBoard } from "@/components/deals/kanban-board";
import { requireDbUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const KANBAN_DEAL_LIMIT = 500;

export default async function DealsPage() {
  const { ctx } = await requireDbUser();
  const pipelineRows = await db
    .select()
    .from(pipelines)
    .where(eq(pipelines.orgId, ctx.orgId))
    .limit(1);
  const pipeline = pipelineRows[0];
  if (!pipeline) {
    return (
      <div>
        <PageHeader title="Deals" />
        <p className="text-sm text-muted-foreground">No pipeline configured. Run the seed migration.</p>
      </div>
    );
  }

  const [stages, dealRows] = await Promise.all([
    db
      .select()
      .from(pipelineStages)
      .where(and(eq(pipelineStages.pipelineId, pipeline.id), eq(pipelineStages.orgId, ctx.orgId)))
      .orderBy(asc(pipelineStages.order)),
    db
      .select({
        id: deals.id,
        title: deals.title,
        valueCents: deals.valueCents,
        currency: deals.currency,
        status: deals.status,
        stageId: deals.stageId,
        contactName: contacts.firstName,
        contactLastName: contacts.lastName,
        contactId: contacts.id,
      })
      .from(deals)
      .leftJoin(
        contacts,
        and(eq(contacts.id, deals.contactId), isNull(contacts.deletedAt)),
      )
      .where(and(eq(deals.orgId, ctx.orgId), eq(deals.pipelineId, pipeline.id)))
      .orderBy(asc(deals.createdAt))
      .limit(KANBAN_DEAL_LIMIT),
  ]);

  return (
    <div>
      <PageHeader
        title="Deals"
        description={`${dealRows.length}${dealRows.length === KANBAN_DEAL_LIMIT ? "+" : ""} deals across ${stages.length} stages. Drag cards between stages to move deals.`}
        actions={<NewDealButton pipelineId={pipeline.id} stages={stages} />}
      />
      <KanbanBoard stages={stages} deals={dealRows} />
    </div>
  );
}
