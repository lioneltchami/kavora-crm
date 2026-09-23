"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { saveVoiceStyle } from "@/actions/ai";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

export function VoiceStyleForm({
  initialExamples,
  initialNotes,
}: {
  initialExamples: string[];
  initialNotes: string;
}) {
  const [examples, setExamples] = useState<string[]>(
    initialExamples.length > 0 ? initialExamples : [""],
  );
  const [notes, setNotes] = useState(initialNotes);
  const [saving, setSaving] = useState(false);

  async function onSave() {
    setSaving(true);
    const fd = new FormData();
    examples.filter(Boolean).forEach((e) => fd.append("example", e));
    fd.set("notes", notes);
    try {
      await saveVoiceStyle(fd);
      toast.success("Voice style saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {examples.map((ex, i) => (
        <div key={i} className="flex gap-2">
          <Textarea
            name="example"
            value={ex}
            onChange={(e) => {
              const next = [...examples];
              next[i] = e.target.value;
              setExamples(next);
            }}
            placeholder={`Example ${i + 1}: paste a real email/SMS you've sent`}
            rows={4}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setExamples(examples.filter((_, j) => j !== i))}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setExamples([...examples, ""])}
      >
        <Plus className="mr-1 h-3 w-3" /> Add another example
      </Button>

      <div className="space-y-2">
        <Label htmlFor="notes">Notes for the AI</Label>
        <Textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Always sign off with '— Lionel'. Avoid jargon. Short sentences."
          rows={3}
        />
      </div>

      <Button onClick={onSave} disabled={saving}>
        {saving ? "Saving…" : "Save voice style"}
      </Button>
    </div>
  );
}
