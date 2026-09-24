"use client";

import { useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import Link from "next/link";
import type { Deal, PipelineStage } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import { moveDealStage } from "@/actions/deals";
import { toast } from "sonner";

type DealCard = {
  id: string;
  title: string;
  valueCents: number;
  currency: string;
  status: Deal["status"];
  stageId: string;
  contactName: string | null;
  contactLastName: string | null;
  contactId: string | null;
};

export function KanbanBoard({
  stages,
  deals,
}: {
  stages: PipelineStage[];
  deals: DealCard[];
}) {
  const [, startTransition] = useTransition();
  const [active, setActive] = useState<DealCard | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function onDragStart(e: DragStartEvent) {
    const deal = deals.find((d) => d.id === e.active.id);
    if (deal) setActive(deal);
  }

  function onDragEnd(e: DragEndEvent) {
    setActive(null);
    if (!e.over) return;
    const dealId = String(e.active.id);
    const toStageId = String(e.over.id);
    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stageId === toStageId) return;
    startTransition(async () => {
      try {
        await moveDealStage({ dealId, toStageId });
        toast.success(`Moved to ${stages.find((s) => s.id === toStageId)?.name}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not move deal");
      }
    });
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(220px, 1fr))` }}>
        {stages.map((s) => {
          const inStage = deals.filter((d) => d.stageId === s.id);
          return (
            <StageColumn key={s.id} stage={s} deals={inStage} />
          );
        })}
      </div>
      <DragOverlay>
        {active ? (
          <div className="rounded-md border bg-background p-3 text-sm shadow-lg">
            <div className="font-medium">{active.title}</div>
            <div className="text-xs text-muted-foreground">
              {(active.valueCents / 100).toLocaleString("en-US", {
                style: "currency",
                currency: active.currency,
              })}
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function StageColumn({
  stage,
  deals,
}: {
  stage: PipelineStage;
  deals: DealCard[];
}) {
  const { isOver, setNodeRef } = useDroppable({ id: stage.id });
  const totalsByCurrency = new Map<string, number>();
  for (const d of deals) {
    totalsByCurrency.set(d.currency, (totalsByCurrency.get(d.currency) ?? 0) + d.valueCents);
  }

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col rounded-lg border bg-muted/20 p-3 transition-colors ${
        isOver ? "ring-2 ring-primary" : ""
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: stage.color ?? "#94a3b8" }}
          />
          {stage.name}
        </div>
        <Badge variant="outline">{deals.length}</Badge>
      </div>
      {totalsByCurrency.size > 0 ? (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {[...totalsByCurrency.entries()].map(([currency, cents]) => (
            <span key={currency}>
              {(cents / 100).toLocaleString("en-US", { style: "currency", currency })}
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-2 space-y-2">
        {deals.map((d) => (
          <DealCard key={d.id} deal={d} />
        ))}
        {deals.length === 0 && (
          <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
            Drop deals here
          </p>
        )}
      </div>
    </div>
  );
}

function DealCard({ deal }: { deal: DealCard }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: deal.id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="cursor-grab rounded-md border bg-background p-3 text-sm shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing"
    >
      <div className="font-medium">
        <Link href={`/deals/${deal.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
          {deal.title}
        </Link>
      </div>
      <div className="mt-1 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {(deal.valueCents / 100).toLocaleString("en-US", {
            style: "currency",
            currency: deal.currency,
          })}
        </span>
        {deal.contactName && (
          <span className="text-muted-foreground">
            {[deal.contactName, deal.contactLastName].filter(Boolean).join(" ")}
          </span>
        )}
      </div>
    </div>
  );
}
