// Route: / — Feed (Latest + Following)
// Responsibilities
// - Display App and Report cards with badges (runner, net, params)
// - Hover preview: preboot capsule manifest (stubbed)
// - Actions: run (open Player), remix, like, comment
// TODOs
// - Hook to API: GET /posts?mode=latest|following
// - Preload manifests for in-viewport cards via IntersectionObserver
// - Optimistic UI for likes/follows
// - Pagination/infinite scroll

import Link from "next/link";

export default function FeedPage() {
  // Placeholder data. Replace with API data fetching.
  const mockPosts = [
    { id: "1", type: "app", title: "Boids Sim", author: "@marta", badges: ["client-static", "no-net", "2 params"] },
    { id: "2", type: "report", title: "Notes on a Tiny Paint App", author: "@tom", badges: ["3 snapshots"] }
  ];
  return (
    <section>
      <h1>Vibecodr Feed</h1>
      <p>Latest runnable apps and reports. Hover to preview, click to run.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
        {mockPosts.map((p) => (
          <article key={p.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
            <div style={{ height: 140, background: "#fafafa", borderRadius: 8, marginBottom: 8 }}>
              {/* TODO: Hover preview: preload and mount capsule preview */}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <strong>{p.title}</strong>
              <span style={{ color: "#666" }}>{p.author}</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {p.badges.map((b) => (
                  <span key={b} style={{ fontSize: 12, background: "#f3f3f3", borderRadius: 6, padding: "2px 6px" }}>{b}</span>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Link href={`/player/${p.id}`}>Run</Link>
                <a href="#" onClick={(e) => e.preventDefault()}>Remix</a>
                <a href="#" onClick={(e) => e.preventDefault()}>Like</a>
                <Link href={`/post/${p.id}`}>Open</Link>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

