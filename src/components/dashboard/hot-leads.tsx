"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type HotLead = {
  contactId: string;
  score: number;
  rationale: string;
  scoredAt: Date;
  firstName: string | null;
  lastName: string | null;
};

function bucket(score: number): "hot" | "warm" | "cold" {
  if (score >= 75) return "hot";
  if (score >= 50) return "warm";
  return "cold";
}

export function HotLeads({ leads }: { leads: HotLead[] }) {
  return (
    <TooltipProvider delayDuration={200}>
      {leads.map((h) => {
        const name = [h.firstName, h.lastName].filter(Boolean).join(" ") || "Unknown";
        const b = bucket(h.score);
        return (
          <div
            key={h.contactId}
            className="flex items-center justify-between gap-4 rounded-md border p-3"
          >
            <div className="flex-1">
              <Link
                href={`/contacts/${h.contactId}`}
                className="text-sm font-medium hover:underline"
              >
                {name}
              </Link>
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="mt-1 cursor-help text-xs text-muted-foreground">
                    Hover for AI rationale · scored{" "}
                    {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(h.scoredAt)}
                  </p>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="max-w-xs">{h.rationale}</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <Badge
              variant={
                b === "hot" ? "destructive" : b === "warm" ? "warning" : "secondary"
              }
            >
              {b === "hot" ? "🔥" : b === "warm" ? "↗" : "·"} {h.score}
            </Badge>
          </div>
        );
      })}
    </TooltipProvider>
  );
}
