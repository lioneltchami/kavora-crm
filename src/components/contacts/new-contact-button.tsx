"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createContact } from "@/actions/contacts";
import { listCompanies } from "@/actions/companies";

type Company = { id: string; name: string };

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export function NewContactButton() {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listCompanies({ limit: 200 })
      .then((rows) => {
        if (!cancelled) setCompanies(rows.map((c) => ({ id: c.id, name: c.name })));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function onSubmit() {
    const form = document.getElementById("new-contact-form") as HTMLFormElement | null;
    if (!form) return;
    const fd = new FormData(form);
    setSubmitting(true);
    try {
      await createContact(fd);
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create contact");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="mr-1 h-4 w-4" /> New contact
      </Button>
      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title="New contact"
        onSubmit={onSubmit}
        submitLabel={submitting ? "Creating…" : "Create contact"}
        isSubmitting={submitting}
        formId="new-contact-form"
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="firstName">First name</Label>
            <Input id="firstName" name="firstName" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lastName">Last name</Label>
            <Input id="lastName" name="lastName" />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" placeholder="+13035551234" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="companyId">Company</Label>
            <select
              id="companyId"
              name="companyId"
              defaultValue=""
              className={selectClass}
            >
              <option value="">None</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="source">Source</Label>
            <Input id="source" name="source" placeholder="e.g. referral, web" />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="status">Status</Label>
          <select
            id="status"
            name="status"
            defaultValue="lead"
            className={selectClass}
          >
            <option value="lead">Lead</option>
            <option value="active">Active</option>
            <option value="customer">Customer</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </BottomSheet>
    </>
  );
}
