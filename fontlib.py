"""Font inspection helpers. Stdlib only.

Parses sfnt containers (OTF/TTF/TTC) far enough to answer the two questions
that actually matter when deciding what to install: what is this font called,
and how much of the alphabet does it really cover.
"""
import struct

MAC_ROMAN = "mac-roman"


class NotAFont(Exception):
    pass


def _tables(buf, offset=0):
    if len(buf) < offset + 12:
        raise NotAFont("too short")
    tag = buf[offset:offset + 4]
    if tag == b"ttcf":
        first = struct.unpack(">I", buf[offset + 12:offset + 16])[0]
        return _tables(buf, first)
    if tag not in (b"OTTO", b"\x00\x01\x00\x00", b"true", b"typ1"):
        raise NotAFont("unknown sfnt tag %r" % tag)
    count = struct.unpack(">H", buf[offset + 4:offset + 6])[0]
    out = {}
    for i in range(count):
        rec = offset + 12 + 16 * i
        if rec + 16 > len(buf):
            break
        name = buf[rec:rec + 4].decode("latin-1")
        start, length = struct.unpack(">II", buf[rec + 8:rec + 16])
        out[name] = (start, length)
    return out


def sfnt_tag(buf):
    return buf[:4]


def is_truetype_outlines(buf):
    """True when the file carries glyf outlines rather than CFF."""
    try:
        return "glyf" in _tables(buf)
    except NotAFont:
        return False


def names(buf):
    """Return {nameID: string} preferring the Windows/Unicode records."""
    tabs = _tables(buf)
    if "name" not in tabs:
        return {}
    off, _ = tabs["name"]
    if off + 6 > len(buf):
        return {}
    count, str_off = struct.unpack(">HH", buf[off + 2:off + 6])
    storage = off + str_off
    best = {}
    for i in range(count):
        rec = off + 6 + 12 * i
        if rec + 12 > len(buf):
            break
        pid, eid, lid, nid, length, noff = struct.unpack(">HHHHHH", buf[rec:rec + 12])
        raw = buf[storage + noff:storage + noff + length]
        if not raw:
            continue
        try:
            value = raw.decode("utf-16-be") if pid == 3 else raw.decode(MAC_ROMAN)
        except (UnicodeDecodeError, LookupError):
            continue
        value = value.strip("\x00").strip()
        if not value:
            continue
        # Windows records win; a Mac record only fills a gap.
        if nid not in best or pid == 3:
            best[nid] = value
    return best


def coverage(buf):
    """Set of Unicode codepoints the font claims to support."""
    tabs = _tables(buf)
    if "cmap" not in tabs:
        return set()
    off, _ = tabs["cmap"]
    if off + 4 > len(buf):
        return set()
    n = struct.unpack(">H", buf[off + 2:off + 4])[0]
    chosen = None
    fallback = None
    for i in range(n):
        rec = off + 4 + 8 * i
        if rec + 8 > len(buf):
            break
        pid, eid, sub = struct.unpack(">HHI", buf[rec:rec + 8])
        if (pid, eid) in ((3, 10), (0, 4), (0, 6)):
            chosen = off + sub
            break
        if (pid, eid) in ((3, 1), (0, 3)):
            chosen = chosen or off + sub
        elif fallback is None:
            fallback = off + sub
    start = chosen if chosen is not None else fallback
    if start is None or start + 2 > len(buf):
        return set()
    fmt = struct.unpack(">H", buf[start:start + 2])[0]
    chars = set()
    if fmt == 4:
        seg_x2 = struct.unpack(">H", buf[start + 6:start + 8])[0]
        segs = seg_x2 // 2
        end_o = start + 14
        start_o = end_o + seg_x2 + 2
        for i in range(segs):
            end = struct.unpack(">H", buf[end_o + 2 * i:end_o + 2 * i + 2])[0]
            beg = struct.unpack(">H", buf[start_o + 2 * i:start_o + 2 * i + 2])[0]
            if beg == 0xFFFF:
                continue
            chars.update(range(beg, min(end, 0xFFFE) + 1))
    elif fmt == 12:
        groups = struct.unpack(">I", buf[start + 12:start + 16])[0]
        for i in range(groups):
            rec = start + 16 + 12 * i
            if rec + 12 > len(buf):
                break
            beg, end, _gid = struct.unpack(">III", buf[rec:rec + 12])
            if end - beg > 0x10FFFF:
                continue
            chars.update(range(beg, min(end, 0x10FFFF) + 1))
    elif fmt == 6:
        first, cnt = struct.unpack(">HH", buf[start + 6:start + 10])
        chars.update(range(first, first + cnt))
    elif fmt == 0:
        for code in range(256):
            if buf[start + 6 + code]:
                chars.add(code)
    return chars


UPPER = set(range(ord("A"), ord("Z") + 1))
LOWER = set(range(ord("a"), ord("z") + 1))
DIGITS = set(range(ord("0"), ord("9") + 1))
PUNCT = {ord(c) for c in ".,!?'\"-:;()"}


def describe(buf, filename=""):
    """Everything the dashboard needs to judge one font file."""
    nm = names(buf)
    chars = coverage(buf)
    family = nm.get(16) or nm.get(1) or ""
    style = nm.get(17) or nm.get(2) or ""
    ps = nm.get(6) or ""
    full = nm.get(4) or (family + " " + style).strip()
    tag = sfnt_tag(buf)
    truetype = is_truetype_outlines(buf)
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    flags = []
    if ext == "ttf" and not truetype:
        flags.append("mislabelled")
    if ext == "otf" and truetype:
        flags.append("mislabelled")
    missing = []
    if not UPPER <= chars:
        missing.append("A-Z")
    if not LOWER <= chars:
        missing.append("a-z")
    if not DIGITS <= chars:
        missing.append("0-9")
    if not PUNCT <= chars:
        missing.append("punctuation")
    if missing:
        flags.append("incomplete")
    blob = (ps + " " + full + " " + family + " " + filename).lower()
    if "demo" in blob or "personal use" in blob or "trial" in blob:
        flags.append("demo")
    return {
        "family": family or (ps or filename),
        "style": style,
        "psname": ps,
        "full": full,
        "outlines": "TrueType" if truetype else "CFF",
        "sfnt": tag.decode("latin-1", "replace"),
        "chars": len(chars),
        "missing": missing,
        "flags": flags,
        "size": len(buf),
    }
