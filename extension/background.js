// Ungrouping every tab of a saved group deletes the saved group itself
// (same thing Chrome's "Ungroup" context-menu item does, minus the confirm dialog).

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

async function autoKillEnabled() {
  const { autoKill } = await chrome.storage.local.get({ autoKill: false });
  return autoKill;
}

async function updateBadge() {
  const on = await autoKillEnabled();
  await chrome.action.setBadgeText({ text: on ? "AUTO" : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
}

// Auto-kill: any group that appears (e.g. a saved group being opened) gets ungrouped at once.
// Chrome creates the group first and attaches tabs a moment later, so retry briefly.
async function killSoon(groupId) {
  if (!(await autoKillEnabled())) return;
  for (let i = 0; i < 20; i++) {
    try {
      const n = await ungroupGroup(groupId);
      if (n > 0) return;
    } catch { return; } // group already gone
    await new Promise((r) => setTimeout(r, 150));
  }
}

chrome.tabGroups.onCreated.addListener((g) => killSoon(g.id));
chrome.tabGroups.onUpdated.addListener((g) => killSoon(g.id));

chrome.commands.onCommand.addListener((cmd) => { if (cmd === "nuke-open-groups") nukeOpenGroups(); });

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg.type === "nuke") reply(await nukeOpenGroups());
    else if (msg.type === "setAutoKill") {
      await chrome.storage.local.set({ autoKill: !!msg.value });
      await updateBadge();
      if (msg.value) await nukeOpenGroups();
      reply({ ok: true });
    } else if (msg.type === "status") {
      const groups = await chrome.tabGroups.query({});
      reply({ openGroups: groups.length, autoKill: await autoKillEnabled() });
    }
  })();
  return true;
});

// On browser start, session restore brings back last session's groups (re-saving them).
// Ungroup them as they appear so every launch starts with zero groups.
chrome.runtime.onStartup.addListener(async () => {
  updateBadge();
  for (const delay of [0, 1000, 3000, 6000, 10000, 20000]) {
    await new Promise((r) => setTimeout(r, delay));
    await nukeOpenGroups();
  }
});
chrome.runtime.onInstalled.addListener(updateBadge);
