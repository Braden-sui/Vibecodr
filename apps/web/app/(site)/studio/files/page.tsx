// Route: /studio/files — Minimal editor
// Responsibilities
// - Show entry file, assets, manifest.json with validation messages
// - Allow small tweaks, not a full IDE
// TODOs
// - Syntax highlighting (later)
// - Persist edits to draft

export default function StudioFiles() {
  return (
    <section>
      <h2>Files</h2>
      <p>Make small edits to your entry, assets, and manifest.</p>
      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 12 }}>
        <aside style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
          <ul>
            <li>index.html</li>
            <li>main.js</li>
            <li>styles.css</li>
            <li>manifest.json</li>
          </ul>
        </aside>
        <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
          <pre>// TODO: file content editor</pre>
        </div>
      </div>
    </section>
  );
}

