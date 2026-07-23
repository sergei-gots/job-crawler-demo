import { cn } from "@/shared/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  PENDING: "border-border text-muted-foreground",
  RUNNING: "border-border text-foreground",
  COMPLETED: "border-border text-foreground",
  FAILED: "border-destructive text-destructive",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "rounded-lg border px-2 py-0.5 text-xs font-medium",
        STATUS_STYLES[status] ?? "border-border text-foreground",
      )}
    >
      {status}
    </span>
  );
}
