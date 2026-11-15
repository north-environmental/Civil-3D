# The Chat panel

The **Chat** tab on the right of the app is where you describe what you want to build in plain words. The plan
redraws as each step runs, the zoning checks are re-run, and the reply tells you what was placed and what fails.
Every change goes through the same commands as the buttons, so it shows in the **Activity** tab and can be undone (↶).

## Which engine answers

The label at the top of the tab says which one is in use.

| Label | What it is | When it is used |
|---|---|---|
| **Claude** (green dot) | Claude, run through Claude Code on your computer, with the Groundwork tools as its only tools | Claude Code is installed and signed in |
| **Built-in parser** (amber dot) | A small pattern matcher inside Groundwork. No AI. | Claude Code was not found |

The built-in parser understands common phrasings only: building size (SF or length × depth), cross-dock or rear-load,
clear height, dock doors, trailer stalls, car stalls or employees, which road trucks and cars use, "parallel to
<road>", "rotate N degrees", and: run checks, grade the site, new scenario, compare, undo, redo, export, save the plan
as a PNG. When it does not understand it says so and changes nothing.

## Turn on Claude in the chat

You need a Claude subscription that includes Claude Code. No API key is involved and Groundwork itself never calls the
Anthropic API: it starts the `claude` program that is already on your computer.

1. Install Claude Code (one time). In a terminal:

```bash
npm install -g @anthropic-ai/claude-code
```

2. Sign in (one time). Run this, follow the sign-in prompt in your browser, then type `/exit`:

```bash
claude
```

3. Restart Groundwork (`Ctrl+C` in its terminal, then `npm run dev` again). The Chat tab should now say **Claude**.

If it still says "Built-in parser", the `claude` command is not on the PATH of the terminal that started Groundwork.
Open a new terminal and start Groundwork from there, or set `GROUNDWORK_CLAUDE_BIN` to the full path of `claude`.
Current install instructions are at <https://code.claude.com/docs>.

## What Claude can and cannot do here

- It can call the Groundwork commands (the same ones listed in `docs/MCP_SETUP.md`) and nothing else. Its shell,
  file and web tools are switched off for the chat, and your other Claude Code settings, hooks and MCP servers are not
  loaded.
- A reply usually takes 20–90 seconds, because Claude makes several tool calls. The steps appear as they run.
  **Stop** ends a reply early; **New chat** clears the conversation but keeps the design.
- It counts against your normal Claude usage.
- Each conversation continues until you press **New chat** or restart Groundwork.

## Options

| Setting | Effect |
|---|---|
| `npm run dev -- --chat builtin` | Always use the built-in parser |
| `GROUNDWORK_CHAT=builtin` | Same, as an environment variable |
| `GROUNDWORK_CLAUDE_BIN=/path/to/claude` | Use a specific Claude Code binary |
| `GROUNDWORK_CLAUDE_MODEL=<model>` | Pass `--model` to Claude Code (default: your Claude Code default) |

## Not verified

- The Claude engine was run end to end on Linux. On **Windows** the `claude` command is started through the shell and
  has not been tested; if the chat reports that Claude Code could not start, use the built-in parser or drive
  Groundwork from Claude Desktop (`docs/MCP_SETUP.md`) and tell us what the error said.
- Reply length and tone depend on the model; the prompt asks for short answers but does not guarantee them.
