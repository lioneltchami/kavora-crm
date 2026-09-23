import { formatDistanceToNow as fnsDistance } from "date-fns";

export function formatDistanceToNow(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return fnsDistance(date, { addSuffix: true });
}
