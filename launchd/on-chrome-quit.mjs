#!/usr/bin/env node
// Run by launchd whenever Chrome's SingletonLock appears (launch) or disappears (quit).
// While Chrome is up: log the on-disk count and exit. Once Chrome is gone: wipe every profile.
//
// This file is started by node directly (not via a shell) on purpose: macOS grants disk
// permissions to the process launchd starts, and its children inherit them. So the node
// binary in ~/.tab-group-nuker is the one that needs Full Disk Access, nothing else.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toLocaleString("sv-SE").replace("T", " ");

// "Running" means the main browser process. Helpers are a different executable, and the
// relauncher Chrome spawns for chrome://restart / "Relaunch to update" is this executable with
// --type=relauncher; it lives only until the old process is gone and the new one is up, and must
// not count, or a restart would look like Chrome never quit. "Google Chrome for Testing" (used by
// test/run.sh) is a different app and does not count either.
function chromeRunning() {
  const r = spawnSync("ps", ["-axo", "args="], { encoding: "utf8" });
  return (r.stdout || "").split("\n").some((l) => /\/Contents\/MacOS\/Google Chrome(\s-|$)/.test(l) && !/ --type=/.test(l));
}

function wipe(args, dropPattern) {
  const r = spawnSync(process.execPath, [path.join(dir, "wipe-saved-groups.mjs"), ...args], { encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || "");
  const lines = out.split("\n").filter((l) => l.trim() && !dropPattern.test(l));
  if (lines.length) console.log(lines.join("\n"));
  if (/EPERM/.test(out)) {
    console.log(`${stamp()} macOS denied access to Chrome's data folder. Grant Full Disk Access to:\n  ${process.execPath}\n  (System Settings > Privacy & Security > Full Disk Access > + > press Cmd-Shift-G and paste the path)`);
  }
}

console.log(`${stamp()} triggered`);
// Chrome removes SingletonLock early in its shutdown and the process can live on for seconds.
// Poll fast and wipe the moment it is gone: once the process has exited its files are complete,
// and a relaunch is often only a second or two behind (a quick click on the Dock, or Chrome
// restarting itself), so every moment spent waiting is a chance to miss the window.
const t0 = Date.now();
while (chromeRunning() && Date.now() - t0 < 60_000) await sleep(200);

if (chromeRunning()) {
  console.log(`${stamp()} chrome running, skip. on disk now:`);
  wipe([], / 0 saved groups, 0 tabs|dry run/);
} else {
  console.log(`${stamp()} chrome quit -> wiping`);
  wipe(["--all", "--delete"], /^ {3}•|dry run/);
  if (chromeRunning()) {
    console.log(`${stamp()} note: Chrome was relaunched while the wipe ran. If groups are still there, quit again and wait a few seconds before relaunching.`);
  }
}
