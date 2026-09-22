#!/usr/bin/env python3
"""Font Dashboard - find and install new fonts on macOS.

Scans Adobe Creative Cloud's activated-font cache plus any folders you point
it at (loose font files and fonts still inside zips), works out which ones are
not yet in ~/Library/Fonts, and installs the ones you tick.

    python3 fontdash.py            # opens http://127.0.0.1:8777
    python3 fontdash.py --port 9000 --dir ~/Downloads --dir ~/Dropbox/Fonts
    python3 fontdash.py --no-browser

Stdlib only. Nothing is ever deleted or overwritten.
"""
import argparse
import json
import os
import shutil
import sys
import threading
import webbrowser
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import scanner  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
STATE = {"scan_dirs": list(scanner.DEFAULT_SCAN), "adobe": True, "last": None}


def safe_name(name):
    """Keep install targets inside the fonts folder."""
    name = os.path.basename(name).replace("\x00", "")
    if not name or name in (".", ".."):
        raise ValueError("bad filename")
    if not name.lower().endswith(scanner.FONT_EXT):
        raise ValueError("not a font filename")
    return name


def read_candidate(cand):
    """Bytes for one candidate, whether it is loose or inside a zip."""
    if cand["source"] == "zip":
        with zipfile.ZipFile(cand["origin"]) as zf:
            return zf.read(cand["member"])
    with open(cand["origin"], "rb") as fh:
        return fh.read()


def install(ids):
    """Copy the chosen candidates into ~/Library/Fonts. Never overwrites."""
    last = STATE.get("last") or scanner.scan(STATE["scan_dirs"], STATE["adobe"])
    index = {c["id"]: c for c in last["candidates"]}
    os.makedirs(scanner.INSTALL_DIR, exist_ok=True)
    results = []
    for cid in ids:
        cand = index.get(cid)
        if not cand:
            results.append({"id": cid, "ok": False, "msg": "not in the last scan"})
            continue
        label = cand["suggested"]
        try:
            target = os.path.join(scanner.INSTALL_DIR, safe_name(cand["suggested"]))
            if os.path.exists(target):
                results.append({"id": cid, "ok": False, "name": label,
                                "msg": "already there, left alone"})
                continue
            buf = read_candidate(cand)
            tmp = target + ".part"
            with open(tmp, "wb") as fh:
                fh.write(buf)
            os.rename(tmp, target)
            results.append({"id": cid, "ok": True, "name": label,
                            "msg": "installed"})
        except Exception as exc:  # surfaced in the UI, never silently dropped
            results.append({"id": cid, "ok": False, "name": label,
                            "msg": "%s: %s" % (type(exc).__name__, exc)})
    STATE["last"] = scanner.scan(STATE["scan_dirs"], STATE["adobe"])
    return results


class Handler(BaseHTTPRequestHandler):
    server_version = "fontdash"

    def log_message(self, fmt, *args):
        if os.environ.get("FONTDASH_VERBOSE"):
            super().log_message(fmt, *args)

    def _send(self, code, body, ctype="application/json"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/":
            try:
                with open(os.path.join(HERE, "index.html"), "rb") as fh:
                    return self._send(200, fh.read(), "text/html; charset=utf-8")
            except OSError:
                return self._send(500, "index.html is missing next to fontdash.py",
                                  "text/plain")
        if path == "/api/scan":
            STATE["last"] = scanner.scan(STATE["scan_dirs"], STATE["adobe"])
            return self._send(200, STATE["last"])
        if path == "/api/config":
            return self._send(200, {"scan_dirs": STATE["scan_dirs"],
                                    "adobe": STATE["adobe"],
                                    "install_dir": scanner.INSTALL_DIR})
        return self._send(404, {"error": "no such endpoint"})

    def do_POST(self):
        path = self.path.split("?")[0]
        length = int(self.headers.get("Content-Length") or 0)
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return self._send(400, {"error": "bad json"})
        if path == "/api/install":
            ids = payload.get("ids") or []
            if not isinstance(ids, list):
                return self._send(400, {"error": "ids must be a list"})
            return self._send(200, {"results": install(ids)})
        if path == "/api/config":
            dirs = payload.get("scan_dirs")
            if isinstance(dirs, list):
                STATE["scan_dirs"] = [os.path.expanduser(d) for d in dirs if d.strip()]
            if "adobe" in payload:
                STATE["adobe"] = bool(payload["adobe"])
            return self._send(200, {"scan_dirs": STATE["scan_dirs"],
                                    "adobe": STATE["adobe"]})
        if path == "/api/reveal":
            target = payload.get("path") or scanner.INSTALL_DIR
            if os.path.exists(target):
                os.system("open -R %s" % json.dumps(target))
                return self._send(200, {"ok": True})
            return self._send(404, {"error": "no such path"})
        return self._send(404, {"error": "no such endpoint"})


def cli(do_install):
    """Terminal mode, for when you do not want the browser."""
    result = scanner.scan(STATE["scan_dirs"], STATE["adobe"])
    STATE["last"] = result
    new = [c for c in result["candidates"] if not c["installed"] and c["recommended"]]
    if not new:
        print("Nothing new. %d fonts already installed." % result["installed_count"])
        return 0
    print("%d new font%s:" % (len(new), "" if len(new) == 1 else "s"))
    for c in new:
        notes = ", ".join(c["flags"]) or "-"
        print("  %-34s %-9s %5d glyphs  %s"
              % (c["suggested"][:34], c["outlines"], c["chars"], notes))
    if not do_install:
        print("\nRun again with --install-new to install these.")
        return 0
    print()
    for r in install([c["id"] for c in new]):
        print("  %s %s - %s" % ("OK " if r["ok"] else "-- ", r.get("name", ""), r["msg"]))
    print("\nRestart Figma or Illustrator to pick them up.")
    return 0


def main():
    ap = argparse.ArgumentParser(description="Find and install new fonts (macOS)")
    ap.add_argument("--port", type=int, default=8777)
    ap.add_argument("--dir", action="append", default=[],
                    help="folder to scan (repeatable); defaults to Downloads + Desktop")
    ap.add_argument("--no-adobe", action="store_true",
                    help="skip the Creative Cloud font cache")
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--list", action="store_true",
                    help="print what is new and exit, no server")
    ap.add_argument("--install-new", action="store_true",
                    help="install every recommended new font and exit, no server")
    args = ap.parse_args()

    if args.dir:
        STATE["scan_dirs"] = [os.path.expanduser(d) for d in args.dir]
    STATE["adobe"] = not args.no_adobe

    if sys.platform != "darwin":
        print("Heads up: this installs into ~/Library/Fonts, which is macOS only.")

    if args.list or args.install_new:
        return cli(args.install_new)

    url = "http://127.0.0.1:%d/" % args.port
    httpd = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print("Font Dashboard -> %s" % url)
    print("Scanning: %s" % ", ".join(STATE["scan_dirs"]))
    print("Adobe cache: %s" % ("on" if STATE["adobe"] else "off"))
    print("Ctrl+C to stop.")
    if not args.no_browser:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")
        httpd.shutdown()


if __name__ == "__main__":
    main()
