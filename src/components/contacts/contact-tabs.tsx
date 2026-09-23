"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { ReactNode } from "react";

/**
 * Tab strip whose active value is mirrored to the `?tab=` URL param so other
 * client components (like ContactActions' "SMS" button) can drive it without
 * prop-drilling or shared context.
 *
 * Children are the four `<TabsContent>` blocks for timeline / sms / notes / deals.
 */
export function ContactTabs({
  defaultValue,
  children,
}: {
  defaultValue: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // The URL is the source of truth. The default is whatever the server rendered
  // with; subsequent updates from ContactActions (?tab=sms) refresh the page
  // and re-read the param here.
  const value = searchParams.get("tab") ?? defaultValue;

  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("tab", next);
        router.replace(`?${params.toString()}`, { scroll: false });
      }}
    >
      {children}
    </Tabs>
  );
}

export { TabsList, TabsTrigger, TabsContent };
