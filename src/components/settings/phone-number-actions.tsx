"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { releasePhoneNumber } from "@/actions/settings";
import { toast } from "sonner";

export function PhoneNumberActions({
  id,
  status,
}: {
  id: string;
  status: "active" | "released";
}) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function onRelease() {
    if (!confirm("Release this number from Twilio? Inbound calls/SMS will stop.")) return;
    setBusy(true);
    try {
      await releasePhoneNumber(id);
      toast.success("Number released");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (status === "released") {
    return <Button variant="outline" size="sm" disabled>Released</Button>;
  }
  return (
    <Button variant="outline" size="sm" onClick={onRelease} disabled={busy}>
      {busy ? "Releasing…" : "Release number"}
    </Button>
  );
}
