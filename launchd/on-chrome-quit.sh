#!/bin/bash
# Run by launchd whenever Chrome's SingletonLock appears (launch) or disappears (quit).
# While Chrome is up: log the on-disk count and exit. Once Chrome is gone: wipe every profile.
cd "$(dirname "$0")"
echo "$(date '+%F %T') triggered"
for i in $(seq 1 15); do pgrep -x "Google Chrome" >/dev/null || break; sleep 1; done
if pgrep -x "Google Chrome" >/dev/null; then
  echo "$(date '+%F %T') chrome running, skip. on disk now:"
  node wipe-saved-groups.mjs 2>&1 | grep -v ' 0 saved groups, 0 tabs' | grep -v 'dry run'
  exit 0
fi
echo "$(date '+%F %T') chrome quit -> wiping"
node wipe-saved-groups.mjs --all --delete 2>&1 | grep -Ev '^   •|^$|dry run'
