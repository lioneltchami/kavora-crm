"use client";

import { GitMerge, MessageSquare, MoreVertical, Pencil, Phone, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { startOutboundCall } from "@/actions/communications";
import { softDeleteContact, restoreContact } from "@/actions/contacts";
import { undoable } from "@/lib/undoable";
import { MergeContactDialog } from "@/components/contacts/merge-contact-dialog";

export function ContactActions({
  contactId,
  phone,
  firstName,
  lastName,
  email,
}: {
  contactId: string;
  phone: string | null;
  firstName?: string;
  lastName?: string | null;
  email?: string | null;
}) {
  const disabled = !phone;
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);

  async function onCall() {
    try {
      const result = await startOutboundCall({ contactId });
      toast.success(`Call placed — agent's cell is ringing. SID ${result.sid.slice(0, 10)}…`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not place call");
    }
  }

  async function onDelete() {
    try {
      await undoable({
        message: "Contact deleted",
        perform: () => softDeleteContact(contactId),
        undo: () => restoreContact(contactId),
        type: "success",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete contact");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" disabled={disabled} onClick={onCall}>
        <Phone className="mr-1 h-4 w-4" /> Call
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => router.push(`/contacts/${contactId}?tab=sms`)}
      >
        <MessageSquare className="mr-1 h-4 w-4" /> SMS
      </Button>
      <div className="relative">
        <Button variant="ghost" size="icon" onClick={() => setMenuOpen((v) => !v)} aria-label="More actions">
          <MoreVertical className="h-4 w-4" />
        </Button>
        {menuOpen && (
          <div
            className="absolute right-0 z-10 mt-1 w-44 rounded-md border bg-background py-1 shadow-md"
            onMouseLeave={() => setMenuOpen(false)}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => {
                setMenuOpen(false);
                router.push(`/contacts/${contactId}/edit`);
              }}
            >
              <Pencil className="h-4 w-4" /> Edit contact
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => {
                setMenuOpen(false);
                setMergeOpen(true);
              }}
            >
              <GitMerge className="h-4 w-4" /> Merge with…
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-red-600 hover:bg-muted"
              onClick={() => {
                setMenuOpen(false);
                void onDelete();
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete contact
            </button>
          </div>
        )}
      </div>
      <MergeContactDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        winner={{
          id: contactId,
          firstName: firstName ?? null,
          lastName: lastName ?? null,
          email: email ?? null,
        }}
        onMerged={() => {
          toast.success("Contacts merged");
          router.push(`/contacts/${contactId}`);
        }}
      />
    </div>
  );
}