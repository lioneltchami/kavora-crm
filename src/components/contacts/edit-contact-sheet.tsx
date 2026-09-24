"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getContactEmailsAndPhones, updateContact } from "@/actions/contacts";
import type { Contact } from "@/db/schema";

type Company = { id: string; name: string };
type ChannelType = "work" | "home" | "other";
type EmailRow = { id?: string; email: string; type: ChannelType; isPrimary: boolean };
type PhoneRow = { id?: string; phone: string; type: ChannelType; isPrimary: boolean };

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

const channelSelectClass =
  "flex h-10 w-24 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

const channelOptions: ChannelType[] = ["work", "home", "other"];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function emptyEmailRow(): EmailRow {
  return { email: "", type: "work", isPrimary: false };
}

function emptyPhoneRow(): PhoneRow {
  return { phone: "", type: "work", isPrimary: false };
}

function withPrimary<T extends { isPrimary: boolean }>(rows: T[]): T[] {
  if (rows.length === 0 || rows.some((r) => r.isPrimary)) return rows;
  return rows.map((r, i) => ({ ...r, isPrimary: i === 0 }));
}

export function EditContactSheet({
  contact,
  companies,
}: {
  contact: Contact;
  companies: Company[];
}) {
  const [open, setOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const [emails, setEmails] = useState<EmailRow[]>([emptyEmailRow()]);
  const [phones, setPhones] = useState<PhoneRow[]>([emptyPhoneRow()]);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    getContactEmailsAndPhones(contact.id)
      .then(({ emails: eRows, phones: pRows }) => {
        if (cancelled) return;
        setEmails(
          eRows.length > 0
            ? withPrimary(
                eRows.map((r) => ({
                  id: r.id,
                  email: r.email,
                  type: r.type,
                  isPrimary: r.isPrimary,
                })),
              )
            : [{ email: "", type: "work" as ChannelType, isPrimary: true }],
        );
        setPhones(
          pRows.length > 0
            ? withPrimary(
                pRows.map((r) => ({
                  id: r.id,
                  phone: r.phoneE164,
                  type: r.type,
                  isPrimary: r.isPrimary,
                })),
              )
            : [{ phone: "", type: "work" as ChannelType, isPrimary: true }],
        );
      })
      .catch(() => {
        if (cancelled) return;
        setEmails([{ email: "", type: "work", isPrimary: true }]);
        setPhones([{ phone: "", type: "work", isPrimary: true }]);
      });
    return () => {
      cancelled = true;
    };
  }, [contact.id]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) router.push(`/contacts/${contact.id}`);
  }

  function addEmailRow() {
    setEmails((prev) => [...prev, { email: "", type: "work", isPrimary: false }]);
  }

  function addPhoneRow() {
    setPhones((prev) => [...prev, { phone: "", type: "work", isPrimary: false }]);
  }

  function updateEmail(idx: number, patch: Partial<EmailRow>) {
    setEmails((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function updatePhone(idx: number, patch: Partial<PhoneRow>) {
    setPhones((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function setPrimaryEmail(idx: number) {
    setEmails((prev) => prev.map((r, i) => ({ ...r, isPrimary: i === idx })));
  }

  function setPrimaryPhone(idx: number) {
    setPhones((prev) => prev.map((r, i) => ({ ...r, isPrimary: i === idx })));
  }

  function removeEmail(idx: number) {
    setEmails((prev) => {
      if (prev.length === 1) return prev;
      const next = prev.filter((_, i) => i !== idx);
      if (next[0] && !next.some((r) => r.isPrimary)) {
        next[0] = { ...next[0], isPrimary: true };
      }
      return next;
    });
  }

  function removePhone(idx: number) {
    setPhones((prev) => {
      if (prev.length === 1) return prev;
      const next = prev.filter((_, i) => i !== idx);
      if (next[0] && !next.some((r) => r.isPrimary)) {
        next[0] = { ...next[0], isPrimary: true };
      }
      return next;
    });
  }

  async function onSubmit() {
    const form = document.getElementById("edit-contact-form") as HTMLFormElement | null;
    if (!form) return;
    const fd = new FormData(form);

    const emailRows = emails
      .filter((r) => r.email.trim().length > 0)
      .map((r) => ({ email: r.email.trim(), type: r.type, isPrimary: r.isPrimary }));
    const phoneRows = phones
      .filter((r) => r.phone.trim().length > 0)
      .map((r) => ({ phone: r.phone.trim(), type: r.type, isPrimary: r.isPrimary }));

    fd.set("emails", JSON.stringify(emailRows));
    fd.set("phones", JSON.stringify(phoneRows));

    const primaryEmail = emailRows.find((r) => r.isPrimary)?.email ?? "";
    const primaryPhone = phoneRows.find((r) => r.isPrimary)?.phone ?? "";
    if (primaryEmail) fd.set("email", primaryEmail);
    else fd.delete("email");
    if (primaryPhone) fd.set("phone", primaryPhone);
    else fd.delete("phone");

    setSaving(true);
    try {
      await updateContact(contact.id, fd);
      setOpen(false);
      router.push(`/contacts/${contact.id}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save contact");
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

      <div className="space-y-2 rounded-md border p-3">
        <div className="text-sm font-medium">Emails</div>
        {emails.map((row, i) => {
          const onlyRow = emails.length === 1;
          return (
            <div key={row.id ?? `email-${i}`} className="flex flex-wrap items-center gap-2">
              <Input
                type="text"
                inputMode="email"
                placeholder="name@example.com"
                value={row.email}
                onChange={(e) => updateEmail(i, { email: e.target.value })}
                className="flex-1 min-w-[180px]"
                aria-label={`Email ${i + 1}`}
                disabled={saving}
              />
              <select
                value={row.type}
                onChange={(e) =>
                  updateEmail(i, { type: e.target.value as ChannelType })
                }
                className={channelSelectClass}
                aria-label={`Email ${i + 1} type`}
                disabled={saving}
              >
                {channelOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {capitalize(opt)}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={row.isPrimary || saving}
                onClick={() => setPrimaryEmail(i)}
                title={row.isPrimary ? "Already primary" : "Make primary"}
              >
                {row.isPrimary ? "Primary" : "Make primary"}
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={onlyRow || saving}
                onClick={() => removeEmail(i)}
                title={onlyRow ? "At least one email is required" : "Remove email"}
                aria-label="Remove email"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={addEmailRow}
          disabled={saving}
        >
          <Plus className="mr-1 h-3 w-3" /> Add email
        </Button>
      </div>

      <div className="space-y-2 rounded-md border p-3">
        <div className="text-sm font-medium">Phones</div>
        {phones.map((row, i) => {
          const onlyRow = phones.length === 1;
          return (
            <div key={row.id ?? `phone-${i}`} className="flex flex-wrap items-center gap-2">
              <Input
                type="text"
                inputMode="tel"
                placeholder="+13035551234"
                value={row.phone}
                onChange={(e) => updatePhone(i, { phone: e.target.value })}
                className="flex-1 min-w-[180px]"
                aria-label={`Phone ${i + 1}`}
                disabled={saving}
              />
              <select
                value={row.type}
                onChange={(e) =>
                  updatePhone(i, { type: e.target.value as ChannelType })
                }
                className={channelSelectClass}
                aria-label={`Phone ${i + 1} type`}
                disabled={saving}
              >
                {channelOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {capitalize(opt)}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={row.isPrimary || saving}
                onClick={() => setPrimaryPhone(i)}
                title={row.isPrimary ? "Already primary" : "Make primary"}
              >
                {row.isPrimary ? "Primary" : "Make primary"}
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={onlyRow || saving}
                onClick={() => removePhone(i)}
                title={onlyRow ? "At least one phone is required" : "Remove phone"}
                aria-label="Remove phone"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={addPhoneRow}
          disabled={saving}
        >
          <Plus className="mr-1 h-3 w-3" /> Add phone
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="companyId">Company</Label>
          <select
            id="companyId"
            name="companyId"
            defaultValue={contact.companyId ?? ""}
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
          <Input id="source" name="source" defaultValue={contact.source ?? ""} placeholder="e.g. referral, web" />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="status">Status</Label>
        <select
          id="status"
          name="status"
          defaultValue={contact.status}
          className={selectClass}
        >
          <option value="lead">Lead</option>
          <option value="active">Active</option>
          <option value="customer">Customer</option>
          <option value="archived">Archived</option>
        </select>
      </div>
    </BottomSheet>
  );
}
