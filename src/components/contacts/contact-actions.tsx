"use client";

import { Phone, MessageSquare, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startOutboundCall } from "@/actions/communications";
import { toast } from "sonner";

export function ContactActions({ contactId, phone }: { contactId: string; phone: string | null }) {
  const disabled = !phone;

  async function onCall() {
    try {
      const result = await startOutboundCall({ contactId });
      toast.success(`Call placed — agent's cell is ringing. SID ${result.sid.slice(0, 10)}…`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not place call");
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
        onClick={() => {
          const el = document.querySelector<HTMLTextAreaElement>("[data-sms-composer] textarea");
          el?.focus();
        }}
      >
        <MessageSquare className="mr-1 h-4 w-4" /> SMS
      </Button>
      <Button variant="ghost" size="icon">
        <MoreVertical className="h-4 w-4" />
      </Button>
    </div>
  );
}
