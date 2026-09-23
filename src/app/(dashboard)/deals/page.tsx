import { db } from "@/db";
import { deals, pipelines, pipelineStages, KAVORA_ORG_ID, contacts } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { PageHeader } from "@/components/dashboard/page-header";
import { NewDealButton } from "@/components/deals/new-deal-button";
import { KanbanBoard } from "@/components/deals/kanban-board";

export const dynamic = "force-dynamic";

export default async function DealsPage() {
  const pipelineRows = await db
    .select()
    .from(pipelines)
    .where(eq(pipelines.orgId, KAVORA_ORG_ID))
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

  const stages = await db
    .select()
    .from(pipelineStages)
    .where(and(eq(pipelineStages.pipelineId, pipeline.id), eq(pipelineStages.orgId, KAVORA_ORG_ID)))
    .orderBy(asc(pipelineStages.order));

  const dealRows = await db
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
    .leftJoin(contacts, eq(contacts.id, deals.contactId))
    .where(and(eq(deals.orgId, KAVORA_ORG_ID), eq(deals.pipelineId, pipeline.id)));

  return (
    <div>
      <PageHeader
        title="Deals"
        description={`${dealRows.length} deals across ${stages.length} stages. Drag cards between stages to move deals.`}
        actions={<NewDealButton pipelineId={pipeline.id} stages={stages} />}
      />
      <KanbanBoard pipelineId={pipeline.id} stages={stages} deals={dealRows} />
    </div>
  );
}
