"""Build the viewer into ONE self-contained HTML file: viewer/dist/land-viewer.html

    python viewer/build.py                     # viewer only (use "Load site package" to open a site)
    python viewer/build.py --embed sites/1625-heilmandale-rd/1625-heilmandale-rd.sitepkg.json
                                               # also build a site package into the page (published demo)

Every script and style is copied inline. The build fails if anything would load from another website.
"""

import argparse
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")
# Load order matters: each file adds to the shared LD namespace.
SCRIPTS = ["core.js", "grading.js", "parking.js", "site.js", "commands.js", "selfcheck.js", "view3d.js", "chat.js", "ui.js"]
MAX_BYTES = 16_000_000  # Claude artifact page limit

REMOTE = re.compile(r"""(?:src|href)\s*=\s*["']?\s*(?:https?:)?//|url\(\s*["']?\s*(?:https?:)?//|@import|fetch\(\s*["'`]https?:|new\s+WebSocket""", re.I)


def read(name):
    with open(os.path.join(SRC, name), encoding="utf-8") as f:
        return f.read()


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--embed", help="site package to build into the page")
    ap.add_argument("--out", default=os.path.join(HERE, "dist", "land-viewer.html"))
    a = ap.parse_args(argv)

    html = read("index.html")
    css = read("styles.css")
    scripts = [n for n in SCRIPTS if os.path.exists(os.path.join(SRC, n))]
    js = "\n".join(f"<script>/* {n} */\n{read(n)}\n</script>" for n in scripts)

    problems = []
    for name, text in [("index.html", html), ("styles.css", css)] + [(n, read(n)) for n in scripts]:
        for m in REMOTE.finditer(text):
            line = text.count("\n", 0, m.start()) + 1
            problems.append(f"{name}:{line}: would load something from the internet: {m.group(0)!r}")
    if problems:
        print("BUILD FAILED: the viewer must be self-contained.\n  " + "\n  ".join(problems))
        return 1

    embedded = ""
    if a.embed:
        with open(a.embed, encoding="utf-8") as f:
            pkg = f.read()
        embedded = '<script type="application/json" id="embedded-site-package">' + pkg.replace("</", "<\\/") + "</script>"

    body = html.replace("<!-- EMBEDDED -->", embedded).replace("<!-- SCRIPTS -->", js)
    out = ("<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">"
           "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
           "<title>Land Development Viewer</title>\n"
           f"<style>\n{css}\n</style></head>\n<body>\n{body}\n</body></html>\n")
    size = len(out.encode("utf-8"))
    if size > MAX_BYTES:
        print(f"BUILD FAILED: {size / 1e6:.1f} MB is over the 16 MB artifact limit. Use a smaller package (--max-mb when packaging).")
        return 1
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8", newline="\n") as f:
        f.write(out)
    print(f"Built {os.path.relpath(a.out)} ({size / 1e6:.2f} MB, {len(scripts)} scripts"
          + (f", site package {os.path.basename(a.embed)} built in" if a.embed else "") + "). Nothing loads from other websites.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
