# Font Dashboard

Finds fonts you have downloaded but never installed, and installs them. macOS.

It looks in two places that are easy to lose track of:

- **Adobe Creative Cloud's activated-font cache.** Those files are hidden and named
  things like `.30173.otf`, so they are invisible to every app outside Adobe.
  This copies them out under their real names.
- **Any folder you point it at** (Downloads and Desktop by default), including fonts
  still sitting inside `.zip` archives. No unzipping first.

Anything already in `~/Library/Fonts` is matched by PostScript name and marked as
installed, so you only ever see what is genuinely new.

## Install

```sh
curl -fsSL https://aditya31sharma.github.io/fontdash/install.sh | bash
```

That puts the code in `~/.fontdash`, a **Font Dashboard.app** in `~/Applications`
and a `fontdash` command in `~/bin`. After this you double-click the app: it opens
<http://127.0.0.1:8777>, checks your machine, and installs whatever you tick.

It also registers a launchd agent, so the dashboard is simply always there at
<http://127.0.0.1:8777> - bookmark it. It starts at login and restarts itself if it
crashes. Quitting from the UI keeps it down until you open the app again.

```sh
fontdash --autostart status   # is it registered and responding?
fontdash --autostart off      # stop it coming back at login
fontdash --autostart on       # put it back
```

No dependencies. Python 3.8+, which macOS already ships.

### Why it is not just a website

[aditya31sharma.github.io/fontdash](https://aditya31sharma.github.io/fontdash/) hands
you the installer and can inspect a font you drag onto it, but it cannot touch your
machine. Browsers block an `https` page from calling `http://127.0.0.1` as mixed
content, so a hosted page cannot drive a local helper without a trusted certificate.
The app is the same dashboard, served by the machine it manages.

```sh
fontdash --dir ~/Downloads --dir ~/Dropbox/Fonts   # scan other folders
fontdash --no-adobe                                # skip the CC cache
fontdash --port 9000 --no-browser
fontdash --list                                    # terminal, just report
fontdash --install-new                             # terminal, install it all
```

## What it tells you about a font

Downloaded font packs ship the same typeface several times over, and the copies are
not always equal. Each file is parsed and reported on:

| Note | What it means |
|---|---|
| `best` | Widest character coverage in that group. Pick this one. |
| `incomplete` | Missing letters, digits or punctuation. Usually a crippled demo. |
| `demo` | Names itself a demo, trial or personal-use build. |
| `mislabelled` | A `.ttf` that is really OpenType/CFF inside, or the reverse. |
| `narrower` | A sibling file covers more characters than this one. |
| `no 0-9`, `no punctuation` | Exactly which sets are missing. |

That `incomplete` flag is the one worth caring about. Plenty of free display fonts
ship an `.otf` with letters only, so a price or a date silently renders as nothing.

Glyph counts come from parsing the font's own `cmap` table, so the numbers are real
rather than guessed from file size.

## Which file gets installed

A pack usually holds `.otf`, `.ttf`, `.woff` and `.woff2` of one typeface. Web
formats are ignored outright, since macOS cannot install them. Between the desktop
formats the winner is whichever covers more characters, and OpenType/CFF breaks a
tie. That order matters: it is not always the `.otf`.

Files keep the name they shipped with. Adobe's cache is the exception, since
`.30173.otf` is not a name.

## Safety

- Nothing is ever deleted, renamed in place, or overwritten. A name that already
  exists in `~/Library/Fonts` is reported and skipped.
- The Adobe cache and your scan folders are only ever read.
- The server binds to `127.0.0.1` and install targets are forced to a bare filename
  inside `~/Library/Fonts`.
- Installed copies are independent of Creative Cloud, so revealed Adobe fonts keep
  working if you later deactivate them. Check your Adobe licence covers that.

## Files

| | |
|---|---|
| `fontdash.py` | Server, CLI and the install step |
| `scanner.py` | Walks the sources, groups faces, works out what is new |
| `fontlib.py` | sfnt parser: name table and real glyph coverage |
| `docs/index.html` | The dashboard, served locally and on Pages |
| `docs/app.js` | Dashboard logic and the drag-drop inspector |
| `docs/install.sh` | One-line installer |
| `autostart.py` | launchd agent, so it stays up on localhost |

Adobe-cache trick borrowed from
[kalaschnik/adobe-fonts-revealer](https://github.com/kalaschnik/adobe-fonts-revealer),
reimplemented here without the `lcdf-typetools` dependency.
