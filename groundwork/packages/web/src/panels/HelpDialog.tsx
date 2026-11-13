import { app, useApp } from '../lib/app';

const KEYS: [string, string][] = [
  ['Drag / wheel', 'Pan / zoom the plan (double-click: fit site)'],
  ['Click', 'Select an object; drag the building to move it'],
  ['Handles', 'Round handle rotates the building; square handles resize; drag a driveway along its frontage'],
  ['2 / 3', '2D plan / 3D view'],
  ['S', 'Section tool: click two points to cut a profile'],
  ['C', 'Toggle cut/fill map'],
  ['B', 'Toggle as-built reference'],
  ['I', 'Toggle imagery'],
  ['T', 'Light / dark theme'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
  ['Delete', 'Delete the selected object'],
  [': or /', 'Focus the command line (e.g. optimize_ffe, place_building rotationDeg=95)'],
  ['Esc', 'Clear selection / close dialogs'],
  ['?', 'This help'],
];

export function HelpDialog() {
  const open = useApp((s) => s.helpOpen);
  if (!open) return null;
  return (
    <div className="overlay" onClick={() => app.set({ helpOpen: false })}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts</h2>
        <div className="keys">
          {KEYS.map(([k, d]) => (
            <div key={k} style={{ display: 'contents' }}>
              <div>
                <kbd>{k}</kbd>
              </div>
              <div className="dim">{d}</div>
            </div>
          ))}
        </div>
        <p className="dim" style={{ marginTop: 16 }}>
          Every action here is a command. Claude drives the same commands through the Groundwork MCP server; watch the “Activity” tab while it works.
          Concept-level planning tool, not for construction.
        </p>
      </div>
    </div>
  );
}
