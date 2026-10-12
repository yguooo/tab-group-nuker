const send = (m) => chrome.runtime.sendMessage(m);
const $ = (id) => document.getElementById(id);

async function refresh() {
  const s = await send({ type: "status" });
  $("count").textContent = s.openGroups;
}

$("nuke").onclick = async () => {
  $("out").textContent = "Working…";
  const r = await send({ type: "nuke" });
  $("out").textContent = `Deleted ${r.groups} groups (${r.tabs} tabs ungrouped).`;
  refresh();
};

refresh();
