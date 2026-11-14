# Connecting Claude to Groundwork (MCP)

Groundwork does not call the Anthropic API and needs no API key. Claude reaches the app through a small
**MCP server** (`packages/mcp`) that you register once in Claude Desktop or Claude Code. Each MCP tool is one
Groundwork command, forwarded to the running app at `http://localhost:4310`.

```
Claude Desktop / Claude Code  ──stdio──▶  packages/mcp/dist/index.js  ──HTTP──▶  Groundwork app (npm run dev)
                                                                                      │ WebSocket
                                                                                      ▼
                                                                               your browser (live plan)
```

## 1. Build once

From the `groundwork` folder:

```bash
npm ci
```

```bash
npm run build
```

`npm run build` creates `packages/mcp/dist/index.js` (the file Claude launches). Re-run it after pulling changes.

## 2. Start the app

```bash
npm run dev
```

Open <http://localhost:4310> in a browser and keep it beside the Claude window. Leave this terminal running.

## 3. Register the MCP server

Replace `<ABS>` with the absolute path of the `groundwork` folder (run `pwd` there).

### Claude Desktop

Edit `claude_desktop_config.json` (Claude Desktop → Settings → Developer → Edit Config):

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "groundwork": {
      "command": "node",
      "args": ["<ABS>/packages/mcp/dist/index.js"]
    }
  }
}
```

On Windows use doubled backslashes or forward slashes in the path, e.g. `"C:/Users/you/groundwork/packages/mcp/dist/index.js"`.
Quit and reopen Claude Desktop. "groundwork" should appear in the tools list with 33 tools.

### Claude Code

```bash
claude mcp add groundwork -- node <ABS>/packages/mcp/dist/index.js
```

Check it with:

```bash
claude mcp list
```

### Different port

If the app runs on another port (`npm run dev -- --port 4400`), tell the MCP server:

```json
{
  "mcpServers": {
    "groundwork": {
      "command": "node",
      "args": ["<ABS>/packages/mcp/dist/index.js"],
      "env": { "GROUNDWORK_URL": "http://localhost:4400" }
    }
  }
}
```

## 4. Try it

In Claude, start with the built-in prompt **groundwork_designer** (Claude Desktop: the "+" menu → groundwork; Claude Code:
`/mcp__groundwork__groundwork_designer`), or just type:

> Load 1625 Heilmandale Rd in Groundwork and summarize the site.

Watch the browser: the site appears and the **Activity** tab logs what Claude did. The full scripted demo is in
[`DEMO.md`](DEMO.md).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Tool result says "The Groundwork app is not reachable… Start the app with `npm run dev`" | The app is not running (or is on another port). Start it; set `GROUNDWORK_URL` if needed. |
| "groundwork" does not show up in Claude Desktop | The path in the config is wrong or `npm run build` was not run. `node <ABS>/packages/mcp/dist/index.js` in a terminal should print `[groundwork-mcp] ready: … tools`. |
| `render_view` returns text but no image | Headless Chromium is missing. Run `npx playwright install chromium` once in the `groundwork` folder. |
| Node errors about syntax | Use Node 20 or newer (`node -v`). |
| Port 4310 in use | Another copy of the app is running. Stop it, or start with `npm run dev -- --port 4400` and set `GROUNDWORK_URL`. |

## What Claude can do

Every tool is a command (see `GET /api/commands` for the live list with JSON schemas):

- **Context:** `get_project_summary`, `get_site_context`, `get_zoning_rules`, `get_ordinance_text`, `render_view` (PNG), `run_checks`
- **Site:** `load_site`, `set_zoning_rules`, `confirm_zoning_rules`, `add_constraint`, `set_edge_class`
- **Program / layout:** `set_program`, `place_building`, `set_access`, `generate_layout`, `edit_object`, `delete_object`,
  `add_parking_field`, `add_trailer_field`, `add_basin`
- **Scenarios:** `create_scenario`, `switch_scenario`, `compare_scenarios`
- **Grading:** `set_grading_criteria`, `grade_site`, `optimize_ffe`, `get_earthwork_report`, `cut_section`, `check_accessible_route`
- **Output:** `export`, `log_note`, `undo`, `redo`

The same commands are available in the app's command line (bottom of the window), e.g. `generate_layout alignToRoad="Heilmandale Rd"`.
