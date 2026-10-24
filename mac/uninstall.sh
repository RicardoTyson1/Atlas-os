#!/bin/zsh
# Removes the Atlas Mac helper:  curl -fsSL https://atlas-os-puce.vercel.app/mac/uninstall.sh | zsh
# Your Desktop folders and files are not touched. Organize logs in ~/.atlas are kept.
PLIST="$HOME/Library/LaunchAgents/com.mountatlanta.atlas-helper.plist"
DIR="$HOME/.atlas"
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
rm -f "$PLIST" "$DIR/atlas-helper.js" "$DIR/auth-header" "$DIR/server" "$DIR/out.json"
echo "The Atlas helper is stopped and removed. Your files and folders were not touched."
