"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createDeal } from "@/actions/deals";
import type { PipelineStage } from "@/db/schema";

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export function NewDealButton({
  pipelineId,
  stages,
}: {
  pipelineId: string;
  stages: PipelineStage[];
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const firstOpenStage = stages.find((s) => !s.isWon && !s.isLost);

  async function onSubmit() {
    const form = document.getElementById("new-deal-form") as HTMLFormElement | null;
    if (!form) return;
    const fd = new FormData(form);
    setSaving(true);
    try {
      await createDeal(fd);
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="mr-1 h-4 w-4" /> New deal
      </Button>
      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title="New deal"
        onSubmit={onSubmit}
        submitLabel={saving ? "Creating…" : "Create deal"}
        isSubmitting={saving}
        formId="new-deal-form"
      >
        <input type="hidden" name="pipelineId" value={pipelineId} />
        <input type="hidden" name="currency" value="USD" />
        <div className="space-y-1">
          <Label htmlFor="title">Title</Label>
          <Input id="title" name="title" required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="valueCents">Value (cents)</Label>
            <Input id="valueCents" name="valueCents" type="number" defaultValue={0} min={0} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="stageId">Stage</Label>
            <select
              id="stageId"
              name="stageId"
              defaultValue={firstOpenStage?.id ?? ""}
              className={selectClass}
            >
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
