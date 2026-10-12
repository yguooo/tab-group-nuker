#!/bin/bash
# End-to-end check of the extension against the real "Tab Groups Extension" auto-grouper.
# Downloads Chrome for Testing + the grouper CRX into ./test/.work, then:
#   A: open sites, let the grouper create groups, quit
#   B: relaunch with session restore, run the startup sweep, expect 0 groups and all tabs kept
#   C: relaunch again to show the grouper re-groups restored tabs at every launch
# Note: --load-extension reinstalls the extension on each launch, so Chrome never fires
# runtime.onStartup here; phase B triggers the sweep explicitly. Store installs get onStartup.
set -e
cd "$(dirname "$0")"; W="$PWD/.work"; mkdir -p "$W/grouper"
EXT="$(cd ../extension && pwd)"
[ -d "$W/browsers" ] || npx -y @puppeteer/browsers install chrome@stable --path "$W/browsers" >/dev/null
BIN="$(find "$W/browsers" -type f -name "Google Chrome for Testing" | head -1)"
if [ ! -f "$W/grouper/manifest.json" ]; then
  curl -sL -o "$W/grouper.crx" "https://clients2.google.com/service/update2/crx?response=redirect&prodversion=154.0&acceptformat=crx2,crx3&x=id%3Dnplimhmoanghlebhdiboeellhgmgommi%26uc"
  python3 -I - "$W/grouper.crx" "$W/grouper" <<'PY'
import struct, zipfile, io, sys
d=open(sys.argv[1],"rb").read(); hl=struct.unpack("<I",d[8:12])[0]
zipfile.ZipFile(io.BytesIO(d[12+hl:])).extractall(sys.argv[2])
PY
fi
rm -rf "$W/prof"; mkdir -p "$W/prof"
C=(--user-data-dir="$W/prof" --load-extension="$EXT,$W/grouper" --remote-debugging-port=9333 --no-first-run --no-default-browser-check --window-size=900,600)
launch() { "$BIN" "${C[@]}" "$@" >/dev/null 2>&1 & sleep 5; }
launch about:blank;            node scenario.mjs A; sleep 3; pkill -f "user-data-dir=$W/prof" || true; sleep 2
launch --restore-last-session; node scenario.mjs B; sleep 3; pkill -f "user-data-dir=$W/prof" || true; sleep 2
launch --restore-last-session; node scenario.mjs C; sleep 2; pkill -f "user-data-dir=$W/prof" || true
