"use client";

import { useEffect, useState } from "react";

export function RecordingPlayer({ callId }: { callId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/twilio/recording-url?callId=${callId}`);
        if (!res.ok) return;
        const json = (await res.json()) as { url: string };
        if (!cancelled) setUrl(json.url);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [callId]);

  if (loading) return <p className="text-xs text-muted-foreground">Loading recording…</p>;
  if (!url) return <p className="text-xs text-muted-foreground">No recording available.</p>;

  return (
    <audio controls preload="metadata" className="w-full" src={url}>
      Your browser does not support audio playback.
    </audio>
  );
}
