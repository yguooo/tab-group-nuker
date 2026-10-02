#!/usr/bin/env node
// Wipes Chrome's *saved* tab groups (including closed ones) from a profile's
// Sync Data LevelDB store. Chrome must be fully quit to --delete.
// Set CHROME_USER_DATA to point at a non-default user data directory.
//
//   node wipe-saved-groups.mjs                          # list profiles + counts
//   node wipe-saved-groups.mjs --profile "Profile 5"    # dry run: show groups
//   node wipe-saved-groups.mjs --profile "Profile 5" --delete
//   node wipe-saved-groups.mjs --all --delete
import { ClassicLevel } from "classic-level";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_DIRS = {
  darwin: path.join(os.homedir(), "Library/Application Support/Google/Chrome"),
  linux: path.join(os.homedir(), ".config/google-chrome"),
  win32: path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/User Data"),
};
const CHROME_DIR = process.env.CHROME_USER_DATA || DEFAULT_DIRS[process.platform];
const PREFIX = "saved_tab_group-";
const KEEP = `${PREFIX}GlobalMetadata`; // sync progress marker: keep so nothing is re-downloaded

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const DELETE = flag("--delete");
const profileArg = opt("--profile");
const ALL = flag("--all");

// --- minimal protobuf reader (enough to pull group titles / tab urls) ---
function readVarint(b, p) { let r = 0n, s = 0n; for (;;) { const x = b[p++]; r |= BigInt(x & 0x7f) << s; if (!(x & 0x80)) return [r, p]; s += 7n; } }
function parse(b) {
  const out = []; let p = 0;
  while (p < b.length) {
    let tag; [tag, p] = readVarint(b, p);
    const field = Number(tag >> 3n), wire = Number(tag & 7n);
    if (wire === 0) { let v; [v, p] = readVarint(b, p); out.push({ field, wire, v }); }
    else if (wire === 1) { out.push({ field, wire, v: b.subarray(p, p + 8) }); p += 8; }
    else if (wire === 2) { let n; [n, p] = readVarint(b, p); out.push({ field, wire, v: b.subarray(p, p + Number(n)) }); p += Number(n); }
    else if (wire === 5) { out.push({ field, wire, v: b.subarray(p, p + 4) }); p += 4; }
    else throw new Error("bad wire type " + wire);
  }
  return out;
}
const get = (fields, n) => fields.find((f) => f.field === n)?.v;
function describe(buf) {
  // Chrome stores SavedTabGroupData{ version=1, SavedTabGroupSpecifics specifics=2 }
  //   specifics: guid=1, group=4 { title=2, color=3 }, tab=5 { group_guid=1, url=3, title=4 }
  try {
    const top = parse(buf);
    const spec = get(top, 2) ? parse(get(top, 2)) : top;
    const group = get(spec, 4), tab = get(spec, 5);
    if (group) { const g = parse(group); return { kind: "group", title: str(get(g, 2)) }; }
    if (tab) { const t = parse(tab); return { kind: "tab", group: str(get(t, 1)), url: str(get(t, 3)), title: str(get(t, 4)) }; }
    return { kind: "?" };
  } catch { return { kind: "?" }; }
}
const str = (b) => (b ? Buffer.from(b).toString("utf8") : "");

// --- profile discovery ---
function profiles() {
  return fs.readdirSync(CHROME_DIR)
    .filter((d) => /^(Default|Profile \d+)$/.test(d))
    .map((d) => {
      let name = d;
      try { name = JSON.parse(fs.readFileSync(path.join(CHROME_DIR, d, "Preferences"), "utf8")).profile?.name ?? d; } catch {}
      return { dir: d, name, db: path.join(CHROME_DIR, d, "Sync Data", "LevelDB") };
    })
    .filter((p) => fs.existsSync(p.db));
}
const chromeRunning = () => {
  try {
    if (process.platform === "win32") return execSync("tasklist", { encoding: "utf8" }).includes("chrome.exe");
    execSync(process.platform === "darwin" ? 'pgrep -x "Google Chrome"' : "pgrep -x chrome", { stdio: "ignore" });
    return true;
  } catch { return false; }
};

async function scan(dbPath) {
  // Read from a snapshot copy so this works while Chrome holds the lock.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tgn-"));
  fs.cpSync(dbPath, tmp, { recursive: true });
  const db = new ClassicLevel(tmp, { keyEncoding: "utf8", valueEncoding: "buffer" });
  const groups = [], tabs = []; let other = 0;
  try {
    await db.open();
    for await (const [k, v] of db.iterator({ gte: `${PREFIX}dt-`, lt: `${PREFIX}dt-\xff` })) {
      const d = describe(v); d.guid = k.slice(`${PREFIX}dt-`.length);
      if (d.kind === "group") groups.push(d); else if (d.kind === "tab") tabs.push(d); else other++;
    }
  } finally { await db.close().catch(() => {}); fs.rmSync(tmp, { recursive: true, force: true }); }
  return { groups, tabs, other };
}

async function wipe(p) {
  const backup = path.join(os.homedir(), ".tab-group-nuker-backups", `${p.dir}-${Date.now()}`);
  fs.mkdirSync(backup, { recursive: true });
  fs.cpSync(p.db, backup, { recursive: true });
  console.log(`  backup -> ${backup}`);
  const db = new ClassicLevel(p.db, { keyEncoding: "utf8", valueEncoding: "buffer" });
  await db.open();
  const batch = db.batch(); let n = 0;
  try {
    for await (const k of db.keys({ gte: PREFIX, lt: PREFIX + "\xff" })) {
      if (k === KEEP) continue;
      batch.del(k); n++;
    }
    await batch.write();
  } finally { await db.close(); }
  console.log(`  deleted ${n} records`);
}

(async () => {
  const all = profiles();
  let targets = all;
  if (profileArg) {
    targets = all.filter((p) => p.dir === profileArg || p.name === profileArg);
    if (!targets.length) { console.error(`no profile "${profileArg}". have: ${all.map((p) => `${p.dir} (${p.name})`).join(", ")}`); process.exit(1); }
  } else if (!ALL && DELETE) { console.error("--delete needs --profile <name> or --all"); process.exit(1); }

  if (DELETE && chromeRunning()) { console.error("Quit Chrome completely first (Cmd+Q), then re-run."); process.exit(1); }

  for (const p of targets) {
    const { groups, tabs, other } = await scan(p.db);
    console.log(`${p.dir} (${p.name}): ${groups.length} saved groups, ${tabs.length} tabs${other ? `, ${other} unparsed` : ""}`);
    if (profileArg || ALL) for (const g of groups) console.log(`   • ${g.title || "(untitled)"}  [${tabs.filter((t) => t.group === g.guid).length} tabs]`);
    if (DELETE && (groups.length || tabs.length || other)) await wipe(p);
  }
  if (!DELETE) console.log("\n(dry run — add --delete to wipe; Chrome must be quit)");
})().catch((e) => { console.error(e); process.exit(1); });
