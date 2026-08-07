"use client";

import * as React from "react";
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { Check } from "lucide-react";

import { cn } from "@/shared/lib/utils";

const ComboboxRoot = ComboboxPrimitive.Root;

function ComboboxInput({ className, ...props }: React.ComponentProps<typeof ComboboxPrimitive.Input>) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxPortal(props: React.ComponentProps<typeof ComboboxPrimitive.Portal>) {
  return <ComboboxPrimitive.Portal {...props} />;
}

function ComboboxPositioner({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Positioner>) {
  return (
    <ComboboxPrimitive.Positioner
      data-slot="combobox-positioner"
      sideOffset={sideOffset}
      className={cn("z-50", className)}
      {...props}
    />
  );
}

function ComboboxPopup({ className, ...props }: React.ComponentProps<typeof ComboboxPrimitive.Popup>) {
  return (
    <ComboboxPrimitive.Popup
      data-slot="combobox-popup"
      className={cn(
        "max-h-64 w-[var(--anchor-width)] overflow-y-auto rounded-lg border-2 border-border bg-popover p-1 text-popover-foreground shadow-md",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxList({ className, ...props }: React.ComponentProps<typeof ComboboxPrimitive.List>) {
  return <ComboboxPrimitive.List data-slot="combobox-list" className={cn(className)} {...props} />;
}

function ComboboxItem({ className, children, ...props }: React.ComponentProps<typeof ComboboxPrimitive.Item>) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator className="flex items-center justify-center">
        <Check className="size-3.5" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  );
}

function ComboboxEmpty({ className, ...props }: React.ComponentProps<typeof ComboboxPrimitive.Empty>) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn("px-2 py-1.5 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  ComboboxRoot,
  ComboboxInput,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxPopup,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
};
