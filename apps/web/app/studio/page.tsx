// Route: /studio — Creation hub with tabs
// Responsibilities
// - Nav across Import, Params, Files, Publish
// - Show current capsule draft status
// TODOs
// - Link to subroutes; persist draft in D1; show validation status

import Link from "next/link";

export default function StudioIndex() {
  return (
    <section>
      <h1>Studio</h1>
      <p>Quickly import, tweak, and publish a capsule.</p>
      <ul>
        <li><Link href="/studio/import">Import</Link></li>
        <li><Link href="/studio/params">Params</Link></li>
        <li><Link href="/studio/files">Files</Link></li>
        <li><Link href="/studio/publish">Publish</Link></li>
      </ul>
      <p>TODO: display draft capsule info and validation results here.</p>
    </section>
  );
}

