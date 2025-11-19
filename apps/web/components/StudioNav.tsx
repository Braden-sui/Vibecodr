// Studio section navigation used by /studio/* routes.
// TODO: Use active route detection and consistent styling system later.

import { Link } from "react-router-dom";

export function StudioNav() {
  return (
    <nav style={{ display: "flex", gap: 12, marginBottom: 12 }}>
      <Link to="/studio/import">Import</Link>
      <Link to="/studio/params">Params</Link>
      <Link to="/studio/files">Files</Link>
      <Link to="/studio/publish">Publish</Link>
    </nav>
  );
}

