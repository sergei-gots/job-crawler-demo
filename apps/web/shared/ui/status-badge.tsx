import { cn } from "@/shared/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  PENDING: "border-border text-muted-foreground",
  RUNNING: "border-border text-foreground",
  COMPLETED: "border-border text-foreground",
  FAILED: "border-destructive text-destructive",
  STOPPED: "border-border text-muted-foreground",
  // Not a real CrawlRun status — shown instead of a run status for an inactive listing/source
  // (see entities/source's DisplayStatus), same neutral/no-fill treatment as PENDING.
  INACTIVE: "border-border text-muted-foreground",
};

// PENDING has no icon (nothing has happened yet). RUNNING gets an animated spinner instead of a
// static emoji, since it's the one status that's actually still in progress.
const STATUS_ICONS: Partial<Record<string, string>> = {
  COMPLETED: "✅",
  STOPPED: "⛔", // the "no entry" road sign — the Russian "кирпич" ("brick") slang term
  FAILED: "❌",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const icon = STATUS_ICONS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-medium",
        STATUS_STYLES[status] ?? "border-border text-foreground",
        className,
      )}
    >
      {status}
      {status === "RUNNING" && (
        <span
          aria-hidden="true"
          className="inline-block size-2.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
        />
      )}
      {icon && <span aria-hidden="true">{icon}</span>}
    </span>
  );
}
