"use client";

import { Sparkles } from "lucide-react";
import { VibesComposer } from "@/components/VibesComposer";
import KineticHeader from "@/src/components/KineticHeader";

export default function ShareVibePage() {
  return (
    <section className="mx-auto max-w-3xl space-y-6 px-4">
      <header className="space-y-2 text-center">
        <div className="mx-auto inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4 text-amber-500" />
          Create a vibe
        </div>
        <KineticHeader text="Share a vibe" className="text-3xl font-bold tracking-tight" />
        <p className="text-muted-foreground">
          Publish runnable vibes, import from GitHub or ZIP, or write inline code in one composer.
        </p>
      </header>

      <VibesComposer />
    </section>
  );
}
