// Route: /studio/publish — Publish flow
// Responsibilities
// - Title, tags, cover, privacy, capability prompts
// - Dry-run validation summary; generate share card
// TODOs
// - POST /capsules/:id/publish
// - Image upload for cover (R2)

export default function StudioPublish() {
  return (
    <section>
      <h2>Publish</h2>
      <form>
        <label>Title <input type="text" placeholder="My tiny app" /></label>
        <br />
        <label>Tags <input type="text" placeholder="viz, physics" /></label>
        <br />
        <label>Cover <input type="file" accept="image/*" /></label>
        <br />
        <label>
          Privacy
          <select>
            <option>Public</option>
            <option>Unlisted</option>
          </select>
        </label>
        <div style={{ marginTop: 12 }}>
          <button type="button">Run validation</button>
          <button type="button">Publish</button>
        </div>
      </form>
      <div style={{ marginTop: 16 }}>
        <strong>Validation</strong>
        <ul>
          <li>Bundle size: TODO</li>
          <li>Net allowlist: []</li>
          <li>Params: 2 controls</li>
        </ul>
      </div>
    </section>
  );
}

