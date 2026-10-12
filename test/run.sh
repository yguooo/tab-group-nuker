#!/bin/bash
# End-to-end check against the real "Tab Groups Extension" auto-grouper, in a throwaway profile.
# Downloads Chrome for Testing + the grouper CRX into ./test/.work, then:
#   A: open sites, let the grouper group them, nuke (expect 0 groups, all tabs kept), open more
#      sites and check the grouper still groups them (the nuker must not fight it), quit with the
#      groups open so Chrome saves them
#   B: with Chrome quit, run wipe-saved-groups.mjs on the profile (expect records deleted)
#   C: relaunch on a blank page (no session restore, like "Open the New Tab page"): expect 0 groups
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
launch about:blank; node scenario.mjs A; sleep 3; pkill -f "user-data-dir=$W/prof" || true; sleep 2
echo "B: on disk after quit:"; CHROME_USER_DATA="$W/prof" node ../wipe-saved-groups.mjs --all --delete
echo "B: on disk after wipe:"; CHROME_USER_DATA="$W/prof" node ../wipe-saved-groups.mjs | grep -v "dry run"
launch about:blank; node scenario.mjs C; sleep 2; pkill -f "user-data-dir=$W/prof" || true
