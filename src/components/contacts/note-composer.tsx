"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { createNote } from "@/actions/notes";

export function NoteComposer({ contactId }: { contactId: string }) {
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function onSave() {
    if (!body.trim()) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.set("contactId", contactId);
      fd.set("body", body);
      await createNote(fd);
      setBody("");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <Textarea
        placeholder="Add a note…"
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex justify-end">
        <Button size="sm" disabled={!body.trim() || saving} onClick={onSave}>
          {saving ? "Saving…" : "Save note"}
        </Button>
      </div>
    </div>
  );
}
