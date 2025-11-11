// Route: /player/[postId] — Fullscreen Player
// Responsibilities
// - Sandboxed iframe running capsule
// - Right drawer tabs: Notes, Remix, Chat (stubbed)
// - Bottom bar: restart, perf meter, params controls
// TODOs
// - Fetch manifest: GET /capsules/:id/manifest
// - postMessage bridge: setParam, logs, errors, fps
// - Kill switch + restart
// - Capability badges (net, storage, runner)

import Link from "next/link";

export default function PlayerPage({ params }: { params: { postId: string } }) {
  const { postId } = params;
  return (
    <section>
      <h1>Player</h1>
      <p>Post ID: {postId}</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "start" }}>
        <div>
          <div style={{ border: "1px solid #eee", borderRadius: 8, height: 460, background: "#fafafa" }}>
            {/* TODO: Mount sandboxed iframe with manifest-driven entry */}
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
            <button>Restart</button>
            <span>Perf: 60 fps</span>
            {/* TODO: Param controls rendered from manifest.params */}
          </div>
        </div>
        <aside style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
          <nav style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button>Notes</button>
            <button>Remix</button>
            <button>Chat</button>
          </nav>
          <div>
            {/* TODO: Tabs content. Remix shows diff summary + "Fork to Studio". */}
            <p>Notes go here. Param presets, timestamps, author commentary.</p>
            <Link href={`/studio`}>Fork to Studio</Link>
          </div>
        </aside>
      </div>
    </section>
  );
}

