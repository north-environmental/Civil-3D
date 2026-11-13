import type { DesignObject } from '@groundwork/core';
import { LAYERS, app, useApp, useScenario } from '../lib/app';

const GROUPS: { type: DesignObject['type']; label: string }[] = [
  { type: 'building', label: 'Building' },
  { type: 'truckCourt', label: 'Truck courts' },
  { type: 'truckApron', label: 'Truck aprons' },
  { type: 'trailerField', label: 'Trailer fields' },
  { type: 'parkingField', label: 'Parking fields' },
  { type: 'driveway', label: 'Driveways' },
  { type: 'drive', label: 'Drives' },
  { type: 'basin', label: 'Basins' },
  { type: 'landscape', label: 'Landscape' },
];

function meta(o: DesignObject): string {
  switch (o.type) {
    case 'building':
      return `${Math.round(o.areaSf).toLocaleString()} SF`;
    case 'truckCourt':
      return o.trailerStalls ? `${o.trailerStalls} trl` : `${o.depthFt} ft`;
    case 'trailerField':
      return `${o.stalls} trl`;
    case 'parkingField':
      return `${o.stallsTotal} stalls`;
    case 'driveway':
      return o.network;
    case 'drive':
      return `${Math.round(o.lengthFt)} ft`;
    case 'basin':
      return `${(o.areaSf / 43560).toFixed(1)} ac`;
    case 'landscape':
      return `${Math.round(o.areaSf).toLocaleString()} SF`;
    default:
      return '';
  }
}

export function LeftPanel() {
  const layers = useApp((s) => s.layers);
  const selection = useApp((s) => s.selection);
  const site = useApp((s) => s.project?.site ?? null);
  const scenario = useScenario();
  const walls = scenario?.results.earthwork?.walls ?? [];
  return (
    <div className="left" data-testid="left-panel">
      <div className="panel-title">Layers</div>
      {LAYERS.map((l) => {
        const unavailable = l.id === 'imagery' && !site?.imagery.available;
        return (
          <label key={l.id} className={`layer-row ${layers[l.id] ? '' : 'off'}`} title={unavailable ? 'No cached imagery in this fixture' : ''}>
            <input type="checkbox" checked={layers[l.id]} disabled={unavailable} onChange={() => app.set({ layers: { ...layers, [l.id]: !layers[l.id] } })} />
            <span className="swatch" style={{ background: l.swatch }} />
            <span>{l.label}</span>
          </label>
        );
      })}
      <div className="panel-title" style={{ marginTop: 6 }}>
        Objects <span className="mono">{scenario?.objects.length ?? 0}</span>
      </div>
      {!scenario?.objects.length && <div className="empty">No design objects yet. Set a program and generate a layout, or ask Claude.</div>}
      {GROUPS.map((g) => {
        const items = scenario?.objects.filter((o) => o.type === g.type) ?? [];
        if (!items.length) return null;
        return (
          <div key={g.type}>
            <div className="tree-group">
              <span>{g.label}</span>
              <span className="mono">{items.length}</span>
            </div>
            {items.map((o) => (
              <div
                key={o.id}
                className={`tree-item ${selection === o.id ? 'sel' : ''}`}
                onClick={() => app.set({ selection: o.id, zoomTo: { ids: [o.id], nonce: Date.now() }, view: '2d' })}
                title={o.id}
              >
                <span>{o.name}</span>
                <span className="meta">{meta(o)}</span>
              </div>
            ))}
          </div>
        );
      })}
      {walls.length > 0 && (
        <div>
          <div className="tree-group">
            <span>Retaining walls (derived)</span>
            <span className="mono">{walls.length}</span>
          </div>
          {walls.map((w) => (
            <div key={w.id} className="tree-item">
              <span>{w.id}</span>
              <span className="meta">
                {Math.round(w.lengthFt)} ft · {w.maxHeightFt.toFixed(1)} ft
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
