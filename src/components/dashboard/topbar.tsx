import { UserButton } from "@clerk/nextjs";

export function Topbar() {
  return (
    <header className="flex h-14 items-center justify-between border-b bg-background px-4">
      <div className="text-sm text-muted-foreground">Kavora Systems · CRM</div>
      <UserButton afterSignOutUrl="/sign-in" />
    </header>
  );
}
