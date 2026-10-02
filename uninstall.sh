#!/bin/bash
LABEL="com.tab-group-nuker"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
rm -rf "$HOME/.tab-group-nuker"
echo "Removed launchd job and ~/.tab-group-nuker. Backups in ~/.tab-group-nuker-backups were kept."
