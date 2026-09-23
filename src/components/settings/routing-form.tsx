"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { updateMyRoutingPhone } from "@/actions/settings";
import { toast } from "sonner";

export function RoutingForm({ initialPhone }: { initialPhone: string }) {
  const [phone, setPhone] = useState(initialPhone);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData(e.currentTarget);
    try {
      await updateMyRoutingPhone(fd);
      toast.success("Routing phone saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex items-end gap-3">
      <div className="flex-1 space-y-1">
        <Label htmlFor="phoneForRouting">Cell (E.164)</Label>
        <Input
          id="phoneForRouting"
          name="phoneForRouting"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+13035551234"
        />
      </div>
      <Button type="submit" disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
