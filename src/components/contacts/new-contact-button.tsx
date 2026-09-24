"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createContact } from "@/actions/contacts";
import { listCompanies } from "@/actions/companies";
import { toE164 } from "@/lib/phone";

type Company = { id: string; name: string };
type ChannelType = "work" | "home" | "other";
type EmailRow = { email: string; type: ChannelType; isPrimary: boolean };
type PhoneRow = { phone: string; type: ChannelType; isPrimary: boolean };

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

const channelSelectClass =
  "flex h-10 w-24 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

const channelOptions: ChannelType[] = ["work", "home", "other"];

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(value: string): boolean {
  return emailRe.test(value.trim());
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function NewContactButton() {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [emails, setEmails] = useState<EmailRow[]>([
    { email: "", type: "work", isPrimary: true },
  ]);
  const [phones, setPhones] = useState<PhoneRow[]>([
    { phone: "", type: "work", isPrimary: true },
  ]);
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

  const emailErrors = useMemo(() => {
    const ee: Record<number, string> = {};
    emails.forEach((r, i) => {
      if (r.email.trim().length > 0 && !isValidEmail(r.email)) {
        ee[i] = "Invalid email format";
      }
    });
    return ee;
  }, [emails]);

  const phoneErrors = useMemo(() => {
    const pe: Record<number, string> = {};
    phones.forEach((r, i) => {
      if (r.phone.trim().length > 0 && !toE164(r.phone)) {
        pe[i] = "Invalid phone number";
      }
    });
    return pe;
  }, [phones]);

  const formInvalid =
    Object.keys(emailErrors).length > 0 || Object.keys(phoneErrors).length > 0;

  async function onSubmit() {
    if (formInvalid) return;
    const form = document.getElementById("new-contact-form") as HTMLFormElement | null;
    if (!form) return;
    const fd = new FormData(form);
    fd.set(
      "emails",
      JSON.stringify(
        emails
          .filter((e) => e.email.trim().length > 0)
          .map((e) => ({
            email: e.email.trim(),
            type: e.type,
            isPrimary: e.isPrimary,
          })),
      ),
    );
    fd.set(
      "phones",
      JSON.stringify(
        phones
          .filter((p) => p.phone.trim().length > 0)
          .map((p) => ({
            phone: p.phone.trim(),
            type: p.type,
            isPrimary: p.isPrimary,
          })),
      ),
    );
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

  function setEmailPrimary(idx: number) {
    setEmails((prev) => prev.map((r, i) => ({ ...r, isPrimary: i === idx })));
  }
  function setPhonePrimary(idx: number) {
    setPhones((prev) => prev.map((r, i) => ({ ...r, isPrimary: i === idx })));
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
        submitDisabled={formInvalid}
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

        <div className="space-y-2 rounded-md border p-3">
          <div className="text-sm font-medium">Emails</div>
          {emails.length === 0 ? (
            <p className="text-xs text-muted-foreground">No emails added.</p>
          ) : null}
          {emails.map((row, i) => {
            const onlyRow = emails.length === 1;
            return (
              <div key={i} className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="text"
                    inputMode="email"
                    placeholder="name@example.com"
                    value={row.email}
                    onChange={(e) => updateEmail(i, { email: e.target.value })}
                    className="flex-1 min-w-[180px]"
                    aria-label={`Email ${i + 1}`}
                    aria-invalid={!!emailErrors[i]}
                  />
                  <select
                    value={row.type}
                    onChange={(e) =>
                      updateEmail(i, { type: e.target.value as ChannelType })
                    }
                    className={channelSelectClass}
                    aria-label={`Email ${i + 1} type`}
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
                    disabled={row.isPrimary}
                    onClick={() => setEmailPrimary(i)}
                    title={row.isPrimary ? "Already primary" : "Make primary"}
                    aria-pressed={row.isPrimary}
                  >
                    {row.isPrimary ? "Primary" : "Make primary"}
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={onlyRow}
                    onClick={() => removeEmail(i)}
                    title={onlyRow ? "Primary email can't be removed" : "Remove email"}
                    aria-label="Remove email"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {emailErrors[i] ? (
                  <p className="text-xs text-red-600" role="alert">
                    {emailErrors[i]}
                  </p>
                ) : null}
              </div>
            );
          })}
          <Button type="button" size="sm" variant="outline" onClick={addEmailRow}>
            <Plus className="mr-1 h-3 w-3" /> Add email
          </Button>
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <div className="text-sm font-medium">Phones</div>
          {phones.length === 0 ? (
            <p className="text-xs text-muted-foreground">No phones added.</p>
          ) : null}
          {phones.map((row, i) => {
            const onlyRow = phones.length === 1;
            return (
              <div key={i} className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="text"
                    inputMode="tel"
                    placeholder="+13035551234"
                    value={row.phone}
                    onChange={(e) => updatePhone(i, { phone: e.target.value })}
                    className="flex-1 min-w-[180px]"
                    aria-label={`Phone ${i + 1}`}
                    aria-invalid={!!phoneErrors[i]}
                  />
                  <select
                    value={row.type}
                    onChange={(e) =>
                      updatePhone(i, { type: e.target.value as ChannelType })
                    }
                    className={channelSelectClass}
                    aria-label={`Phone ${i + 1} type`}
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
                    disabled={row.isPrimary}
                    onClick={() => setPhonePrimary(i)}
                    title={row.isPrimary ? "Already primary" : "Make primary"}
                    aria-pressed={row.isPrimary}
                  >
                    {row.isPrimary ? "Primary" : "Make primary"}
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={onlyRow}
                    onClick={() => removePhone(i)}
                    title={onlyRow ? "Primary phone can't be removed" : "Remove phone"}
                    aria-label="Remove phone"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {phoneErrors[i] ? (
                  <p className="text-xs text-red-600" role="alert">
                    {phoneErrors[i]}
                  </p>
                ) : null}
              </div>
            );
          })}
          <Button type="button" size="sm" variant="outline" onClick={addPhoneRow}>
            <Plus className="mr-1 h-3 w-3" /> Add phone
          </Button>
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
