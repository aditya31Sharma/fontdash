"""Keep the dashboard running on localhost across logins, via launchd."""
import os
import plistlib
import subprocess
import sys

LABEL = "local.fontdash"
PLIST = os.path.expanduser("~/Library/LaunchAgents/%s.plist" % LABEL)
LOG = os.path.expanduser("~/.fontdash/fontdash.log")


def _domain():
    return "gui/%d" % os.getuid()


def _run(*args):
    return subprocess.run(args, capture_output=True, text=True)


def write_plist(script, port, scan_dirs, adobe):
    args = [sys.executable or "/usr/bin/python3", script, "--port", str(port), "--no-browser"]
    for d in scan_dirs or []:
        args += ["--dir", d]
    if not adobe:
        args.append("--no-adobe")
    os.makedirs(os.path.dirname(PLIST), exist_ok=True)
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    job = {
        "Label": LABEL,
        "ProgramArguments": args,
        "RunAtLoad": True,
        # Restart if it crashes, but a clean quit from the UI stays quit.
        "KeepAlive": {"SuccessfulExit": False},
        "ThrottleInterval": 30,
        "StandardOutPath": LOG,
        "StandardErrorPath": LOG,
        "ProcessType": "Background",
    }
    with open(PLIST, "wb") as fh:
        plistlib.dump(job, fh)
    return args


def on(script, port=8777, scan_dirs=None, adobe=True):
    args = write_plist(script, port, scan_dirs, adobe)
    _run("launchctl", "bootout", "%s/%s" % (_domain(), LABEL))
    r = _run("launchctl", "bootstrap", _domain(), PLIST)
    if r.returncode != 0:
        r = _run("launchctl", "load", "-w", PLIST)  # older macOS
    _run("launchctl", "kickstart", "-k", "%s/%s" % (_domain(), LABEL))
    if r.returncode != 0:
        print("launchctl said: %s" % (r.stderr or r.stdout).strip())
        return 1
    print("Autostart is on.")
    print("  Runs at login and restarts itself if it crashes.")
    print("  http://127.0.0.1:%d/" % port)
    print("  Log: %s" % LOG)
    print("  Turn it off with: fontdash --autostart off")
    return 0


def off():
    _run("launchctl", "bootout", "%s/%s" % (_domain(), LABEL))
    _run("launchctl", "unload", "-w", PLIST)
    if os.path.exists(PLIST):
        os.remove(PLIST)
    print("Autostart is off. The dashboard will not come back at login.")
    return 0


def status(port=8777):
    listed = _run("launchctl", "list", LABEL)
    installed = os.path.exists(PLIST)
    print("plist:     %s" % (PLIST if installed else "not installed"))
    print("launchd:   %s" % ("registered" if listed.returncode == 0 else "not registered"))
    if listed.returncode == 0:
        for line in listed.stdout.splitlines():
            if '"PID"' in line or '"LastExitStatus"' in line:
                print("           %s" % line.strip().rstrip(";"))
    import urllib.error
    import urllib.request
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/api/ping" % port, timeout=2):
            print("responding: yes, http://127.0.0.1:%d/" % port)
    except (urllib.error.URLError, OSError):
        print("responding: no")
    return 0
