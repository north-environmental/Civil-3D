/**
 * 3D view (Three.js): terrain mesh (existing / proposed, plain or cut-fill drape), extruded building with
 * dock doors, trailers as instanced boxes, basin water, parcel line. Orbit camera with a default framing.
 * Display only: all numbers come from the core engine.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { type Basin, type Building, type Grid, type GridSpec, type Pt, type Scenario, type TruckCourt, bboxOf, distToPolyline, expandBBox, gridSpecForBBox, pointInRing, sampleGrid } from '@groundwork/core';
import { type AppState, app } from '../lib/app';
import { type Surfaces, cutFillColor, ensureSurfaces, surfaces } from '../plan/surfaces';

/** Vertical exaggeration of the 3D scene (a 40 ft relief over 2,500 ft is otherwise invisible). */
const VE = 3;

const CAT_COLOR: Record<number, [number, number, number]> = {
  1: [0.72, 0.73, 0.75], // pad
  2: [0.3, 0.32, 0.35], // truck court
  3: [0.43, 0.45, 0.49], // parking
  4: [0.36, 0.38, 0.41], // drive
  5: [0.2, 0.36, 0.52], // basin
  6: [0.36, 0.47, 0.33], // tie-in slope (grass)
};

function terrainColor(z: number, zMin: number, zMax: number, inParcel: boolean): [number, number, number] {
  const t = (z - zMin) / Math.max(1, zMax - zMin);
  const c: [number, number, number] = [0.23 + 0.2 * t, 0.3 + 0.2 * t, 0.2 + 0.12 * t];
  return inParcel ? c : [c[0] * 0.55, c[1] * 0.55, c[2] * 0.6];
}

type Built = { group: THREE.Group; center: THREE.Vector3; radius: number };

function buildScene(s: AppState, sf: Surfaces): Built | null {
  const site = s.project?.site;
  const dem = s.dem;
  if (!site || !dem) return null;
  const sc: Scenario | null = s.project!.scenarios.find((x) => x.id === s.project!.activeScenarioId) ?? null;
  const useProposed = s.surface3d === 'proposed' && !!sf.proposed && !!sf.spec;
  const spec: GridSpec = sf.spec ?? gridSpecForBBox(expandBBox(bboxOf(site.parcel.ring), 80), 10);
  const step = Math.max(1, Math.ceil(Math.max(spec.nx, spec.ny) / 340));
  const nx = Math.floor((spec.nx - 1) / step) + 1;
  const ny = Math.floor((spec.ny - 1) / step) + 1;
  const cx = spec.x0 + (spec.nx * spec.cellFt) / 2;
  const cy = spec.y0 + (spec.ny * spec.cellFt) / 2;

  const heights = new Float32Array(nx * ny);
  let zMin = Infinity;
  let zMax = -Infinity;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const gi = i * step;
      const gj = j * step;
      const x = spec.x0 + (gi + 0.5) * spec.cellFt;
      const y = spec.y0 + (gj + 0.5) * spec.cellFt;
      const z = useProposed ? sf.proposed!.data[gj * spec.nx + gi] : sampleGrid(dem, x, y);
      heights[j * nx + i] = z;
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
    }
  }
  const zBase = zMin;
  const group = new THREE.Group();
  const X = (x: number) => x - cx;
  const Z = (y: number) => -(y - cy);
  const Y = (z: number) => (z - zBase) * VE;

  // Terrain ------------------------------------------------------------------------------------
  const pos = new Float32Array(nx * ny * 3);
  const col = new Float32Array(nx * ny * 3);
  const drape = s.drape3d === 'cutfill' && !!sf.delta && !!sf.spec;
  const wetlands = site.constraints.filter((c) => c.kind === 'wetland').map((c) => c.ring);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const gi = i * step;
      const gj = j * step;
      const x = spec.x0 + (gi + 0.5) * spec.cellFt;
      const y = spec.y0 + (gj + 0.5) * spec.cellFt;
      const k = j * nx + i;
      const z = heights[k];
      pos[k * 3] = X(x);
      pos[k * 3 + 1] = Y(z);
      pos[k * 3 + 2] = Z(y);
      const inParcel = pointInRing([x, y], site.parcel.ring);
      let c = terrainColor(z, zMin, zMax, inParcel);
      const gk = gj * spec.nx + gi;
      if (drape) {
        const d = sf.delta![gk];
        if (!Number.isNaN(d)) {
          const rgba = cutFillColor(d, sf.scaleFt);
          c = [rgba[0] / 255, rgba[1] / 255, rgba[2] / 255];
        }
      } else if (useProposed && sf.category && sf.category[gk]) {
        c = CAT_COLOR[sf.category[gk]] ?? c;
      } else if (inParcel && wetlands.some((w) => pointInRing([x, y], w))) {
        c = [0.2, 0.45, 0.43];
      } else if (!inParcel) {
        for (const r of site.roads) {
          if (distToPolyline([x, y], r.centerline) < r.rowWidthFt / 2 - 8) {
            c = [0.17, 0.19, 0.22];
            break;
          }
        }
      }
      col[k * 3] = c[0];
      col[k * 3 + 1] = c[1];
      col[k * 3 + 2] = c[2];
    }
  }
  const idx: number[] = [];
  for (let j = 0; j + 1 < ny; j++) {
    for (let i = 0; i + 1 < nx; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  group.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));

  const surfaceGrid: Grid = useProposed ? sf.proposed! : dem;
  const ground = (p: Pt): number => sampleGrid(surfaceGrid, p[0], p[1]);

  // Parcel boundary draped on the surface -------------------------------------------------------
  const linePts: THREE.Vector3[] = [];
  const ring = site.parcel.ring;
  for (let e = 0; e < ring.length; e++) {
    const a = ring[e];
    const b = ring[(e + 1) % ring.length];
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 25));
    for (let q = 0; q < n; q++) {
      const p: Pt = [a[0] + ((b[0] - a[0]) * q) / n, a[1] + ((b[1] - a[1]) * q) / n];
      linePts.push(new THREE.Vector3(X(p[0]), Y(ground(p)) + 2.5, Z(p[1])));
    }
  }
  group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(linePts), new THREE.LineBasicMaterial({ color: 0xffffff })));

  // Design objects -----------------------------------------------------------------------------
  const objs = sc?.objects ?? [];
  const building = objs.find((o): o is Building => o.type === 'building');
  if (building && sc) {
    const graded = sc.grading.graded && sc.grading.ffeFt !== null;
    const ffe = graded ? sc.grading.ffeFt! : ground(building.center);
    const g = new THREE.Group();
    g.position.set(X(building.center[0]), Y(ffe), Z(building.center[1]));
    g.rotation.y = (building.rotationDeg * Math.PI) / 180;
    const h = building.heightFt * VE;
    const box = new THREE.BoxGeometry(building.lengthFt, h, building.depthFt);
    const body = new THREE.Mesh(box, [0, 1, 2, 3, 4, 5].map((f) => new THREE.MeshLambertMaterial({ color: f === 2 ? 0xe9ecf0 : 0xc5cad2 })));
    body.position.y = h / 2;
    g.add(body);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: 0x5a6270 }));
    edges.position.y = h / 2;
    g.add(edges);
    // Dock doors.
    const c = sc.layoutCriteria;
    const doors = building.doorsPerSide * building.dockSides.length;
    if (doors > 0) {
      const dm = new THREE.InstancedMesh(new THREE.BoxGeometry(9, 10 * VE, 1.2), new THREE.MeshLambertMaterial({ color: 0x30353d }), doors);
      const m = new THREE.Matrix4();
      const span = (building.doorsPerSide - 1) * c.dockDoorSpacingFt;
      let n = 0;
      for (const side of building.dockSides) {
        const sgn = side === '+v' ? 1 : -1;
        for (let k = 0; k < building.doorsPerSide; k++) {
          m.makeTranslation(-span / 2 + k * c.dockDoorSpacingFt, 5 * VE, -sgn * (building.depthFt / 2 + 0.4));
          dm.setMatrixAt(n++, m);
        }
      }
      g.add(dm);
    }
    // Office corner (blue band).
    const office = new THREE.Mesh(new THREE.BoxGeometry(building.carSide.endsWith('u') ? 2 : Math.min(180, building.lengthFt), 16 * VE, building.carSide.endsWith('u') ? Math.min(180, building.depthFt) : 2), new THREE.MeshLambertMaterial({ color: 0x4c8dff }));
    const L2 = building.lengthFt / 2;
    const D2 = building.depthFt / 2;
    if (building.carSide === '-u') office.position.set(-L2 - 0.5, 8 * VE, D2 - 90);
    else if (building.carSide === '+u') office.position.set(L2 + 0.5, 8 * VE, -D2 + 90);
    else if (building.carSide === '+v') office.position.set(-L2 + 90, 8 * VE, -D2 - 0.5);
    else office.position.set(L2 - 90, 8 * VE, D2 + 0.5);
    g.add(office);

    // Trailers in the court stalls.
    const courts = objs.filter((o): o is TruckCourt => o.type === 'truckCourt' && !!o.trailerUv && o.trailerStalls > 0);
    const total = courts.reduce((a, ct) => a + ct.trailerStalls, 0);
    if (total > 0) {
      const tm = new THREE.InstancedMesh(new THREE.BoxGeometry(8.5, 13.5 * VE, 53), new THREE.MeshLambertMaterial({ color: 0xe6e9ee }), total);
      const m = new THREE.Matrix4();
      let n = 0;
      const gc = sc.grading.criteria;
      for (const ct of courts) {
        const [u0, v0, u1, v1] = ct.trailerUv!;
        const slots = Math.floor((u1 - u0) / c.trailerStallWidthFt);
        const start = u0 + ((slots - ct.trailerStalls) / 2) * c.trailerStallWidthFt;
        const vMid = (v0 + v1) / 2;
        const drop = gc.dockHeightFt + (gc.truckCourtSlopePct / 100) * (Math.abs(vMid) - building.depthFt / 2);
        for (let k = 0; k < ct.trailerStalls; k++) {
          m.makeTranslation(start + (k + 0.5) * c.trailerStallWidthFt, (graded ? -drop : 0) * VE + (13.5 * VE) / 2 + 3, -vMid);
          tm.setMatrixAt(n++, m);
        }
      }
      g.add(tm);
    }
    group.add(g);
  }
  // Basin water surface (graded only: sits `depth` above the basin bottom).
  if (useProposed) {
    for (const b of objs.filter((o): o is Basin => o.type === 'basin')) {
      const cxy: Pt = [b.polygon.reduce((a, p) => a + p[0], 0) / b.polygon.length, b.polygon.reduce((a, p) => a + p[1], 0) / b.polygon.length];
      const water = ground(cxy) + b.depthFt * 0.6;
      const inset = b.sideSlopeHtoV * (b.freeboardFt + b.depthFt * 0.4);
      const shape = new THREE.Shape(
        b.polygon.map((p) => {
          const dx = p[0] - cxy[0];
          const dy = p[1] - cxy[1];
          const l = Math.hypot(dx, dy);
          const k = Math.max(0.1, (l - inset * Math.SQRT2) / l);
          return new THREE.Vector2(X(cxy[0] + dx * k), -Z(cxy[1] + dy * k));
        }),
      );
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshLambertMaterial({ color: 0x3f8fd8, transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = Y(water);
      group.add(mesh);
    }
  }
  const radius = Math.hypot(spec.nx * spec.cellFt, spec.ny * spec.cellFt) / 2;
  return { group, center: new THREE.Vector3(0, Y((zMin + zMax) / 2), 0), radius };
}

function disposeGroup(g: THREE.Object3D): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose?.();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose?.();
  });
}

export default function View3D({ renderMode = false, onReady }: { renderMode?: boolean; onReady?: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch {
      wrap.innerHTML = '<div class="empty">3D view needs WebGL, which this browser has disabled.</div>';
      onReady?.();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    wrap.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('data-testid', 'view3d-canvas');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 20, 60000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4250, 1.05));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(-1, 1.1, -0.8); // from the north-west, like a hillshade
    scene.add(sun);
    const controls = renderMode ? null : new OrbitControls(camera, renderer.domElement);
    if (controls) {
      controls.maxPolarAngle = Math.PI / 2 - 0.03;
      controls.addEventListener('change', () => renderer.render(scene, camera));
    }
    let current: Built | null = null;
    let framedFor = '';
    let lastKey = '';

    const render = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = `${w}px`;
      renderer.domElement.style.height = `${h}px`;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };

    const rebuild = () => {
      const s = app.get();
      ensureSurfaces(s);
      const sf = surfaces.get();
      const sc = s.project?.scenarios.find((x) => x.id === s.project!.activeScenarioId);
      const key = `${s.project?.site?.id}:${s.project?.revision}:${sc?.id}:${!!s.dem}:${sf.key}:${s.surface3d}:${s.drape3d}:${s.theme}`;
      if (key === lastKey) return;
      lastKey = key;
      scene.background = new THREE.Color(s.theme === 'light' ? 0xe9ecf0 : 0x111418);
      if (current) {
        scene.remove(current.group);
        disposeGroup(current.group);
        current = null;
      }
      current = buildScene(s, sf);
      if (current) {
        scene.add(current.group);
        const frameKey = `${s.project?.site?.id}`;
        if (framedFor !== frameKey) {
          framedFor = frameKey;
          // Default framing: from the south-west, ~32° above the horizon, whole site in view.
          const d = current.radius * 2.75;
          const az = (215 * Math.PI) / 180; // azimuth of the camera position, clockwise from north
          const el = (32 * Math.PI) / 180;
          camera.position.set(current.center.x + Math.sin(az) * Math.cos(el) * d, current.center.y + Math.sin(el) * d, current.center.z - Math.cos(az) * Math.cos(el) * d);
          camera.lookAt(current.center);
          if (controls) {
            controls.target.copy(current.center);
            controls.update();
          }
        }
      }
      render();
      const graded = !!sc?.grading.graded && !!sc.objects.some((o) => o.type === 'building');
      if (current && (!graded || sf.key)) {
        ((window as any).__gw ??= {}).view3dReady = true;
        onReady?.();
      }
    };

    const unsubA = app.subscribe(rebuild);
    const unsubS = surfaces.subscribe(rebuild);
    const ro = new ResizeObserver(render);
    ro.observe(wrap);
    rebuild();
    return () => {
      unsubA();
      unsubS();
      ro.disconnect();
      controls?.dispose();
      if (current) disposeGroup(current.group);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [renderMode]);

  return (
    <div className="plan-wrap" ref={wrapRef} data-testid="view3d">
      <div className="legend" style={{ left: 12, right: 'auto' }}>
        {VE}× vertical exaggeration · drag to orbit, wheel to zoom, right-drag to pan
      </div>
    </div>
  );
}
