import { Checkbox } from "@/shared/ui/checkbox";
import type { FacetBucket } from "@/features/search-vacancies";

interface FacetGroupProps {
  title: string;
  buckets: FacetBucket[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  /** Maps a raw bucket value (e.g. "true") to its display label (e.g. "Remote"). Defaults to the
   * raw value itself for facets whose bucket values are already human-readable. */
  labelFor?: (value: string) => string;
}

export function FacetGroup({ title, buckets, selected, onToggle, labelFor }: FacetGroupProps) {
  if (buckets.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium">{title}</p>
      <div className="flex flex-col gap-1">
        {buckets.map((bucket) => (
          <label
            key={bucket.value}
            className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
          >
            <Checkbox
              checked={selected.has(bucket.value)}
              onCheckedChange={() => onToggle(bucket.value)}
            />
            <span className="min-w-0 flex-1 truncate">
              {labelFor ? labelFor(bucket.value) : bucket.value}
            </span>
            <span className="text-xs text-muted-foreground">({bucket.count})</span>
          </label>
        ))}
      </div>
    </div>
  );
}
