#!/bin/bash
# macOS: install the "wipe saved tab groups whenever Chrome quits" launchd job.
# Copies the tooling to ~/.tab-group-nuker (launchd cannot read ~/Desktop or ~/Documents).
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.tab-group-nuker"
LABEL="com.tab-group-nuker"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
command -v node >/dev/null || { echo "node is required (brew install node)"; exit 1; }
NODE_DIR="$(dirname "$(command -v node)")"

mkdir -p "$DEST" "$HOME/.tab-group-nuker-backups" "$HOME/Library/LaunchAgents"
cp "$SRC/wipe-saved-groups.mjs" "$SRC/package.json" "$SRC/package-lock.json" "$SRC/launchd/on-chrome-quit.sh" "$DEST/"
chmod +x "$DEST/on-chrome-quit.sh"
(cd "$DEST" && npm install --silent --omit=dev)

sed -e "s|__HOME__|$HOME|g" -e "s|__NODE_DIR__|$NODE_DIR|g" "$SRC/launchd/$LABEL.plist.template" > "$PLIST"
plutil -lint "$PLIST" >/dev/null
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed. launchd job '$LABEL' now wipes saved tab groups every time Chrome quits."
echo "Log: ~/.tab-group-nuker-backups/quit.log   Uninstall: ./uninstall.sh"
