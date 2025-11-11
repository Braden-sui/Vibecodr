// Route: /admin/moderation — Moderation queue (MVP simplified)
// Responsibilities
// - List reports; allow quarantine/unquarantine
// TODOs
// - Authz gate; audit log for actions

export default function ModerationQueue() {
  return (
    <section>
      <h1>Moderation Queue</h1>
      <p>TODO: list reported posts with context and actions.</p>
      <ul>
        <li>Post #123 (App) — reason: spam — [Quarantine] [Ignore]</li>
      </ul>
    </section>
  );
}

