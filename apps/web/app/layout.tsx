// App layout shell. Keep minimal; focus on structure and TODOs.
import React from "react";

export const metadata = {
  title: "Vibecodr",
  description: "Runnable micro-apps feed for makers"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // TODO: Wire global providers (auth, analytics, query cache) when ready.
  // TODO: Add design tokens + Tailwind/shadcn once we set up styling.
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <header style={{ padding: 12, borderBottom: "1px solid #eee" }}>
          {/* TODO: Replace with real nav (logo, search, new post, profile). */}
          <nav style={{ display: "flex", gap: 12 }}>
            <a href="/">Feed</a>
            <a href="/studio">Studio</a>
            <a href="/report/new">New Report</a>
            <a href="/settings">Settings</a>
          </nav>
        </header>
        <main style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>{children}</main>
      </body>
    </html>
  );
}

