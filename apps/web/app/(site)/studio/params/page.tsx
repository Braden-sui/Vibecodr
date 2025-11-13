// Route: /studio/params — Param designer
// Responsibilities
// - Define sliders/toggles/selects bound to manifest.params
// - Live preview capsule with param changes
// TODOs
// - Bridge to preview iframe; debounced updates
// - Save to draft manifest in D1

export default function StudioParams() {
  return (
    <section>
      <h2>Params</h2>
      <p>Expose controls that appear in the Player.</p>
      <div>
        <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <strong>Defined Controls (stub)</strong>
          <ul>
            <li>count (number) min 10 max 1000 default 200</li>
            <li>speed (number) min 0 max 3 default 1.0</li>
          </ul>
        </div>
        <button>Add control</button>
      </div>
      <div style={{ marginTop: 16 }}>
        <strong>Preview</strong>
        <div style={{ border: "1px solid #eee", borderRadius: 8, height: 240, background: "#fafafa" }} />
        {/* TODO: Mount preview iframe and bind controls. */}
      </div>
    </section>
  );
}

