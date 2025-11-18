"use client";

import * as React from "react";
import * as RadixAvatar from "@radix-ui/react-avatar";
import { cn } from "@/lib/utils";

export interface AvatarProps extends React.ComponentPropsWithoutRef<typeof RadixAvatar.Root> {
  src?: string | null;
  alt?: string;
  fallback?: string;
}

export function Avatar({ src, alt, fallback, className, ...rest }: AvatarProps) {
  const initials =
    fallback ??
    (alt
      ? alt
          .split(" ")
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => part[0]?.toUpperCase())
          .join("")
      : "?");

  return (
    <RadixAvatar.Root
      className={cn(
        "inline-flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border bg-gradient-to-br from-primary/20 to-primary/40 align-middle",
        className,
      )}
      {...rest}
    >
      {src ? <RadixAvatar.Image src={src} alt={alt} className="h-full w-full object-cover" /> : null}
      <RadixAvatar.Fallback
        delayMs={src ? 300 : 0}
        aria-hidden={!!alt}
        className="flex h-full w-full items-center justify-center bg-muted text-sm font-medium text-muted-foreground"
      >
        {initials}
      </RadixAvatar.Fallback>
    </RadixAvatar.Root>
  );
}
