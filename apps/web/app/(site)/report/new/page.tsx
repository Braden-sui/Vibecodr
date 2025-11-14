// Route: /report/new — Report composer
// Responsibilities
// - Rich text editor with inline vibe snapshots
// - “Insert vibe snapshot” freezes params/seed
// TODOs
// - Save drafts; publish to posts table as type=report

export default function NewReport() {
  return (
    <section>
      <h1>New Report</h1>
      <p>Tell the story of your vibe with inline snapshots.</p>
      <div style={{ border: "1px dashed #bbb", borderRadius: 8, padding: 12, minHeight: 200 }}>
        <p>TODO: Rich text editor</p>
        <button>Insert your vibe snapshot</button>
      </div>
      <div style={{ marginTop: 12 }}>
        <button>Save draft</button>
        <button>Publish report</button>
      </div>
    </section>
  );
}
