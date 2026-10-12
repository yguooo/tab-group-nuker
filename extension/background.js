// Tab Group Nuker — one job: delete every OPEN tab group on demand.
//   • Toolbar button (popup) or the keyboard shortcut ⌘⇧X / Ctrl+Shift+X.
//
// It does NOT run anything at startup. Here is why: the Chrome extension API can only see and
// delete groups that are open in a window. The groups that pile up are the *closed saved* ones
// Chrome keeps when you quit (the pills on the bookmarks bar), and no extension can reach those.
// Removing them is the on-disk quit hook's job (see wipe-saved-groups.mjs + launchd/). A startup
// sweep that ungroups "whatever is open" cannot tell a restored tab from one you just opened, so
// it ends up fighting an auto-grouper and deleting the group it just made — which is exactly the
// bug this version removes. Keep the auto-grouper for grouping; let the quit hook clear the pile.
//
// Ungrouping every tab of a saved group removes the saved group too (same as Chrome's own
// "Ungroup" context-menu item, minus the confirm dialog).

async function nukeOpenGroups() {
  const groups = await chrome.tabGroups.query({});
  let tabs = 0;
  for (const g of groups) {
    try {
      const ts = await chrome.tabs.query({ groupId: g.id });
      if (ts.length) { await chrome.tabs.ungroup(ts.map((t) => t.id)); tabs += ts.length; }
    } catch (e) { console.warn("ungroup failed", g.id, e); }
  }
  return { groups: groups.length, tabs };
}

chrome.commands.onCommand.addListener((cmd) => { if (cmd === "nuke-open-groups") nukeOpenGroups(); });

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg.type === "nuke") reply(await nukeOpenGroups());
    else if (msg.type === "status") reply({ openGroups: (await chrome.tabGroups.query({})).length });
  })();
  return true;
});
