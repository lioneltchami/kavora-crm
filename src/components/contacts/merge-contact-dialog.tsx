"use client";

/**
 * TEMPORARY STUB — created by Builder B3 because Builder B1's real
 * `MergeContactDialog` had not landed on origin/main when this commit was made.
 * Parent Mavis will replace this stub with B1's real implementation during
 * the integration commit. Do not ship as-is.
 */

export interface MergeCandidate {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

export function MergeContactDialog(_props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  winner: MergeCandidate;
  onMerged?: () => void;
}): React.ReactElement | null {
  return null;
}