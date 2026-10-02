const send = (m) => chrome.runtime.sendMessage(m);
const $ = (id) => document.getElementById(id);

async function refresh() {
  const s = await send({ type: "status" });
  $("count").textContent = s.openGroups;
  $("auto").checked = s.autoKill;
}

$("nuke").onclick = async () => {
  $("out").textContent = "Working…";
  const r = await send({ type: "nuke" });
  $("out").textContent = `Deleted ${r.groups} groups (${r.tabs} tabs ungrouped).`;
  refresh();
};

$("auto").onchange = async (e) => {
  await send({ type: "setAutoKill", value: e.target.checked });
  refresh();
};

refresh();
