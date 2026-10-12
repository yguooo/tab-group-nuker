#!/bin/bash
# macOS: install the "wipe saved tab groups whenever Chrome quits" launchd job.
#
# Run from a checkout:   ./install.sh
# Or in one line:        curl -fsSL https://raw.githubusercontent.com/yguooo/tab-group-nuker/main/install.sh | bash
#
# Copies the tooling to ~/.tab-group-nuker (launchd cannot read ~/Desktop or ~/Documents),
# including a private copy of the node binary: macOS ties disk permissions to the program
# launchd starts, and a copy at a fixed path keeps the grant valid across Homebrew upgrades.
set -e
REPO="yguooo/tab-group-nuker"
DEST="$HOME/.tab-group-nuker"
LABEL="com.tab-group-nuker"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

[ "$(uname)" = "Darwin" ] || { echo "This installer is for macOS."; exit 1; }
command -v node >/dev/null || { echo "node is required: install from https://nodejs.org or 'brew install node', then re-run."; exit 1; }

# Source files: the checkout this script lives in, or a fresh download when piped from curl.
SRC="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [ ! -f "$SRC/wipe-saved-groups.mjs" ]; then
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  echo "Downloading $REPO…"
  curl -fsSL "https://github.com/$REPO/archive/refs/heads/main.tar.gz" | tar xz -C "$TMP"
  SRC="$(find "$TMP" -maxdepth 1 -type d -name 'tab-group-nuker-*' | head -1)"
fi

mkdir -p "$DEST" "$HOME/.tab-group-nuker-backups" "$HOME/Library/LaunchAgents"
cp "$SRC/wipe-saved-groups.mjs" "$SRC/package.json" "$SRC/package-lock.json" "$SRC/launchd/on-chrome-quit.mjs" "$DEST/"
rm -f "$DEST/on-chrome-quit.sh"
# Copy node once. Overwriting it with a different build would change the program the Full Disk
# Access grant is tied to; delete $DEST/node (then re-grant) if you ever need to replace it.
[ -x "$DEST/node" ] || cp "$(node -p 'process.execPath')" "$DEST/node"
chmod +x "$DEST/node" "$DEST/on-chrome-quit.mjs"
(cd "$DEST" && npm install --silent --omit=dev)

sed -e "s|__HOME__|$HOME|g" "$SRC/launchd/$LABEL.plist.template" > "$PLIST"
plutil -lint "$PLIST" >/dev/null
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed. launchd job '$LABEL' now wipes saved tab groups every time Chrome quits."
echo

# The one step only you can do: macOS lets no program grant itself access to another app's data.
# Skip it on a re-install when the log shows the job has already read Chrome's folder: that only
# works with the grant in place (it cannot be tested from this shell; macOS ties it to launchd's
# process).
LOG="$HOME/.tab-group-nuker-backups/quit.log"
if [ -f "$LOG" ] && grep -q "saved groups" "$LOG" && ! tail -n 30 "$LOG" | grep -q EPERM; then
  echo "Full Disk Access already granted (the log shows the job reading Chrome's folder). Done."
  echo "Log: ~/.tab-group-nuker-backups/quit.log   Uninstall: ./uninstall.sh"
  exit 0
fi
echo "LAST STEP: allow the job to read Chrome's data folder (Full Disk Access)."
echo "  System Settings is opening on that page. Click '+', press Cmd-Shift-G, paste (the path is"
echo "  already on your clipboard), press Return, then turn the switch on for 'node'."
echo "    $DEST/node"
echo "  Until then every run logs EPERM in ~/.tab-group-nuker-backups/quit.log and nothing is deleted."
printf '%s' "$DEST/node" | pbcopy 2>/dev/null || true
open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles" 2>/dev/null || true
echo
echo "Log: ~/.tab-group-nuker-backups/quit.log   Uninstall: ./uninstall.sh"
