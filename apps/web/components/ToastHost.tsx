"use client";

import * as Toast from "@radix-ui/react-toast";
import { useEffect, useState } from "react";
import { TOAST_EVENT, type ToastPayload } from "@/lib/toast";

type Item = ToastPayload & { id: string };

export function ToastHost() {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    function onToast(e: Event) {
      const detail = (e as CustomEvent<ToastPayload>).detail;
      const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const item: Item = { id, ...detail };
      setItems((prev) => [...prev, item]);
      const timeout = item.durationMs ?? 3500;
      setTimeout(() => {
        setItems((prev) => prev.filter((i) => i.id !== id));
      }, timeout + 100); // ensure exit animation
    }
    window.addEventListener(TOAST_EVENT, onToast as EventListener);
    return () => window.removeEventListener(TOAST_EVENT, onToast as EventListener);
  }, []);

  return (
    <Toast.Provider swipeDirection="right">
      {items.map((t) => (
        <Toast.Root
          key={t.id}
          duration={t.durationMs ?? 3500}
          className={
            "pointer-events-auto m-2 inline-flex w-[360px] max-w-[90vw] items-start gap-2 rounded-md border p-3 shadow-lg " +
            (t.variant === "success"
              ? "border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950/30"
              : t.variant === "error"
              ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/30"
              : t.variant === "warning"
              ? "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900 dark:bg-yellow-950/30"
              : "border-slate-200 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100")
          }
        >
          {t.title && <Toast.Title className="text-sm font-semibold">{t.title}</Toast.Title>}
          {t.description && (
            <Toast.Description className="text-xs opacity-90">{t.description}</Toast.Description>
          )}
        </Toast.Root>
      ))}
      <Toast.Viewport className="fixed bottom-2 right-2 z-[100] flex max-h-screen w-[380px] flex-col" />
    </Toast.Provider>
  );
}
