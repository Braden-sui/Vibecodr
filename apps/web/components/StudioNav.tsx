// Studio section navigation used by /studio/* routes.
// TODO: Use active route detection and consistent styling system later.

import Link from "next/link";

export function StudioNav() {
  return (
    <nav style={{ display: "flex", gap: 12, marginBottom: 12 }}>
      <Link href="/studio/import">Import</Link>
      <Link href="/studio/params">Params</Link>
      <Link href="/studio/files">Files</Link>
      <Link href="/studio/publish">Publish</Link>
    </nav>
  );
}

