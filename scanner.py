"""Find installable fonts across Adobe's cache, loose files and zip archives."""
import hashlib
import os
import zipfile

import fontlib

FONT_EXT = (".otf", ".ttf", ".ttc", ".otc")
WEB_EXT = (".woff", ".woff2", ".eot", ".svg")
HOME = os.path.expanduser("~")
INSTALL_DIR = os.path.join(HOME, "Library", "Fonts")
ADOBE_DIR = os.path.join(
    HOME, "Library", "Application Support", "Adobe",
    "CoreSync", "plugins", "livetype",
)
DEFAULT_SCAN = [os.path.join(HOME, "Downloads"), os.path.join(HOME, "Desktop")]
MAX_ZIP_MEMBER = 40 * 1024 * 1024
SKIP_DIRS = {"__MACOSX", ".git", "node_modules", "Library"}


def _cid(*parts):
    return hashlib.sha1("\x00".join(parts).encode("utf-8", "replace")).hexdigest()[:16]


def installed_index():
    """What is already in ~/Library/Fonts, keyed by PostScript name and filename."""
    by_ps, by_file = {}, {}
    if not os.path.isdir(INSTALL_DIR):
        return by_ps, by_file
    for entry in os.listdir(INSTALL_DIR):
        path = os.path.join(INSTALL_DIR, entry)
        if not entry.lower().endswith(FONT_EXT) or not os.path.isfile(path):
            continue
        by_file[entry.lower()] = path
        try:
            with open(path, "rb") as fh:
                info = fontlib.describe(fh.read(), entry)
        except Exception:
            continue
        if info["psname"]:
            by_ps[info["psname"]] = entry
    return by_ps, by_file


def _candidate(buf, filename, source, origin, member=None):
    info = fontlib.describe(buf, filename)
    ps = info["psname"] or os.path.splitext(filename)[0]
    ext = os.path.splitext(filename)[1].lower() or ".otf"
    # Adobe's cache uses opaque ids like ".30173.otf", so those get renamed to
    # the PostScript name. Everything else keeps the name it shipped with.
    suggested = (ps + ext) if source == "adobe" else filename
    return dict(
        info,
        id=_cid(source, origin, member or "", filename),
        source=source,
        origin=origin,
        member=member,
        filename=filename,
        suggested=suggested,
        key=ps,
    )


def scan_adobe():
    """Activated Creative Cloud fonts, which live under id-style dotfile names."""
    out = []
    if not os.path.isdir(ADOBE_DIR):
        return out
    for root, dirs, files in os.walk(ADOBE_DIR):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in files:
            if not name.lower().endswith(FONT_EXT):
                continue
            path = os.path.join(root, name)
            try:
                with open(path, "rb") as fh:
                    buf = fh.read()
                cand = _candidate(buf, name, "adobe", path)
            except Exception:
                continue
            out.append(cand)
    return out


def scan_dir(root_dir, depth=3):
    """Loose font files plus fonts sitting inside zips."""
    out = []
    root_dir = os.path.expanduser(root_dir)
    if not os.path.isdir(root_dir):
        return out
    base_depth = root_dir.rstrip(os.sep).count(os.sep)
    for root, dirs, files in os.walk(root_dir):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        if root.count(os.sep) - base_depth >= depth:
            dirs[:] = []
        for name in files:
            path = os.path.join(root, name)
            low = name.lower()
            if low.endswith(FONT_EXT) and not name.startswith("._"):
                try:
                    with open(path, "rb") as fh:
                        out.append(_candidate(fh.read(), name, "file", path))
                except Exception:
                    continue
            elif low.endswith(".zip"):
                out.extend(_scan_zip(path))
    return out


def _scan_zip(path):
    out = []
    try:
        zf = zipfile.ZipFile(path)
    except Exception:
        return out
    with zf:
        for item in zf.infolist():
            name = item.filename
            base = os.path.basename(name)
            if not base or base.startswith("._") or "__MACOSX" in name:
                continue
            if not base.lower().endswith(FONT_EXT):
                continue
            if item.file_size > MAX_ZIP_MEMBER:
                continue
            try:
                buf = zf.read(item)
                out.append(_candidate(buf, base, "zip", path, member=name))
            except Exception:
                continue
    return out


def _rank(cand):
    """Best file for a face: widest coverage, then CFF, then larger."""
    return (
        -cand["chars"],
        0 if cand["outlines"] == "CFF" else 1,
        1 if "mislabelled" in cand["flags"] else 0,
        -cand["size"],
    )


def dir_status(paths):
    """macOS blocks background agents from Downloads and Desktop unless the
    binary has Full Disk Access, and it fails silently. Report it explicitly."""
    out = []
    for d in paths:
        d = os.path.expanduser(d)
        row = {"path": d, "exists": os.path.isdir(d), "readable": False,
               "entries": 0, "error": ""}
        if row["exists"]:
            try:
                row["entries"] = len(os.listdir(d))
                row["readable"] = True
            except PermissionError as exc:
                row["error"] = "permission denied (%s)" % exc.errno
            except OSError as exc:
                row["error"] = str(exc)
        out.append(row)
    return out


def scan(scan_dirs=None, include_adobe=True):
    scan_dirs = scan_dirs if scan_dirs is not None else DEFAULT_SCAN
    cands = []
    if include_adobe:
        cands.extend(scan_adobe())
    for d in scan_dirs:
        cands.extend(scan_dir(d))

    by_ps, by_file = installed_index()
    groups = {}
    for c in cands:
        groups.setdefault(c["key"], []).append(c)

    result = []
    for key, members in groups.items():
        members.sort(key=_rank)
        best = members[0]
        widest = best["chars"]
        for i, c in enumerate(members):
            c["recommended"] = i == 0
            c["alternatives"] = len(members) - 1
            c["installed"] = bool(
                (c["psname"] and c["psname"] in by_ps)
                or c["suggested"].lower() in by_file
            )
            c["installed_as"] = by_ps.get(c["psname"]) or by_file.get(
                c["suggested"].lower(), "")
            if not c["recommended"] and c["chars"] < widest:
                c["flags"] = c["flags"] + ["narrower"]
            result.append(c)

    result.sort(key=lambda c: (c["installed"], c["family"].lower(), _rank(c)))
    return {
        "dir_status": dir_status(scan_dirs),
        "candidates": result,
        "installed_count": len(by_file),
        "scan_dirs": scan_dirs,
        "adobe_dir": ADOBE_DIR if os.path.isdir(ADOBE_DIR) else "",
        "install_dir": INSTALL_DIR,
    }
