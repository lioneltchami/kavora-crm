"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";
import { sendSmsToContact } from "@/actions/communications";
import { toast } from "sonner";

export function SmsComposer({ contactId }: { contactId: string }) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const router = useRouter();

  async function onSend() {
    if (!body.trim()) return;
    setSending(true);
    try {
      await sendSmsToContact({ contactId, body });
      setBody("");
      router.refresh();
      toast.success("SMS sent");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send SMS");
    } finally {
      setSending(false);
    }
  }

  return (
    <div data-sms-composer className="space-y-2 rounded-md border p-3">
      <Textarea
        placeholder="Type a message…"
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={1600}
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{body.length} / 1600</span>
        <Button size="sm" disabled={!body.trim() || sending} onClick={onSend}>
          <Send className="mr-1 h-3 w-3" /> {sending ? "Sending…" : "Send"}
        </Button>
      </div>
    </div>
  );
}
