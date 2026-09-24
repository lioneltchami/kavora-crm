"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCompany } from "@/actions/companies";

export function NewCompanyButton() {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function onSubmit() {
    const form = document.getElementById("new-company-form") as HTMLFormElement | null;
    if (!form) return;
    const fd = new FormData(form);
    setSaving(true);
    try {
      await createCompany(fd);
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create company");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="mr-1 h-4 w-4" /> New company
      </Button>
      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title="New company"
        onSubmit={onSubmit}
        submitLabel={saving ? "Saving…" : "Create company"}
        isSubmitting={saving}
        formId="new-company-form"
      >
        <div className="space-y-1">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="domain">Domain</Label>
          <Input id="domain" name="domain" placeholder="acme.com" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="industry">Industry</Label>
            <Input id="industry" name="industry" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="size">Size</Label>
            <Input id="size" name="size" placeholder="1-10, 11-50, …" />
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
