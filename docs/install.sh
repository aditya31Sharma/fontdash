#!/bin/bash
# Font Dashboard installer.
#   curl -fsSL https://aditya31sharma.github.io/fontdash/install.sh | bash
# Puts the code in ~/.fontdash and a double-clickable app in ~/Applications.
set -euo pipefail

REPO="https://github.com/aditya31Sharma/fontdash.git"
SRC="$HOME/.fontdash"
APPS="$HOME/Applications"
APP="$APPS/Font Dashboard.app"

command -v python3 >/dev/null || { echo "Needs python3 (macOS ships it)."; exit 1; }
command -v git     >/dev/null || { echo "Needs git. Run: xcode-select --install"; exit 1; }

if [ -d "$SRC/.git" ]; then
  echo "Updating $SRC"
  git -C "$SRC" pull --quiet --ff-only || echo "  (local changes kept, skipped pull)"
else
  echo "Cloning into $SRC"
  git clone --quiet --depth 1 "$REPO" "$SRC"
fi

mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Font Dashboard</string>
  <key>CFBundleDisplayName</key><string>Font Dashboard</string>
  <key>CFBundleIdentifier</key><string>local.fontdash</string>
  <key>CFBundleVersion</key><string>1.2.0</string>
  <key>CFBundleShortVersionString</key><string>1.2.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>fontdash</string>
  <key>LSUIElement</key><true/>
</dict></plist>
PLIST

cat > "$APP/Contents/MacOS/fontdash" <<'LAUNCH'
#!/bin/bash
# Reuse an already-running dashboard rather than starting a second one.
if curl -fs -o /dev/null http://127.0.0.1:8777/api/ping 2>/dev/null; then
  open "http://127.0.0.1:8777/"
  exit 0
fi
exec /usr/bin/env python3 "$HOME/.fontdash/fontdash.py" --port 8777
LAUNCH
chmod +x "$APP/Contents/MacOS/fontdash"

mkdir -p "$HOME/bin"
cat > "$HOME/bin/fontdash" <<'CLI'
#!/bin/bash
exec /usr/bin/env python3 "$HOME/.fontdash/fontdash.py" "$@"
CLI
chmod +x "$HOME/bin/fontdash"

echo
echo "Installed."
echo "  Double-click:  ~/Applications/Font Dashboard.app"
echo "  Terminal:      ~/bin/fontdash --list   |   ~/bin/fontdash --install-new"
echo
# Piped through curl, stdin is the script itself, so ask on the terminal if there
# is one and simply open it otherwise.
reply=Y
if [ -t 0 ] || { : </dev/tty; } 2>/dev/null; then
  printf 'Open it now? [Y/n] '
  { read -r reply </dev/tty; } 2>/dev/null || reply=Y
fi
case "${reply:-Y}" in [Nn]*) echo "Open it later from ~/Applications." ;; *) open "$APP" ;; esac
