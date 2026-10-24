#!/bin/zsh
# Atlas Mac helper installer.
#   curl -fsSL https://atlas-os-puce.vercel.app/mac/install.sh | zsh
# Installs ~/.atlas/atlas-helper.js and a LaunchAgent so it runs in the background whenever you're logged in.
# Uses only what ships with macOS (osascript, curl). Run it again any time to update.
set -e
BASE="https://atlas-os-puce.vercel.app"
DIR="$HOME/.atlas"
PLIST="$HOME/Library/LaunchAgents/com.mountatlanta.atlas-helper.plist"

echo "Installing the Atlas Mac helper..."
mkdir -p "$DIR" "$HOME/Library/LaunchAgents"
chmod 700 "$DIR"
curl -fsSL "$BASE/mac/atlas-helper.js" -o "$DIR/atlas-helper.js"
print -r -- "$BASE" > "$DIR/server"

# Passcode: asked once, stored only in ~/.atlas/auth-header (readable by you alone).
if [[ ! -s "$DIR/auth-header" ]]; then
  print -n "Enter your Atlas passcode (nothing will show as you type): "
  read -rs PASS < /dev/tty
  echo
  ( umask 077; print -r -- "x-atlas-key: $PASS" > "$DIR/auth-header" )
  unset PASS
fi
chmod 600 "$DIR/auth-header"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -H @"$DIR/auth-header" "$BASE/api/ping" || true)
if [[ "$CODE" != "200" ]]; then
  rm -f "$DIR/auth-header"
  echo "That passcode didn't work (Atlas answered $CODE). Run the install command again."
  exit 1
fi

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.mountatlanta.atlas-helper</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/osascript</string>
    <string>-l</string>
    <string>JavaScript</string>
    <string>$DIR/atlas-helper.js</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$DIR/helper.log</string>
  <key>StandardErrorPath</key><string>$DIR/helper.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo ""
echo "Done. The Atlas helper is running and starts automatically when you log in."
echo "The first time Atlas opens files, takes a screenshot or controls Music/Spotify, macOS will ask for permission. Click Allow."
echo "To remove it later:  curl -fsSL $BASE/mac/uninstall.sh | zsh"
