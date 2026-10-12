// Tab Group Nuker — two jobs only:
//   1. Manual: delete every open tab group (popup button / keyboard shortcut).
//   2. Startup: ungroup whatever session-restore (and any auto-grouper reacting to it)
//      brings back, so each Chrome launch begins with zero groups.
//
// Ungrouping every tab of a saved group removes the saved group too (same as Chrome's
// own "Ungroup" context-menu item, minus the confirm dialog).

const SWEEP_MS = 120_000;   // keep sweeping this long after startup
const SWEEP_INTERVAL = 1000; // re-check this often while sweeping

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ungroupGroup(groupId) {
  const tabs = await chrome.tabs.query({ groupId });
  if (tabs.length === 0) return 0;
  await chrome.tabs.ungroup(tabs.map((t) => t.id));
  return tabs.length;
}

async function nukeOpenGroups() {
  const groups = await chrome.tabGroups.query({});
  let tabs = 0;
  for (const g of groups) {
    try { tabs += await ungroupGroup(g.id); } catch (e) { console.warn("ungroup failed", g.id, e); }
  }
  return { groups: groups.length, tabs };
}

// ---- startup sweep -------------------------------------------------------------
// Restored tabs load lazily and auto-grouping extensions re-group them as they load,
// so one pass at startup is not enough. We sweep repeatedly for SWEEP_MS. The deadline
// lives in storage.session (cleared when the browser exits, survives service-worker
// restarts), so a worker that gets killed mid-sweep simply resumes.

let sweeping = false;

async function runSweep() {
  if (sweeping) return;
  sweeping = true;
  try {
    for (;;) {
      const { sweepUntil = 0 } = await chrome.storage.session.get("sweepUntil");
      if (Date.now() > sweepUntil) break;
      const r = await nukeOpenGroups();
      if (r.groups) console.log("startup sweep: removed", r.groups, "groups");
      await sleep(SWEEP_INTERVAL);
    }
  } finally {
    sweeping = false;
  }
}

async function beginStartupSweep(reason) {
  console.log("startup sweep begins:", reason);
  await chrome.storage.session.set({ sweepUntil: Date.now() + SWEEP_MS, booted: true });
  runSweep();
}

// Primary trigger: Chrome fires this when a profile with the extension starts.
chrome.runtime.onStartup.addListener(() => beginStartupSweep("onStartup"));

// Fallback trigger: the first time the service worker runs in a browser session the
// `booted` marker is absent (storage.session is wiped on exit). This covers cases where
// onStartup does not reach us (e.g. profile opened later from the profile picker).
// Skipped right after install/update, where the empty marker just means "new worker".
let justInstalled = false;
chrome.runtime.onInstalled.addListener(() => { justInstalled = true; });

(async () => {
  const { booted, sweepUntil = 0 } = await chrome.storage.session.get(["booted", "sweepUntil"]);
  if (booted) {
    if (Date.now() < sweepUntil) runSweep(); // worker restarted mid-sweep: resume
    return;
  }
  await sleep(300); // let onInstalled (if any) land first
  if (justInstalled) { await chrome.storage.session.set({ booted: true }); return; }
  beginStartupSweep("first worker run this session");
})();

// Any group appearing while a sweep is active wakes the worker and resumes the loop.
chrome.tabGroups.onCreated.addListener(runSweep);
chrome.tabGroups.onUpdated.addListener(runSweep);
chrome.windows.onCreated.addListener(runSweep);

// ---- manual ----------------------------------------------------------------------
chrome.commands.onCommand.addListener((cmd) => { if (cmd === "nuke-open-groups") nukeOpenGroups(); });

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg.type === "nuke") reply(await nukeOpenGroups());
    else if (msg.type === "status") {
      const groups = await chrome.tabGroups.query({});
      reply({ openGroups: groups.length });
    }
  })();
  return true;
});
