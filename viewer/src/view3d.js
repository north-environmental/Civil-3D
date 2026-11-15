/* view3d.js: the 3D view, drawn with the browser's built-in WebGL (no libraries).
 *
 * - Ground: a mesh from the site's elevation grid (or the graded surface after runGrading).
 * - Everything flat (aerial photo or shaded relief, property line, setbacks, roads, streams,
 *   wetlands, parking striping, cut/fill colours) is painted onto one large 2D canvas that is draped
 *   over the ground as a texture, so lines follow the terrain and stay crisp.
 * - Buildings are boxes standing on their finished floor elevation.
 * Local 3D axes: X = east, Y = up, Z = south; positions are relative to the site centre.
 */
'use strict';
(function () {
  const G = LD.geom, Grid = LD.grid;

  // ---------------------------------------------------------------------------------- matrices
  const M = {
    persp(fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
      return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
    },
    lookAt(e, c, up) {
      let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
      let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
      let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
      l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
        -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]);
    },
    mul(a, b) {
      const o = new Float32Array(16);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
        o[i * 4 + j] = s;
      }
      return o;
    },
  };

  const VS = `attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aUv;
    uniform mat4 uMVP; varying vec3 vN; varying vec2 vUv;
    void main(){ vN = aNrm; vUv = aUv; gl_Position = uMVP * vec4(aPos, 1.0); }`;
  const FS = `precision mediump float; varying vec3 vN; varying vec2 vUv;
    uniform sampler2D uTex; uniform float uUseTex; uniform vec4 uColor; uniform vec3 uLight;
    void main(){
      vec3 n = normalize(vN);
      float l = 0.50 + 0.50 * max(dot(n, uLight), 0.0);
      vec4 base = mix(uColor, texture2D(uTex, vUv), uUseTex);
      gl_FragColor = vec4(base.rgb * l, 1.0);
    }`;

  const V = (LD.view = {
    exaggeration: 1.5,
    baseLayer: 'aerial',       // 'aerial' or 'relief'
    showCutFill: true,
    cam: { yaw: 0.35, pitch: 0.75, dist: 3000, target: [0, 0, 0] },
  });

  let gl, canvas, labelsEl, prog, loc, isGL2 = false;
  let terrainBuf = null, terrainIdx = null, terrainCount = 0, mesh = null;
  let boxBuf = null, boxCount = 0, boxDraws = [];
  let tex = null, drapeCanvas = null, drapeScale = 1;
  let site = null, center = [0, 0], zRef = 0;
  let aerialImg = null, reliefCanvas = null;
  let needsRender = false, labels = [];

  V.init = function (container) {
    canvas = document.createElement('canvas');
    canvas.className = 'gl';
    container.appendChild(canvas);
    labelsEl = document.createElement('div');
    labelsEl.className = 'labels';
    container.appendChild(labelsEl);
    gl = canvas.getContext('webgl2', { antialias: true });
    isGL2 = !!gl;
    if (!gl) {
      gl = canvas.getContext('webgl', { antialias: true }) || canvas.getContext('experimental-webgl');
      if (!gl) throw new Error('This browser cannot show 3D graphics (WebGL is turned off or unavailable).');
      if (!gl.getExtension('OES_element_index_uint')) throw new Error('This browser\'s WebGL is too limited for the terrain mesh.');
    }
    prog = makeProgram(VS, FS);
    loc = {
      aPos: gl.getAttribLocation(prog, 'aPos'), aNrm: gl.getAttribLocation(prog, 'aNrm'), aUv: gl.getAttribLocation(prog, 'aUv'),
      uMVP: gl.getUniformLocation(prog, 'uMVP'), uTex: gl.getUniformLocation(prog, 'uTex'), uUseTex: gl.getUniformLocation(prog, 'uUseTex'),
      uColor: gl.getUniformLocation(prog, 'uColor'), uLight: gl.getUniformLocation(prog, 'uLight'),
    };
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.067, 0.078, 0.094, 1);
    drapeCanvas = document.createElement('canvas');
    attachControls();
    new ResizeObserver(() => V.render()).observe(container);
    V.render();
  };

  function makeProgram(vs, fs) {
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader error: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Shader link error: ' + gl.getProgramInfoLog(p));
    return p;
  }

  // ---------------------------------------------------------------------------------- site setup
  V.setSite = function (s) {
    site = s;
    const pb = s.parcelBBox;
    center = [(pb.minX + pb.maxX) / 2, (pb.minY + pb.maxY) / 2];
    zRef = s.elevMinFt;
    aerialImg = null; reliefCanvas = null;
    V.baseLayer = s.imagery ? 'aerial' : 'relief';
    if (s.imagery) {
      const img = new Image();
      img.onload = () => { aerialImg = img; V.refresh(); };
      img.src = 'data:' + (s.imagery.mime || 'image/jpeg') + ';base64,' + s.imagery.data;
    }
    reliefCanvas = makeRelief(s.terrain);
    V.resetView();
    V.refresh();
  };

  V.resetView = function () {
    if (!site) return;
    const pb = site.parcelBBox;
    V.cam.target = [0, ((site.elevMinFt + site.elevMaxFt) / 2 - zRef) * V.exaggeration, 0];
    V.cam.dist = Math.max(pb.maxX - pb.minX, pb.maxY - pb.minY) * 1.25;
    V.cam.yaw = 0.35; V.cam.pitch = 0.75;
    V.render();
  };
  V.topView = function () { V.cam.pitch = 1.5; V.cam.yaw = 0; V.render(); };

  /** Rebuild everything that depends on the design (call after any change). */
  V.refresh = function () {
    if (!site || !gl) return;
    buildTerrain();
    buildBoxes();
    drawDrape();
    V.render();
  };

  // ---------------------------------------------------------------------------------- terrain mesh
  function heightAt(x, y) {
    const d = LD.app.display.grading;
    if (d) {
      const s = d.spec;
      const fx = (x - s.x0) / s.cellFt, fy = (y - s.y0) / s.cellFt;
      if (fx >= 0.5 && fy >= 0.5 && fx <= s.nx - 0.5 && fy <= s.ny - 0.5)
        return Grid.sample({ x0: s.x0, y0: s.y0, cellFt: s.cellFt, nx: s.nx, ny: s.ny, data: d.proposed }, x, y);
    }
    return Grid.sample(site.terrain, x, y);
  }

  function buildTerrain() {
    const t = site.terrain, ext = site.extent;
    const step = Math.max(1, Math.ceil(Math.max(t.nx, t.ny) / 560));
    const nx = Math.floor((t.nx - 1) / step) + 1, ny = Math.floor((t.ny - 1) / step) + 1;
    const cell = t.cellFt * step, ex = V.exaggeration;
    const H = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = t.x0 + (i * step + 0.5) * t.cellFt, y = t.y0 + (j * step + 0.5) * t.cellFt;
      H[j * nx + i] = heightAt(x, y);
    }
    const data = new Float32Array(nx * ny * 8);
    const w = ext.xMax - ext.xMin, h = ext.yMax - ext.yMin;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, o = k * 8;
      const x = t.x0 + (i * step + 0.5) * t.cellFt, y = t.y0 + (j * step + 0.5) * t.cellFt;
      const hl = H[j * nx + Math.max(0, i - 1)], hr = H[j * nx + Math.min(nx - 1, i + 1)];
      const hd = H[Math.max(0, j - 1) * nx + i], hu = H[Math.min(ny - 1, j + 1) * nx + i];
      // normal of the surface Y = h(x, -z)·ex in local axes (Z points south)
      let nX = -((hr - hl) * ex) / (2 * cell), nZ = ((hu - hd) * ex) / (2 * cell), nY = 1;
      const l = Math.hypot(nX, nY, nZ);
      data[o] = x - center[0]; data[o + 1] = (H[k] - zRef) * ex; data[o + 2] = -(y - center[1]);
      data[o + 3] = nX / l; data[o + 4] = nY / l; data[o + 5] = nZ / l;
      data[o + 6] = (x - ext.xMin) / w; data[o + 7] = (ext.yMax - y) / h;
    }
    if (!mesh || mesh.nx !== nx || mesh.ny !== ny) {
      const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
      let p = 0;
      for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
      }
      terrainIdx = terrainIdx || gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, terrainIdx);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      terrainCount = idx.length;
      mesh = { nx, ny };
    }
    terrainBuf = terrainBuf || gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, terrainBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  }

  // ---------------------------------------------------------------------------------- buildings
  function buildBoxes() {
    const ex = V.exaggeration;
    const verts = [];
    boxDraws = [];
    labels = [];
    const P = (x, y, z) => [x - center[0], (z - zRef) * ex, -(y - center[1])];
    const push = (p, n) => verts.push(p[0], p[1], p[2], n[0], n[1], n[2], 0, 0);
    for (const el of LD.app.state ? LD.app.state.elements : []) {
      const ring = LD.commands.elementRing(el);
      if (el.type !== 'building') {
        const c = G.centroid(ring);
        labels.push({ text: el.id + '  ' + el.name, pos: P(c[0], c[1], heightAt(c[0], c[1]) + 3), kind: 'parking' });
        continue;
      }
      const start = verts.length / 8;
      const z0 = el.padElevFt, z1 = el.padElevFt + el.heightFt;
      // Walls go a little below the floor so they never float above sloping ground.
      const zb = Math.min(z0, ...ring.map((p) => heightAt(p[0], p[1]))) - 2;
      for (let k = 0; k < 4; k++) {
        const a = ring[k], b = ring[(k + 1) % 4];
        const n = [b[1] - a[1], 0, b[0] - a[0]];
        const l = Math.hypot(n[0], n[2]); n[0] /= l; n[2] /= l;
        const A0 = P(a[0], a[1], zb), B0 = P(b[0], b[1], zb), A1 = P(a[0], a[1], z1), B1 = P(b[0], b[1], z1);
        for (const p of [A0, B0, B1, A0, B1, A1]) push(p, n);
      }
      const r = ring.map((p) => P(p[0], p[1], z1));
      for (const p of [r[0], r[1], r[2], r[0], r[2], r[3]]) push(p, [0, 1, 0]);
      boxDraws.push({ start, count: verts.length / 8 - start, color: [0.86, 0.87, 0.89, 1] });
      const c = G.centroid(ring);
      labels.push({ text: el.id + '  ' + el.name, pos: P(c[0], c[1], z1 + 4), kind: 'building' });
    }
    boxBuf = boxBuf || gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, boxBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts.length ? verts : [0, 0, 0, 0, 1, 0, 0, 0]), gl.DYNAMIC_DRAW);
    boxCount = verts.length / 8;
  }

  // ---------------------------------------------------------------------------------- drape texture
  function makeRelief(t) {
    const c = document.createElement('canvas');
    c.width = t.nx; c.height = t.ny;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(t.nx, t.ny);
    const zmin = site.elevMinFt - 20, zmax = site.elevMaxFt + 20;
    for (let j = 0; j < t.ny; j++) for (let i = 0; i < t.nx; i++) {
      const k = j * t.nx + i;
      const zl = t.data[j * t.nx + Math.max(0, i - 1)], zr = t.data[j * t.nx + Math.min(t.nx - 1, i + 1)];
      const zd = t.data[Math.max(0, j - 1) * t.nx + i], zu = t.data[Math.min(t.ny - 1, j + 1) * t.nx + i];
      const gx = (zr - zl) / (2 * t.cellFt) * 2, gy = (zu - zd) / (2 * t.cellFt) * 2;
      const shade = Math.max(0, Math.min(1, 0.65 + (-gx * 0.7071 + gy * 0.7071) * 1.2));
      const u = Math.max(0, Math.min(1, (t.data[k] - zmin) / (zmax - zmin)));
      // low = soft green, high = warm tan
      const r = 118 + 92 * u, g = 140 + 50 * u, b = 98 + 40 * u;
      const o = ((t.ny - 1 - j) * t.nx + i) * 4; // canvas row 0 = north
      img.data[o] = r * shade; img.data[o + 1] = g * shade; img.data[o + 2] = b * shade; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  function drawDrape() {
    const ext = site.extent;
    const maxTex = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 4096);
    const w = ext.xMax - ext.xMin, h = ext.yMax - ext.yMin;
    const W = w >= h ? maxTex : Math.round((maxTex * w) / h), H = w >= h ? Math.round((maxTex * h) / w) : maxTex;
    drapeCanvas.width = W; drapeCanvas.height = H;
    drapeScale = W / w; // px per ft
    const ctx = drapeCanvas.getContext('2d');
    const X = (x) => (x - ext.xMin) * drapeScale, Y = (y) => (ext.yMax - y) * drapeScale;
    const px = (ft) => Math.max(1, ft * drapeScale);
    const path = (ring, close = true) => {
      ctx.beginPath();
      ring.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
      if (close) ctx.closePath();
    };
    const polyPath = (poly) => { ctx.beginPath(); for (const r of [poly.outer, ...(poly.holes || [])]) { r.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])))); ctx.closePath(); } };

    // base layer
    ctx.fillStyle = '#5c6a55';
    ctx.fillRect(0, 0, W, H);
    const useAerial = V.baseLayer === 'aerial' && aerialImg;
    if (useAerial) {
      const im = site.imagery;
      ctx.drawImage(aerialImg, X(im.xMinFt), Y(im.yMaxFt), (im.xMaxFt - im.xMinFt) * drapeScale, (im.yMaxFt - im.yMinFt) * drapeScale);
      ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(0, 0, W, H);
    } else {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(reliefCanvas, 0, 0, W, H);
    }

    // cut / fill
    const d = LD.app.display.grading;
    if (d && V.showCutFill) {
      const s = d.spec;
      const c = document.createElement('canvas');
      c.width = s.nx; c.height = s.ny;
      const cx = c.getContext('2d'), img = cx.createImageData(s.nx, s.ny);
      for (let j = 0; j < s.ny; j++) for (let i = 0; i < s.nx; i++) {
        const k = j * s.nx + i, diff = d.proposed[k] - d.existing[k];
        const o = ((s.ny - 1 - j) * s.nx + i) * 4;
        if (d.wallHeight && d.wallHeight[k] > 0.5) { img.data[o] = 255; img.data[o + 1] = 230; img.data[o + 2] = 40; img.data[o + 3] = 255; continue; }
        if (Math.abs(diff) < 0.1) continue;
        const a = Math.min(1, Math.abs(diff) / 12);
        if (diff > 0) { img.data[o] = 40; img.data[o + 1] = 110; img.data[o + 2] = 235; }
        else { img.data[o] = 225; img.data[o + 1] = 60; img.data[o + 2] = 45; }
        img.data[o + 3] = Math.round(70 + 150 * a);
      }
      cx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(c, X(s.x0), Y(s.y0 + s.ny * s.cellFt), s.nx * s.cellFt * drapeScale, s.ny * s.cellFt * drapeScale);
      ctx.imageSmoothingEnabled = true;
    }

    const F = site.features;
    for (const it of (F.floodplain && F.floodplain.items) || []) { polyPath(it.polygon); ctx.fillStyle = 'rgba(59,130,246,0.28)'; ctx.fill('evenodd'); }
    for (const it of (F.wetlands && F.wetlands.items) || []) {
      polyPath(it.polygon); ctx.fillStyle = 'rgba(45,212,191,0.35)'; ctx.fill('evenodd');
      ctx.strokeStyle = 'rgba(45,212,191,0.95)'; ctx.lineWidth = 3; ctx.stroke();
    }
    for (const it of (F.streams && F.streams.items) || []) { path(it.line, false); ctx.strokeStyle = '#4ea8ff'; ctx.lineWidth = 5; ctx.stroke(); }
    for (const it of (F.roads && F.roads.items) || []) {
      path(it.centerline, false);
      ctx.lineCap = 'round';
      if (!useAerial) { ctx.strokeStyle = '#4a4d52'; ctx.lineWidth = px(24); ctx.stroke(); }
      ctx.setLineDash([px(12), px(10)]); ctx.strokeStyle = 'rgba(250,204,21,0.9)'; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
    }
    for (const it of (F.buildings && F.buildings.items) || []) { polyPath(it.footprint); ctx.fillStyle = 'rgba(156,163,175,0.8)'; ctx.fill('evenodd'); }

    // setbacks and parcel
    ctx.lineJoin = 'round';
    for (const p of site.parkingEnvelope) { polyPath(p); ctx.setLineDash([10, 8]); ctx.strokeStyle = 'rgba(163,230,53,0.95)'; ctx.lineWidth = 3; ctx.stroke(); }
    for (const p of site.buildingEnvelope) { polyPath(p); ctx.setLineDash([18, 10]); ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 5; ctx.stroke(); }
    ctx.setLineDash([]);
    path(site.parcelRing); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 7; ctx.stroke();

    // design elements
    const failing = new Set();
    const ck = LD.app.state && LD.app.state.checks;
    if (ck && !ck.stale) for (const r of ck.rows) if (!r.pass && !r.informational) String(r.id).split('/').forEach((id) => failing.add(id));
    for (const el of LD.app.state ? LD.app.state.elements : []) {
      if (el.type === 'parking') {
        const f = LD.commands.parkingField(el);
        const c = LD.parking.criteriaFor(site);
        const g = LD.parking.stallGeometry(f, c);
        path(f.polygon); ctx.fillStyle = '#34373c'; ctx.fill();
        for (const r of g.islands) { path(r); ctx.fillStyle = '#4f7a3a'; ctx.fill(); }
        for (const r of g.adaAisles) { path(r); ctx.fillStyle = '#2f5fa8'; ctx.fill(); }
        for (const r of g.adaStalls) { path(r); ctx.fillStyle = '#3b6fc4'; ctx.fill(); }
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = Math.max(1, px(0.6));
        ctx.beginPath();
        for (const [a, b] of g.lines) { ctx.moveTo(X(a[0]), Y(a[1])); ctx.lineTo(X(b[0]), Y(b[1])); }
        ctx.stroke();
        path(f.polygon); ctx.strokeStyle = failing.has(el.id) ? '#ef4444' : '#d1d5db'; ctx.lineWidth = failing.has(el.id) ? 6 : 2; ctx.stroke();
      } else {
        const ring = LD.commands.elementRing(el);
        const pad = G.rectRing(el.cxFt, el.cyFt, el.widthFt + 20, el.depthFt + 20, el.rotationDeg);
        path(pad); ctx.fillStyle = 'rgba(200,200,200,0.35)'; ctx.fill();
        path(ring); ctx.fillStyle = '#d9dbe0'; ctx.fill();
        ctx.strokeStyle = failing.has(el.id) ? '#ef4444' : '#9ca3af'; ctx.lineWidth = failing.has(el.id) ? 8 : 3; ctx.stroke();
      }
    }

    tex = tex || gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, drapeCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (isGL2) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      const an = gl.getExtension('EXT_texture_filter_anisotropic');
      if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  }

  // ---------------------------------------------------------------------------------- rendering
  V.render = function () {
    if (needsRender) return;
    needsRender = true;
    requestAnimationFrame(draw);
  };

  function camMatrix() {
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); }
    const c = V.cam, t = c.target;
    const eye = [t[0] + c.dist * Math.cos(c.pitch) * Math.sin(c.yaw), t[1] + c.dist * Math.sin(c.pitch), t[2] + c.dist * Math.cos(c.pitch) * Math.cos(c.yaw)];
    const up = c.pitch > 1.45 ? [-Math.sin(c.yaw), 0, -Math.cos(c.yaw)] : [0, 1, 0];
    const proj = M.persp(0.8, cw / Math.max(1, ch), c.dist / 200, c.dist * 20);
    return { mvp: M.mul(proj, M.lookAt(eye, t, up)), cw, ch };
  }

  function bindAttribs(buf) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc.aPos); gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(loc.aNrm); gl.vertexAttribPointer(loc.aNrm, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(loc.aUv); gl.vertexAttribPointer(loc.aUv, 2, gl.FLOAT, false, 32, 24);
  }

  function draw() {
    needsRender = false;
    if (!gl) return;
    const { mvp, cw, ch } = camMatrix();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!site || !terrainBuf) { labelsEl.innerHTML = ''; return; }
    gl.useProgram(prog);
    gl.uniformMatrix4fv(loc.uMVP, false, mvp);
    const lx = -0.45, ly = 0.8, lz = -0.4, ll = Math.hypot(lx, ly, lz);
    gl.uniform3f(loc.uLight, lx / ll, ly / ll, lz / ll);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc.uTex, 0);
    // terrain
    bindAttribs(terrainBuf);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, terrainIdx);
    gl.uniform1f(loc.uUseTex, 1); gl.uniform4f(loc.uColor, 1, 1, 1, 1);
    gl.drawElements(gl.TRIANGLES, terrainCount, gl.UNSIGNED_INT, 0);
    // buildings
    if (boxCount) {
      bindAttribs(boxBuf);
      gl.uniform1f(loc.uUseTex, 0);
      for (const b of boxDraws) { gl.uniform4fv(loc.uColor, b.color); gl.drawArrays(gl.TRIANGLES, b.start, b.count); }
    }
    // labels
    labelsEl.innerHTML = '';
    for (const l of labels) {
      const p = l.pos;
      const x = mvp[0] * p[0] + mvp[4] * p[1] + mvp[8] * p[2] + mvp[12];
      const y = mvp[1] * p[0] + mvp[5] * p[1] + mvp[9] * p[2] + mvp[13];
      const w = mvp[3] * p[0] + mvp[7] * p[1] + mvp[11] * p[2] + mvp[15];
      if (w <= 0) continue;
      const sx = ((x / w + 1) / 2) * cw, sy = ((1 - y / w) / 2) * ch;
      if (sx < -50 || sy < -20 || sx > cw + 50 || sy > ch + 20) continue;
      const d = document.createElement('div');
      d.className = 'label ' + l.kind;
      d.textContent = l.text;
      d.style.left = sx + 'px'; d.style.top = sy + 'px';
      labelsEl.appendChild(d);
    }
  }

  // ---------------------------------------------------------------------------------- mouse / touch
  function attachControls() {
    let drag = null;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey || e.button === 1 };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      const c = V.cam;
      if (drag.pan) {
        const s = c.dist / Math.max(300, canvas.clientHeight) * 1.1;
        const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
        // screen-right on the ground is (cos yaw, -sin yaw); screen-up is (-sin yaw, -cos yaw)
        c.target[0] -= (dx * cy + dy * sy) * s;
        c.target[2] -= (-dx * sy + dy * cy) * s;
      } else {
        c.yaw -= dx * 0.006;
        c.pitch = Math.max(0.12, Math.min(1.55, c.pitch + dy * 0.005));
      }
      V.render();
    });
    const end = () => { drag = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      V.cam.dist = Math.max(80, Math.min(40000, V.cam.dist * Math.exp(e.deltaY * 0.0012)));
      V.render();
    }, { passive: false });
  }

  V.setExaggeration = function (v) {
    const old = V.exaggeration;
    V.exaggeration = v;
    V.cam.target[1] *= v / old;
    V.refresh();
  };
})();
