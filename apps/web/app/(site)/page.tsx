import { Suspense } from "react";
import HomePageClient from "./HomePageClient";

export default function Page() {
  return (
    <Suspense fallback={<div className="py-10 text-center text-muted-foreground">Loading feed…</div>}>
      <HomePageClient />
    </Suspense>
  );
}
