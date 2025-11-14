// Minimal Player shell component to be used on /player and inline in posts.
// TODO: accept manifest + params; mount sandboxed iframe and provide controls.

import React from "react";

export type PlayerShellProps = {
  manifestUrl?: string;
};

export function PlayerShell({ manifestUrl: _manifestUrl }: PlayerShellProps) {
  return (
    <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 8 }}>
      <div style={{ height: 320, background: "#fafafa", borderRadius: 6 }}>
        {/* TODO: Load manifest from manifestUrl and render iframe */}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button>Restart</button>
        <span>Perf: —</span>
      </div>
    </div>
  );
}
