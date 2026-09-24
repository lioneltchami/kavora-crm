"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createContact } from "@/actions/contacts";
import { listCompanies } from "@/actions/companies";

type Company = { id: string; name: string };

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
          <Label htmlFor="phone">Phone (E.164 OK)</Label>
          <Input id="phone" name="phone" placeholder="+13035551234" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="companyId">Company</Label>
            <Select name="companyId">
              <SelectTrigger id="companyId">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="source">Source</Label>
            <Input id="source" name="source" placeholder="e.g. referral, web" />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="status">Status</Label>
          <Select name="status" defaultValue="lead">
            <SelectTrigger id="status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="lead">Lead</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="customer">Customer</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </BottomSheet>
    </>
  );
}
