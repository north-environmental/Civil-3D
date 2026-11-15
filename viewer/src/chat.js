/* chat.js: the Claude chat panel.
 *
 * Uses the Claude artifact "sample" capability (Ask Claude) with the app's commands as tools.
 * There is no API key: when the viewer is published as a Claude artifact, each message runs on
 * the viewer's own Claude account after they allow it. Opened as a plain file, chat is unavailable
 * and Test mode is the way to exercise the commands.
 *
 * Each message sends: standing instructions + the current site state (as a leading user turn),
 * then the conversation so far, ending with the new message. Every tool call runs the same
 * command as the Test-mode buttons, so all numbers come from the app's code.
 */
'use strict';
(function () {
  const app = LD.app, esc = LD.fmt.esc;
  const $ = (id) => document.getElementById(id);
  const C = (LD.chat = {
    sample: null,          // the sample function, once available
    status: 'checking',    // checking | ready | unavailable | declined | no-tools
    turns: [],             // [{role, content}] sent to Claude (page-kept history)
    messages: [],          // what the panel shows: {role, text, actions[], error?, pending?}
    busy: false,
    ctl: null,
    notes: [],             // app notes for Claude's next turn (e.g. the user pressed Undo)
    modelTier: 'default',
  });

  const MAX_TURNS = 30;

  const RULES = `You are the design assistant inside EFCG's Land Development Viewer, a concept-level site test-fit tool shown to client executives. The user sees a 3D view of one property and a chat panel; you change the design only by calling the app's tools.

How to work:
- The app does ALL engineering math. Never estimate or compute areas, distances, setbacks, earthwork volumes, elevations or stall counts yourself. Call the tools and report the numbers they return, with units.
- To change the design use addBuilding, moveElement, setPadElevation, addParking, runGrading and checkSetbacks. Use getSiteSummary or listElements if you need more than the state below.
- Coordinates are PA South State Plane feet: x = east, y = north. "Move it 100 ft north" = moveElement with dyFt 100. If the user gives no position, leave the centre out and the app uses the middle of the buildable area.
- Sizes: a building area in square feet needs a width and depth (e.g. 400,000 SF could be 800 x 500 ft); pick a sensible rectangle and say which you chose.
- After adding or moving buildings or parking, call checkSetbacks and report any failures. Call runGrading when the user asks about earthwork, cut and fill, pad elevations or balancing; earthwork results go out of date after any edit.
- If a tool returns an error, explain it in plain words and either fix the input or ask the user.
- You cannot undo. If the user wants to undo, tell them to press Undo on the action card in the chat.

How to reply:
- Short: two to five sentences, or a few bullets. Plain English for business executives; explain terms like "cut", "fill" or "setback" briefly if needed.
- Numbers with thousands separators and units (SF, ac, ft, CY). Don't quote coordinates unless asked.
- When zoning matters, mention that the zoning values are unverified and must be confirmed with the township.
- Only describe changes that a tool actually made.`;

  // ------------------------------------------------------------------------------- tools
  function toolList() {
    return LD.commands.list.map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
      inputSchema: stripSchema(cmd.inputSchema),
      execute(input) {
        const msg = C.current;
        const act = { name: cmd.name, title: cmd.title, input, pending: true };
        if (msg && !cmd.readOnly) msg.actions.push(act);
        renderMessages();
        const r = LD.commands.execute(cmd.name, input || {}, 'chat');
        act.pending = false;
        act.ok = r.ok;
        act.summary = r.ok ? r.summary : r.error;
        act.seq = r.entry ? r.entry.seq : null;
        renderMessages();
        if (!r.ok) throw new Error(r.error);
        const out = JSON.stringify({ result: r.summary, data: r.data });
        return out.length > 30000 ? JSON.stringify({ result: r.summary }) : JSON.parse(out);
      },
    }));
  }
  function stripSchema(s) {
    return JSON.parse(JSON.stringify(s, (k, v) => (k.startsWith('x-') ? undefined : v)));
  }

  function stateTurn() {
    const s = LD.commands.siteSummary();
    delete s.warnings;
    return RULES + '\n\nSite caveats: ' + (app.site.meta.warnings || []).join(' ') +
      '\n\nCURRENT SITE STATE (JSON, refreshed every message):\n' + JSON.stringify(s);
  }

  // ------------------------------------------------------------------------------- sending
  async function send(text) {
    text = String(text || '').trim();
    if (!text || C.busy) return;
    if (!app.site) { C.messages.push({ role: 'assistant', text: 'Load a site package first.', actions: [], error: true }); renderMessages(); return; }
    if (!C.sample) return;
    const userContent = (C.notes.length ? '[App note: ' + C.notes.join(' ') + ']\n\n' : '') + text;
    C.notes = [];
    C.messages.push({ role: 'user', text, actions: [] });
    C.turns.push({ role: 'user', content: userContent });
    while (C.turns.length > MAX_TURNS) C.turns.shift();
    while (C.turns.length && C.turns[0].role !== 'user') C.turns.shift();
    const msg = { role: 'assistant', text: '', actions: [], pending: true };
    C.messages.push(msg);
    C.current = msg;
    C.busy = true;
    C.ctl = new AbortController();
    renderMessages();
    updateComposer();
    try {
      const res = await C.sample([{ role: 'user', content: stateTurn() }, ...C.turns], {
        tools: toolList(),
        modelTier: C.modelTier,
        cache: false,
        signal: C.ctl.signal,
        onText: ({ text: t }) => { msg.text = t; renderMessages(); },
      });
      msg.text = res.text;
      if (res.truncated) msg.note = 'The answer was cut short. Ask for less at a time.';
    } catch (e) {
      msg.text = e && e.text ? e.text : msg.text;
      if (!e || e.code !== 'cancelled') { msg.error = true; msg.note = errorText(e); }
      else msg.note = 'Stopped.';
      if (e && (e.code === 'not_granted' || e.code === 'sampling_disabled')) C.status = 'declined';
      if (e && e.code === 'tools_unavailable') C.status = 'no-tools';
    } finally {
      msg.pending = false;
      C.busy = false;
      C.current = null;
      const acts = msg.actions.filter((a) => !a.pending).map((a) => `${a.title}: ${a.ok ? a.summary : 'failed: ' + a.summary}`);
      const content = (msg.text || '(no reply)') + (acts.length ? '\n\n(App actions this turn: ' + acts.join(' | ') + ')' : '');
      C.turns.push({ role: 'assistant', content });
      renderMessages();
      updateComposer();
    }
  }

  function errorText(e) {
    const code = e && e.code;
    return ({
      not_granted: 'Chat is not allowed for this page. If you declined by mistake, reload the page to be asked again.',
      sampling_disabled: 'Claude is not available for this account or organization.',
      rate_limited: 'Too many requests right now. Wait a minute, then try again.',
      session_expired: 'Your Claude session expired. Sign in again, then retry.',
      refused: 'Claude declined that request. Try asking a different way.',
      empty_completion: 'Claude did not reply. Try a simpler request.',
      prompt_too_large: 'The conversation is too long. Press New chat to start over.',
      tools_unavailable: "This Claude app can't run the viewer's tools. Use Test mode instead, or open the artifact on claude.ai.",
    })[code] || "Claude didn't answer (connection problem). Try again." + (code ? ' (' + code + ')' : '');
  }

  // ------------------------------------------------------------------------------- rendering
  function md(text) {
    const lines = esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split('\n');
    let html = '', inList = false;
    for (const l of lines) {
      const m = l.match(/^\s*[-*•]\s+(.*)/) || l.match(/^\s*\d+[.)]\s+(.*)/);
      if (m) { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + m[1] + '</li>'; continue; }
      if (inList) { html += '</ul>'; inList = false; }
      if (l.trim()) html += '<p>' + l + '</p>';
    }
    return html + (inList ? '</ul>' : '');
  }

  function renderMessages() {
    const box = $('chatMessages');
    if (!box) return;
    const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    const examples = ['Add a 400,000 SF warehouse in the buildable area', 'Put about 150 parking stalls south of the warehouse',
      'Balance the earthwork and tell me the cut and fill', 'Do we pass all the setbacks?'];
    let h = '';
    if (!C.messages.length) {
      h += `<div class="chat-empty"><p>Ask Claude to lay out the site. It changes the design only through the app's commands, and the app does all the math. Each change shows up here with an <b>Undo</b> button.</p>
        <div class="chips">${examples.map((x) => `<button class="chip" data-ex="${esc(x)}" ${C.status === 'ready' ? '' : 'disabled'}>${esc(x)}</button>`).join('')}</div></div>`;
    }
    for (const m of C.messages) {
      if (m.role === 'user') { h += `<div class="msg user">${esc(m.text)}</div>`; continue; }
      h += '<div class="msg assistant">';
      for (const a of m.actions) {
        const live = a.seq != null && app.history.some((x) => x.seq === a.seq);
        const undone = a.seq != null && !live && a.ok;
        h += `<div class="action ${a.pending ? 'pending' : a.ok ? (undone ? 'undone' : 'ok') : 'err'}">
          <div class="act-head"><span class="act-icon">${a.pending ? '…' : a.ok ? (undone ? '↶' : '✓') : '✗'}</span><b>${esc(a.title)}</b>
          ${live ? `<button class="btn small undo" data-seq="${a.seq}">Undo</button>` : undone ? '<span class="pill">undone</span>' : ''}</div>
          ${a.summary ? `<div class="act-sum">${esc(a.summary)}</div>` : ''}</div>`;
      }
      if (m.text) h += `<div class="msg-text">${md(m.text)}</div>`;
      else if (m.pending) h += `<div class="msg-text muted">${m.actions.length ? 'Working…' : 'Thinking…'}</div>`;
      if (m.note) h += `<div class="msg-note ${m.error ? 'fail' : 'muted'}">${esc(m.note)}</div>`;
      h += '</div>';
    }
    box.innerHTML = h;
    for (const b of box.querySelectorAll('[data-ex]')) b.onclick = () => { $('chatInput').value = b.dataset.ex; $('chatInput').focus(); };
    for (const b of box.querySelectorAll('button.undo')) b.onclick = () => undoFromCard(b, Number(b.dataset.seq));
    if (stick) box.scrollTop = box.scrollHeight;
  }

  function undoFromCard(btn, seq) {
    const later = app.history.filter((x) => x.seq > seq).length;
    if (later && btn.dataset.armed !== '1') {
      btn.dataset.armed = '1';
      btn.textContent = `Also undoes ${later} later step${later > 1 ? 's' : ''}. Click again`;
      setTimeout(() => { if (btn.isConnected) { btn.dataset.armed = ''; btn.textContent = 'Undo'; } }, 5000);
      return;
    }
    const entries = app.history.filter((x) => x.seq >= seq).map((x) => x.title + ' (' + x.summary.split(/\.\s/)[0] + ')');
    const r = LD.commands.undoTo(seq);
    if (r.ok) C.notes.push('The user pressed Undo, which rolled back: ' + entries.join('; ') + '. The current site state reflects this.');
    renderMessages();
  }

  function updateComposer() {
    if (!$('chatInput')) return;
    const ready = C.status === 'ready' && !!app.site;
    $('chatInput').disabled = !ready || C.busy;
    $('chatSend').disabled = !ready || C.busy;
    $('chatSend').hidden = C.busy;
    $('chatStop').hidden = !C.busy;
    $('chatNew').disabled = C.busy;
    const s = $('chatStatus');
    const msgs = {
      checking: 'Connecting to Claude…',
      unavailable: 'Chat works once this viewer is published as a Claude artifact. Here, use Test mode (top right) to run the same commands.',
      declined: 'Chat is turned off for this page. Reload the page to be asked again.',
      'no-tools': "This Claude app can't run the viewer's tools. Open the artifact on claude.ai, or use Test mode.",
    };
    s.hidden = C.status === 'ready' && !!app.site;
    s.textContent = !app.site && C.status === 'ready' ? 'Load a site package to start chatting.' : msgs[C.status] || '';
  }

  C.render = function () { renderMessages(); updateComposer(); };

  C.init = async function () {
    $('chatTabBtn').hidden = false;
    $('tab-chat').classList.add('chat');
    $('tab-chat').innerHTML = `<div class="chat-status" id="chatStatus"></div>
      <div class="chat-messages" id="chatMessages"></div>
      <form class="composer" id="chatForm">
        <textarea id="chatInput" rows="2" placeholder="Ask Claude to change the layout…"></textarea>
        <div class="composer-row">
          <select id="chatTier" class="small" title="Fast replies quickly; Thorough thinks longer">
            <option value="default">Thorough</option><option value="quick">Fast</option></select>
          <button type="button" class="btn small" id="chatNew" title="Clear the conversation (the design stays)">New chat</button>
          <span class="spacer"></span>
          <button type="button" class="btn small" id="chatStop" hidden>Stop</button>
          <button type="submit" class="btn small primary" id="chatSend">Send</button>
        </div></form>`;
    $('chatForm').onsubmit = (e) => { e.preventDefault(); const t = $('chatInput').value; $('chatInput').value = ''; send(t); };
    $('chatInput').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('chatForm').requestSubmit(); } };
    $('chatStop').onclick = () => C.ctl && C.ctl.abort();
    $('chatNew').onclick = () => { C.turns = []; C.messages = []; C.notes = []; C.render(); };
    $('chatTier').onchange = (e) => { C.modelTier = e.target.value; };
    C.render();
    let sample = null;
    try { sample = window.claude && window.claude.use ? await window.claude.use('sample') : null; } catch (e) { sample = null; }
    C.attach(sample);
  };

  /** Connect a sample function (or null when chat is unavailable). */
  C.attach = async function (sample) {
    C.sample = sample;
    if (!sample) { C.status = 'unavailable'; C.render(); return; }
    C.status = 'ready';
    try {
      const lim = sample.limits ? await sample.limits() : null;
      if (lim && !lim.tools) C.status = 'no-tools';
    } catch (e) { /* treat as ready; a real call will report problems */ }
    if (C.status === 'ready' && LD.ui && LD.ui.activeTab === 'design' && !app.history.length) LD.ui.showTab('chat');
    C.render();
  };
  C.send = send;
})();
