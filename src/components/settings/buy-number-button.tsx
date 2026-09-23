"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { buyPhoneNumber } from "@/actions/settings";
import { toast } from "sonner";

export function BuyNumberButton({ phoneNumber }: { phoneNumber: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function onBuy() {
    setBusy(true);
    try {
      await buyPhoneNumber({ phoneNumber });
      toast.success("Number purchased and wired up");
      router.push("/settings/phone-numbers");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not purchase");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button onClick={onBuy} disabled={busy} size="sm" className="w-full">
      {busy ? "Buying…" : "Buy this number"}
    </Button>
  );
}
