// Route: /studio/import - Import adapters
// NOTE: Studio screens are currently not linked from navigation; VibesComposer is the active entry point.
// Responsibilities
// - Accept GitHub repo URL or ZIP
// - Validate, optionally build static bundle, upload to R2
// TODOs
// - POST /import/zip (Worker)
// - GitHub tarball fetch via Worker, not client
// - Show progress: download → analyze → build → upload

export default function StudioImport() {
  return (
    <section>
      <h2>Import</h2>
      <p>Bring your project from GitHub or upload a ZIP.</p>
      <form>
        <label>
          GitHub URL
          <input type="url" placeholder="https://github.com/user/repo" style={{ display: "block", width: "100%" }} />
        </label>
        <p>or</p>
        <label>
          ZIP file
          <input type="file" accept=".zip" />
        </label>
        <div style={{ marginTop: 12 }}>
          <button type="button">Start Import</button>
        </div>
      </form>
      <div style={{ marginTop: 16 }}>
        <strong>Status:</strong> TODO – show validation/build logs here.
      </div>
    </section>
  );
}

