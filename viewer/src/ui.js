/* ui.js: the page: loading packages, the side panel (Design / Site / Test), test-mode forms. */
'use strict';
(function () {
  const app = LD.app, F = LD.fmt, esc = LD.fmt.esc;
  const $ = (id) => document.getElementById(id);
  const UI = (LD.ui = { activeTab: 'design', testResults: {} });

  // ------------------------------------------------------------------------------- loading
  function busy(on, text) {
    $('busy').hidden = !on;
    if (text) $('busyText').textContent = text;
  }

  UI.loadPackageObject = function (pkg, label) {
    const site = LD.site.load(pkg);
    app.setSite(site);
    LD.view.setSite(site);
    $('emptyState').hidden = true;
    $('viewTools').hidden = false;
    $('legend').hidden = false;
    $('siteName').textContent = site.meta.siteName + ' · ' + site.meta.municipality + ', ' + site.meta.county + ' County' + (label ? ' · ' + label : '');
    $('baseLayer').value = LD.view.baseLayer;
    $('baseLayer').querySelector('option[value=aerial]').disabled = !site.imagery;
    renderAll();
  };

  function loadText(text, label) {
    busy(true, 'Reading the site package…');
    setTimeout(() => {
      try {
        UI.loadPackageObject(JSON.parse(text), label);
      } catch (e) {
        alert('Could not open that file.\n\n' + (e.userMessage || (e instanceof SyntaxError ? 'It is not valid JSON.' : e.message)));
        console.error(e);
      } finally { busy(false); }
    }, 30);
  }

  function initLoading() {
    $('loadBtn').onclick = () => $('fileInput').click();
    $('fileInput').onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => loadText(r.result, f.name);
      r.onerror = () => alert('Could not read that file.');
      r.readAsText(f);
      e.target.value = '';
    };
    // A package built into the page (published demo), else ?pkg=<same-site path> (local testing).
    const emb = document.getElementById('embedded-site-package');
    const q = new URLSearchParams(location.search).get('pkg');
    if (emb && emb.textContent.trim()) loadText(emb.textContent, null);
    else if (q && !/^[a-z]+:/i.test(q) && !q.startsWith('//')) {
      busy(true, 'Loading ' + q + '…');
      fetch(q).then((r) => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)))).then((t) => loadText(t, null))
        .catch((e) => { busy(false); alert('Could not load ' + q + ': ' + e.message); });
    }
  }

  // ------------------------------------------------------------------------------- tabs
  function showTab(name) {
    UI.activeTab = name;
    for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('active', b.dataset.tab === name);
    for (const t of ['design', 'site', 'chat', 'test']) $('tab-' + t).hidden = t !== name;
  }
  UI.showTab = showTab;

  // ------------------------------------------------------------------------------- Design tab
  function renderDesign() {
    const el = $('tab-design');
    if (!app.site) { el.innerHTML = '<p class="muted">No site loaded.</p>'; return; }
    const st = app.state;
    let h = '<h2>Elements</h2>';
    if (!st.elements.length) h += '<p class="muted small">Nothing placed yet. Turn on <b>Test mode</b> (top right) to add a building or parking with the command buttons' + (LD.chat ? ', or ask Claude in the Chat tab' : '') + '.</p>';
    for (const e of st.elements) {
      const d = LD.commands.describeEl(e);
      if (e.type === 'building') {
        h += `<div class="card"><h3>${esc(e.id)} · ${esc(e.name)} ${d.insideBuildableArea ? '<span class="pill ok">inside setbacks</span>' : '<span class="pill bad">crosses setback</span>'}</h3>
          <table class="kv"><tr><td>Size</td><td>${F.n(e.widthFt)} x ${F.n(e.depthFt)} ft · ${F.sf(d.footprintSf)} (${F.ac(d.footprintSf / 43560)})</td></tr>
          <tr><td>Height</td><td>${F.ft(e.heightFt, 0)}</td></tr>
          <tr><td>Finished floor</td><td>${F.ft(e.padElevFt, 2)} <span class="muted small">(${{ auto: 'follows ground', set: 'set by hand', balanced: 'balances earthwork' }[e.padElevSource] || ''})</span></td></tr>
          <tr><td>Existing ground under it</td><td>${F.ft(d.existingGroundAvgFt)} average</td></tr>
          <tr><td>Centre (E, N)</td><td class="small">${F.n(e.cxFt, 0)}, ${F.n(e.cyFt, 0)} · rotated ${F.n(e.rotationDeg, 1)}°</td></tr></table></div>`;
      } else {
        h += `<div class="card"><h3>${esc(e.id)} · ${esc(e.name)} ${d.insideParkingArea ? '<span class="pill ok">inside setbacks</span>' : '<span class="pill bad">crosses setback</span>'}</h3>
          <table class="kv"><tr><td>Stalls</td><td><b>${F.n(d.stallsTotal)}</b> (${F.n(d.stallsStandard)} standard, ${d.stallsAccessible} accessible incl. ${d.stallsVanAccessible} van)</td></tr>
          <tr><td>Size</td><td>${F.n(e.lengthFt)} x ${F.n(d.depthFt)} ft, ${e.rows} rows · ${F.sf(d.footprintSf)}</td></tr>
          <tr><td>Surface at centre</td><td>${F.ft(e.elevFt, 2)} at ${d.slopePct}% slope</td></tr>
          <tr><td>Existing ground</td><td>${F.ft(d.existingGroundAvgFt)} average</td></tr></table></div>`;
      }
    }
    const g = st.grading;
    if (g) {
      h += `<h2>Earthwork ${g.stale ? '<span class="pill warn">out of date: run grading again</span>' : ''}</h2>
        <div class="card ${g.stale ? 'stale' : ''}">
        <div class="stats"><div><b>${F.n(g.cutCy)}</b><span>cut, CY</span></div><div><b>${F.n(g.fillCy)}</b><span>fill, CY</span></div>
        <div><b class="${g.netCy >= 0 ? '' : 'fail'}">${F.n(Math.abs(g.netCy))}</b><span>net ${g.netCy >= 0 ? 'surplus' : 'shortfall'}, CY</span></div></div>
        <table class="kv small">
        <tr><td>Building pads</td><td>${F.n(g.byPart.buildingPads.cutCy)} cut / ${F.n(g.byPart.buildingPads.fillCy)} fill CY</td></tr>
        <tr><td>Parking</td><td>${F.n(g.byPart.parking.cutCy)} cut / ${F.n(g.byPart.parking.fillCy)} fill CY</td></tr>
        <tr><td>Side slopes (${g.slopeRatio}:1)</td><td>${F.n(g.byPart.sideSlopes.cutCy)} cut / ${F.n(g.byPart.sideSlopes.fillCy)} fill CY</td></tr>
        <tr><td>Deepest cut / fill</td><td>${F.ft(g.maxCutFt)} / ${F.ft(g.maxFillFt)}</td></tr>
        <tr><td>Disturbed area</td><td>${F.ac(g.disturbedAc)}</td></tr>
        <tr><td>Retaining walls</td><td>${g.walls.length ? g.walls.map((w) => `${F.n(w.lengthFt)} ft long, up to ${F.ft(w.maxHeightFt)}`).join('<br>') : 'none'}</td></tr>
        <tr><td>Grading off the property</td><td>${g.offsiteGradingSf ? `<span class="fail">${F.sf(g.offsiteGradingSf)}, up to ${F.ft(g.offsiteMaxDepthFt)}</span>` : 'none'}</td></tr>
        </table><p class="muted small">Net = cut x (1 - ${g.shrinkPct}% shrink) - fill. ${g.gridCellFt} ft grid. Concept-level.</p></div>`;
    }
    const c = st.checks;
    if (c) {
      h += `<h2>Zoning checks ${c.stale ? '<span class="pill warn">out of date: check again</span>' : c.failing ? `<span class="pill bad">${c.failing} fail</span>` : '<span class="pill ok">all pass</span>'}</h2>
        <div class="card ${c.stale ? 'stale' : ''}"><table class="grid"><tr><th></th><th>Check</th><th>Result</th><th>Section</th></tr>` +
        c.rows.map((r) => `<tr><td class="${r.informational ? 'info' : r.pass ? 'pass' : 'fail'}">${r.informational ? '!' : r.pass ? '✓' : '✗'}</td>
          <td>${esc(r.id)}<br><span class="muted small">${esc(r.check)}</span></td><td class="small">${esc(r.message)}</td><td class="small">${r.section ? '§ ' + esc(r.section) : ''}</td></tr>`).join('') +
        `</table>${c.zoningVerified ? '' : '<p class="muted small">Zoning values are from an unofficial copy of the code: verify with the township.</p>'}</div>`;
    }
    h += '<h2>History</h2>';
    if (!app.history.length) h += '<p class="muted small">Changes appear here, each with an Undo button.</p>';
    for (const e of app.history.slice().reverse())
      h += `<div class="hist"><span class="src">${esc(e.source)}</span><div class="txt"><b>${esc(e.title)}</b> — ${esc(e.summary)}</div>
        <button class="btn small" data-undo="${e.seq}" title="Undo this step (and anything after it)">Undo</button></div>`;
    el.innerHTML = h;
    for (const b of el.querySelectorAll('[data-undo]')) b.onclick = () => UI.undo(Number(b.dataset.undo));
  }

  UI.undo = function (seq) {
    const later = app.history.filter((h) => h.seq > seq).length;
    if (later && !confirm(`Undoing this step also undoes the ${later} step${later > 1 ? 's' : ''} after it. Continue?`)) return false;
    const r = LD.commands.undoTo(seq);
    if (!r.ok) alert(r.error);
    return r.ok;
  };

  // ------------------------------------------------------------------------------- Site tab
  function renderSite() {
    const el = $('tab-site');
    const s = app.site;
    if (!s) { el.innerHTML = '<p class="muted">No site loaded.</p>'; return; }
    const md = s.meta, z = s.zoning, pk = s.pkg;
    const fronts = [...new Set(s.edges.filter((e) => e.type === 'front').map((e) => e.road))];
    let h = `<h2>Site</h2><table class="kv">
      <tr><td>Address</td><td>${esc(md.address)}</td></tr>
      <tr><td>Municipality</td><td>${esc(md.municipality)}, ${esc(md.county)} County, ${esc(md.state)}</td></tr>
      <tr><td>Parcel</td><td>${esc(md.parcelId)}</td></tr>
      <tr><td>Area</td><td>${F.ac(s.parcelAreaSf / 43560)}${pk.parcel.recordAreaAc ? ` <span class="muted small">(record ${F.ac(pk.parcel.recordAreaAc)})</span>` : ''}</td></tr>
      <tr><td>Road frontage</td><td>${fronts.length ? esc(fronts.join(', ')) : 'none found'}</td></tr>
      <tr><td>Ground on parcel</td><td>${F.ft(s.elevMinFt)} to ${F.ft(s.elevMaxFt)} (NAVD88)</td></tr>
      <tr><td>Terrain grid</td><td>${pk.terrain.cellSizeFt} ft cells, ${F.n(pk.terrain.cols)} x ${F.n(pk.terrain.rows)}</td></tr>
      <tr><td>Buildable area</td><td>${F.ac(pk.derived.buildingEnvelopeAreaAc, 1)} buildings · ${F.ac(pk.derived.parkingEnvelopeAreaAc, 1)} parking</td></tr>
      </table>`;
    h += `<h2>Zoning: ${esc(z.district || 'unknown')} ${esc(z.districtName || '')} ${z.verified ? '<span class="pill ok">verified</span>' : '<span class="pill warn">not verified</span>'}</h2>
      <table class="grid"><tr><th>Limit</th><th class="num">Value</th><th>Section</th></tr>`;
    const labels = { frontSetbackFt: 'Front setback', sideSetbackFt: 'Side setback', rearSetbackFt: 'Rear setback', residentialSeparationFt: 'From residential district',
      maxHeightFt: 'Max height', maxLotCoveragePct: 'Max lot coverage', minLotAreaAc: 'Min lot area', minLotWidthFt: 'Min lot width', minLandscapedPct: 'Min landscaped',
      parkingSetbackFromRowFt: 'Parking from road ROW', parkingSetbackSideRearFt: 'Parking from side/rear', parkingSetbackFromResidentialFt: 'Parking from residential',
      stallWidthFt: 'Stall width', stallLengthFt: 'Stall length', aisleWidthFt: 'Aisle width', maxParkingGradePct: 'Max parking grade' };
    for (const [k, v] of Object.entries(z.values || {})) {
      const unit = k.endsWith('Pct') ? '%' : k.endsWith('Ac') ? ' ac' : ' ft';
      h += `<tr title="${esc(v.note || '')}"><td>${esc(labels[k] || k)}</td><td class="num">${v.value == null ? '<span class="muted">unknown</span>' : F.n(v.value, v.value % 1 ? 1 : 0) + unit}</td><td class="small">${v.section ? '§ ' + esc(v.section) : esc(v.note || '')}</td></tr>`;
    }
    h += '</table>';
    if ((z.parkingRatios || []).length) h += '<p class="small muted">Parking ratios: ' + z.parkingRatios.map((r) => `${esc(r.use)}: ${esc(r.rule)} (§ ${esc(r.section)})`).join('; ') + '</p>';
    h += '<h2>Data found</h2><table class="grid">';
    const names = { roads: 'Roads', buildings: 'Existing buildings', streams: 'Streams', wetlands: 'Wetlands', floodplain: 'Floodplain' };
    for (const [k, n] of Object.entries(names)) {
      const f = s.features[k] || { status: 'skipped', items: [] };
      const st = f.status === 'found' ? `<span class="pass">${f.items.length} found</span>` : f.status === 'none_found' ? 'none here' : `<span class="fail">unknown</span> <span class="muted small">${esc(f.reason || '')}</span>`;
      h += `<tr><td>${n}</td><td>${st}</td></tr>`;
    }
    h += `<tr><td>Aerial photo</td><td>${s.imagery ? esc(s.imagery.source) + ' (' + esc(s.imagery.dataDate || 'date unknown') + ')' : 'not included'}</td></tr></table>`;
    if ((md.warnings || []).length) h += '<h2>Things to know</h2><ul class="warn">' + md.warnings.map((w) => `<li>${esc(w)}</li>`).join('') + '</ul>';
    h += '<h2>Sources</h2><ul class="warn small">' + (md.sources || []).map((x) => `<li>${esc(x.name)}${x.dataDate ? ' · ' + esc(x.dataDate) : ''}</li>`).join('') + '</ul>';
    h += `<p class="muted small">Package made ${esc((md.createdAt || '').slice(0, 10))}. Coordinates: PA South State Plane (EPSG:2272), US survey feet.</p>`;
    el.innerHTML = h;
  }

  // ------------------------------------------------------------------------------- Test tab
  function defaultFor(cmd, key) {
    const els = app.state ? app.state.elements : [];
    if (cmd.name === 'setPadElevation' && key === 'elevationFt') {
      const b = els.find((e) => e.id === 'B1') || els[0];
      return b ? LD.round((b.type === 'building' ? b.padElevFt : b.elevFt) + 2, 1) : '';
    }
    const v = cmd.testInput ? cmd.testInput[key] : undefined;
    return v == null ? '' : v;
  }

  function renderTest() {
    const el = $('tab-test');
    if (!app.site) { el.innerHTML = '<p class="muted">Load a site package first.</p>'; return; }
    let h = `<p class="small muted">Each command below is exactly what Claude will call from the chat. Values are pre-filled; change them and press Run.
      Coordinates are PA South State Plane feet (blank = let the app choose).</p>
      <div class="card"><h3>Self-checks <span class="pill">hand calculations</span></h3>
      <p class="small muted">Runs the engineering math against answers worked out by hand.</p>
      <button class="btn small" id="runChecks">Run self-checks</button><div id="checkOut"></div></div>`;
    for (const cmd of LD.commands.list) {
      h += `<div class="card" id="card-${cmd.name}"><h3>${esc(cmd.title)} <span class="pill">${cmd.name}</span>${cmd.readOnly ? ' <span class="pill">read-only</span>' : ''}</h3>
        <div class="small muted">${esc(cmd.description)}</div><form class="cmd" data-cmd="${cmd.name}">`;
      const props = cmd.inputSchema.properties || {};
      const req = cmd.inputSchema.required || [];
      for (const [k, s] of Object.entries(props)) {
        const lab = esc(k) + (req.includes(k) ? ' *' : '');
        const full = s.type === 'string' && !s.enum && !s['x-ref'] ? ' full' : '';
        let field;
        if (s['x-ref']) {
          const els = app.state.elements.filter((e) => s['x-ref'] !== 'building' || e.type === 'building');
          const dv = String(defaultFor(cmd, k));
          field = `<select name="${k}">${req.includes(k) ? '' : '<option value="">(none)</option>'}${els.map((e) => `<option ${e.id === dv ? 'selected' : ''} value="${e.id}">${e.id} · ${esc(e.name)}</option>`).join('')}</select>`;
        } else if (s.enum) {
          const dv = defaultFor(cmd, k);
          field = `<select name="${k}"><option value="">(none)</option>${s.enum.map((v) => `<option ${v === dv ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
        } else {
          field = `<input name="${k}" value="${esc(defaultFor(cmd, k))}" ${s.type === 'number' || s.type === 'integer' ? 'inputmode="decimal"' : ''} placeholder="${s.default !== undefined ? 'default ' + s.default : ''}">`;
        }
        h += `<label class="${full}" title="${esc(s.description || '')}">${lab}${field}</label>`;
      }
      h += `<div class="full"><button class="btn small primary" type="submit">Run ${esc(cmd.title.toLowerCase())}</button></div></form>
        <div class="out" id="out-${cmd.name}">${UI.testResults[cmd.name] || ''}</div></div>`;
    }
    el.innerHTML = h;
    $('runChecks').onclick = runSelfChecks;
    if (UI.selfCheckHtml) $('checkOut').innerHTML = UI.selfCheckHtml;
    for (const f of el.querySelectorAll('form.cmd')) f.onsubmit = (e) => { e.preventDefault(); runFromForm(f); };
  }

  function resultHtml(r) {
    if (!r.ok) return `<div class="result err">✗ ${esc(r.error)}</div>`;
    return `<div class="result ok">✓ ${esc(r.summary)}</div><details><summary>Details (what Claude receives)</summary><pre>${esc(JSON.stringify(r.data, null, 2))}</pre></details>`;
  }

  function runFromForm(form) {
    const name = form.dataset.cmd;
    const input = {};
    for (const f of form.elements) if (f.name) input[f.name] = f.value;
    busy(true, 'Running ' + name + '…');
    setTimeout(() => {
      const t0 = performance.now();
      const r = LD.commands.execute(name, input, 'test');
      busy(false);
      UI.testResults[name] = resultHtml(r) + `<div class="muted small">${Math.round(performance.now() - t0)} ms</div>`;
      UI.lastResult = { name, r };
      renderAll();
      const out = $('out-' + name);
      if (out) out.scrollIntoView({ block: 'nearest' });
    }, 20);
  }

  function runSelfChecks() {
    busy(true, 'Running self-checks…');
    setTimeout(() => {
      const res = LD.selfcheck.runAll();
      busy(false);
      const pass = res.filter((r) => r.pass).length;
      UI.selfCheckHtml = `<p class="${pass === res.length ? 'pass' : 'fail'}"><b>${pass} of ${res.length} pass</b></p><table class="grid"><tr><th></th><th>Check</th><th>App result</th></tr>` +
        res.map((r) => `<tr><td class="${r.pass ? 'pass' : 'fail'}">${r.pass ? '✓' : '✗'}</td><td><b>${r.id}</b> ${esc(r.title)}<br><span class="muted small">Hand calc: ${esc(r.handCalc)}</span></td><td class="small">${esc(r.got)}</td></tr>`).join('') + '</table>';
      UI.lastSelfCheck = res;
      $('checkOut').innerHTML = UI.selfCheckHtml;
    }, 20);
  }

  // ------------------------------------------------------------------------------- wiring
  function renderAll() {
    renderDesign();
    renderSite();
    if (!$('tab-test').hidden || UI.testMode) renderTest();
    if (LD.chat && LD.chat.render) LD.chat.render();
  }
  UI.renderAll = renderAll;

  function init() {
    try {
      LD.view.init($('viewport'));
    } catch (e) {
      $('emptyState').innerHTML = '<h1>3D view not available</h1><p>' + esc(e.message) + '</p>';
    }
    for (const b of document.querySelectorAll('#tabs button')) b.onclick = () => { showTab(b.dataset.tab); if (b.dataset.tab === 'test') renderTest(); };
    $('testToggle').onchange = (e) => {
      UI.testMode = e.target.checked;
      $('testTabBtn').hidden = !UI.testMode;
      if (UI.testMode) { renderTest(); showTab('test'); } else if (UI.activeTab === 'test') showTab('design');
    };
    $('resetView').onclick = () => LD.view.resetView();
    $('topView').onclick = () => LD.view.topView();
    $('baseLayer').onchange = (e) => { LD.view.baseLayer = e.target.value; LD.view.refresh(); };
    $('cutFill').onchange = (e) => { LD.view.showCutFill = e.target.checked; LD.view.refresh(); };
    $('exag').oninput = (e) => { $('exagVal').textContent = e.target.value; LD.view.setExaggeration(Number(e.target.value)); };
    app.on((kind) => {
      if (kind === 'change') { LD.view.refresh(); renderAll(); }
    });
    if (LD.chat && LD.chat.init) LD.chat.init();
    renderAll();
    initLoading();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
