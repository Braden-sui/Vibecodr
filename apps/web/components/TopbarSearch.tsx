"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

export function TopbarSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const initial = searchParams.get("q") ?? "";
  const [open, setOpen] = useState<boolean>(false);
  const [value, setValue] = useState<string>(initial);

  // Keep local state in sync when URL changes elsewhere
  useEffect(() => {
    setValue(initial);
  }, [initial]);

  // Debounce URL updates
  const [debounced, setDebounced] = useState<string>(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), 300);
    return () => clearTimeout(t);
  }, [value]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (debounced.trim()) params.set("q", debounced.trim());
    else params.delete("q");
    router.replace(`${pathname}?${params.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const clear = () => {
    setValue("");
    const params = new URLSearchParams(searchParams.toString());
    params.delete("q");
    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="flex items-center gap-2 flex-row-reverse">
      <button
        aria-label={open ? "Close search" : "Open search"}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border hover:bg-muted"
      >
        {open ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
      </button>

      <div className={`overflow-hidden transition-all duration-300 ${open ? "w-64 opacity-100" : "w-0 opacity-0"}`}>
        <div className="flex items-center gap-2 rounded-full border px-3 py-1.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Search"
            className="h-7 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
          />
        </div>
      </div>
    </div>
  );
}
