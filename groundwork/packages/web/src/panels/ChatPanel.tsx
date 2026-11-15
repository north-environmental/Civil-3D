/**
 * Chat tab: describe what to build in plain words. The server answers with Claude (through Claude
 * Code on this computer) when it is available, otherwise with the built-in parser. Either way the
 * plan changes only through commands, so everything shows up in the Activity log and can be undone.
 */
import { useEffect, useRef, useState } from 'react';
import { app, chatAction, sendChat, toast, useApp } from '../lib/app';
import { exportPlanPng } from '../plan/exportPng';

const handledActions = new Set<number>();

/** Minimal formatting for replies: paragraphs, "- " bullets and **bold**. Everything else is plain text. */
function ChatText({ text }: { text: string }) {
  const bold = (line: string, key: number) => {
    const parts = line.split(/\*\*(.+?)\*\*/g);
    return <span key={key}>{parts.map((p, i) => (i % 2 ? <strong key={i}>{p}</strong> : p))}</span>;
  };
  const blocks: { bullets: boolean; lines: string[] }[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      blocks.push({ bullets: false, lines: [] });
      continue;
    }
    const isBullet = /^\s*[-*•]\s+/.test(line);
    const cur = blocks[blocks.length - 1];
    if (cur && cur.bullets === isBullet && cur.lines.length) cur.lines.push(line);
    else blocks.push({ bullets: isBullet, lines: [line] });
  }
  return (
    <div className="chat-text">
      {blocks
        .filter((b) => b.lines.length)
        .map((b, i) =>
          b.bullets ? (
            <ul key={i}>
              {b.lines.map((l, j) => (
                <li key={j}>{bold(l.replace(/^\s*[-*•]\s+/, ''), j)}</li>
              ))}
            </ul>
          ) : (
            <p key={i}>{b.lines.map((l, j) => bold(j ? ` ${l}` : l, j))}</p>
          ),
        )}
    </div>
  );
}

export function ChatPanel() {
  const chat = useApp((s) => s.chat);
  const connected = useApp((s) => s.connected);
  const site = useApp((s) => s.project?.site ?? null);
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messages = chat?.messages ?? [];
  const busy = chat?.busy ?? false;
  const last = messages[messages.length - 1];

  // Keep the newest message in view.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, last?.text, last?.steps.length, last?.status]);

  // Browser-side follow-ups requested by a finished reply (e.g. "save the plan as a PNG").
  useEffect(() => {
    for (const m of messages) {
      if (m.status !== 'done' || !m.clientActions?.length || handledActions.has(m.id)) continue;
      handledActions.add(m.id);
      if (m.clientActions.includes('exportPng'))
        exportPlanPng()
          .then((name) => toast(`Saved ${name}. Look in your browser’s Downloads folder.`))
          .catch((err) => toast(`PNG export failed: ${(err as Error).message}`));
    }
  }, [messages]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || busy || !connected) return;
    setDraft('');
    void sendChat(t);
  };

  return (
    <div className="chat" data-testid="chat-panel">
      <div className="chat-head">
        <span className={`chat-engine ${chat?.engine ?? ''}`} title={chat?.engineNote ?? ''} data-testid="chat-engine">
          <span className="dot" />
          {chat ? chat.engineLabel : 'Connecting…'}
        </span>
        <span className="spacer" />
        {busy && (
          <button className="btn small" onClick={() => void chatAction('stop')} title="Stop the current reply">
            ■ Stop
          </button>
        )}
        <button className="btn small" disabled={!messages.length || busy} onClick={() => void chatAction('reset')} title="Clear this conversation (the design is kept)">
          New chat
        </button>
      </div>

      <div className="chat-list" ref={listRef}>
        {!messages.length && (
          <div className="chat-empty">
            <h3>Describe what you want to build</h3>
            <p>
              {site
                ? `The plan on the left is ${site.name}. Say what should go on it and it will be drawn there, checked against the zoning rules, and explained here.`
                : 'Start by loading the site, then say what should go on it. It will be drawn on the plan, checked against the zoning rules, and explained here.'}
            </p>
            <div className="chat-examples">
              {[...(site ? [] : ['Load 1625 Heilmandale Rd']), ...(chat?.examples ?? [])].map((ex) => (
                <button key={ex} disabled={busy || !connected} onClick={() => send(ex)}>
                  {ex}
                </button>
              ))}
            </div>
            {chat?.engine === 'builtin' && <p className="chat-note">{chat.engineNote}</p>}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.role} ${m.status}`} data-testid={`chat-${m.role}`}>
            {m.steps.length > 0 && (
              <div className="chat-steps">
                {m.steps.map((st, i) => (
                  <div key={i} className={`chat-step ${st.ok ? '' : 'bad'}`} title={st.summary}>
                    <span className="mark">{st.ok ? (st.summary === 'working…' ? '…' : '✓') : '✕'}</span>
                    <span className="name">{st.label}</span>
                    <span className="sum">{st.summary}</span>
                  </div>
                ))}
              </div>
            )}
            {m.text && <ChatText text={m.text} />}
            {m.status === 'running' && !m.text && <div className="chat-text dim">{m.steps.length ? 'Working…' : 'Thinking…'}</div>}
          </div>
        ))}
      </div>

      <div className="chat-input">
        <textarea
          ref={inputRef}
          value={draft}
          rows={3}
          placeholder={site ? 'e.g. 410,000 SF cross-dock parallel to Heilmandale Rd, trucks from Heilmandale Rd, cars only from Orange Ln' : 'e.g. Load 1625 Heilmandale Rd'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation(); // plan shortcuts (S, T, 2, 3 …) must not fire while typing
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
          data-testid="chat-input"
        />
        <button className="btn primary" disabled={!draft.trim() || busy || !connected} onClick={() => send(draft)} data-testid="chat-send">
          {busy ? 'Working…' : 'Send'}
        </button>
      </div>
      <div className="chat-foot">
        Enter to send · Shift+Enter for a new line · every change can be undone (↶) ·{' '}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            app.set({ dataOpen: true });
          }}
        >
          where the site data comes from
        </a>
      </div>
    </div>
  );
}
