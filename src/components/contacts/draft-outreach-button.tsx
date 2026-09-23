"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { draftOutreachAction } from "@/actions/ai";
import { toast } from "sonner";
import type { MultiDraftResult } from "@/lib/ai/draft";

type DraftState = (MultiDraftResult & { ok: true }) | null;

export function DraftOutreachButton({ contactId }: { contactId: string }) {
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState("");
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [result, setResult] = useState<DraftState>(null);
  const [loading, setLoading] = useState(false);

  async function onGenerate() {
    if (!intent.trim()) return;
    setLoading(true);
    try {
      const r = await draftOutreachAction({ contactId, intent, channel });
      if (r.ok) setResult(r);
      else toast.error("AI not configured — set ANTHROPIC_API_KEY in .env");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to draft");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <Sparkles className="mr-1 h-3 w-3" /> Draft outreach
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>AI outreach draft</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Channel</Label>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={channel === "email" ? "default" : "outline"}
                onClick={() => setChannel("email")}
              >
                Email
              </Button>
              <Button
                size="sm"
                variant={channel === "sms" ? "default" : "outline"}
                onClick={() => setChannel("sms")}
              >
                SMS
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="intent">What's the goal?</Label>
            <Input
              id="intent"
              placeholder="e.g. follow up about the AI audit proposal"
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
            />
          </div>
          <Button onClick={onGenerate} disabled={!intent.trim() || loading} className="w-full">
            {loading ? "Generating…" : "Generate drafts"}
          </Button>

          {result && result.candidates.length > 0 && (
            <div className="space-y-3 pt-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Candidates ({result.channel})
              </div>
              {result.candidates.map((c, i) => (
                <div key={i} className="rounded-md border bg-muted/30 p-3 text-sm">
                  <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-medium">Candidate {i + 1}</span>
                    <span>{c.rationale}</span>
                  </div>
                  <p className="whitespace-pre-wrap">{c.body}</p>
                </div>
              ))}

              {result.retrievedSnippets.length > 0 && (
                <div className="rounded-md border bg-background p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Why I picked this ({result.retrievedSnippets.length} past conversations)
                  </div>
                  <ol className="space-y-2 text-xs">
                    {result.retrievedSnippets.map((s, i) => (
                      <li key={s.id} className="rounded-md bg-muted p-2">
                        <span className="font-medium">
                          [{i + 1}] {s.sourceType} · similarity {s.similarity.toFixed(2)}
                        </span>
                        <p className="mt-1 text-muted-foreground">{s.snippet}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
