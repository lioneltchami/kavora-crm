"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { updateContact } from "@/actions/contacts";
import type { Contact } from "@/db/schema";

type Company = { id: string; name: string };

export function EditContactSheet({
  contact,
  companies,
}: {
  contact: Contact;
  companies: Company[];
}) {
  const [open, setOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) router.push(`/contacts/${contact.id}`);
  }

  async function onSubmit() {
    const form = document.getElementById("edit-contact-form") as HTMLFormElement | null;
    if (!form) return;
    const fd = new FormData(form);
    setSaving(true);
    try {
      await updateContact(contact.id, fd);
      setOpen(false);
      router.push(`/contacts/${contact.id}`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ");

  return (
    <BottomSheet
      open={open}
      onOpenChange={handleOpenChange}
      title={fullName ? `Edit ${fullName}` : "Edit contact"}
      onSubmit={onSubmit}
      submitLabel={saving ? "Saving…" : "Save changes"}
      isSubmitting={saving}
      formId="edit-contact-form"
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="firstName">First name</Label>
          <Input id="firstName" name="firstName" defaultValue={contact.firstName} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lastName">Last name</Label>
          <Input id="lastName" name="lastName" defaultValue={contact.lastName ?? ""} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="phone">Phone (E.164 OK)</Label>
        <Input id="phone" name="phone" defaultValue={contact.phone ?? ""} placeholder="+13035551234" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" defaultValue={contact.email ?? ""} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="companyId">Company</Label>
          <Select name="companyId" defaultValue={contact.companyId ?? undefined}>
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
          <Input id="source" name="source" defaultValue={contact.source ?? ""} placeholder="e.g. referral, web" />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="status">Status</Label>
        <Select name="status" defaultValue={contact.status}>
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
  );
}
