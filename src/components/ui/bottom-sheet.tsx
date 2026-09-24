"use client";

import type { ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

export interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  onSubmit: () => void | Promise<void>;
  submitLabel?: string;
  isSubmitting?: boolean;
  submitDisabled?: boolean;
  formId: string;
}

export function BottomSheet({
  open,
  onOpenChange,
  title,
  children,
  onSubmit,
  submitLabel = "Save",
  isSubmitting = false,
  submitDisabled,
  formId,
}: BottomSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-dvh flex flex-col"
        aria-describedby={undefined}
      >
        <SheetHeader className="border-b">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <form
          id={formId}
          onSubmit={async (e) => {
            e.preventDefault();
            await onSubmit();
          }}
          className="flex-1 overflow-y-auto flex flex-col gap-3 p-4"
        >
          {children}
        </form>
        <SheetFooter className="border-t flex flex-row w-full gap-4">
          <Button
            type="button"
            variant="outline"
            className="flex-1 h-12"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={isSubmitting || submitDisabled}
            className="flex-1 h-12"
          >
            {submitLabel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
