import { useEffect } from 'react';
import { app, connect, runCommand, setTheme, useApp } from './lib/app';
import { BottomBar } from './panels/BottomBar';
import { LeftPanel } from './panels/LeftPanel';
import { RightPanel } from './panels/RightPanel';
import { TopBar } from './panels/TopBar';
import { CenterView } from './panels/CenterView';
import { CompareDialog, DataDialog, HelpDialog } from './panels/HelpDialog';
import { RenderRoot } from './render/RenderRoot';

const params = new URLSearchParams(location.search);
const renderView = params.get('render');

export function App() {
  const theme = useApp((s) => s.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = renderView ? (params.get('theme') ?? 'dark') : theme;
  }, [theme]);
  useEffect(() => {
    if (renderView) return;
    connect();
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
        ev.preventDefault();
        void runCommand(ev.shiftKey ? 'redo' : 'undo');
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') {
        ev.preventDefault();
        void runCommand('redo');
        return;
      }
      if (typing) {
        if (ev.key === 'Escape') (t as HTMLInputElement).blur();
        return;
      }
      const s = app.get();
      switch (ev.key) {
        case '?':
          app.set({ helpOpen: !s.helpOpen });
          break;
        case 'Escape':
          app.set({ helpOpen: false, compareOpen: false, selection: null, tool: 'select', sectionLine: s.tool === 'section' ? null : s.sectionLine });
          break;
        case '2':
          app.set({ view: '2d' });
          break;
        case '3':
          app.set({ view: '3d' });
          break;
        case 's':
          app.set({ tool: s.tool === 'section' ? 'select' : 'section', view: '2d' });
          break;
        case 'c':
          app.set({ layers: { ...s.layers, cutfill: !s.layers.cutfill } });
          break;
        case 'i':
          app.set({ layers: { ...s.layers, imagery: !s.layers.imagery } });
          break;
        case 'b':
          app.set({ layers: { ...s.layers, asBuilt: !s.layers.asBuilt } });
          break;
        case 't':
          setTheme(s.theme === 'dark' ? 'light' : 'dark');
          break;
        case ':':
        case '/':
          ev.preventDefault();
          document.getElementById('cmd-input')?.focus();
          break;
        case 'Delete':
        case 'Backspace':
          if (s.selection) void runCommand('delete_object', { id: s.selection });
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (renderView) return <RenderRoot view={renderView} params={params} />;
  return (
    <div className="app">
      <TopBar />
      <LeftPanel />
      <CenterView />
      <RightPanel />
      <BottomBar />
      <HelpDialog />
      <CompareDialog />
      <DataDialog />
    </div>
  );
}
