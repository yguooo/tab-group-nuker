const port = 9333, phase = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = async () => (await fetch(`http://127.0.0.1:${port}/json`)).json();
async function open(url) { const w = new WebSocket(url); await new Promise((r) => (w.onopen = r)); let i = 0; const pd = {};
  w.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pd[m.id]) pd[m.id](m); };
  const c = (method, params) => new Promise((r) => { const n = ++i; pd[n] = r; w.send(JSON.stringify({ id: n, method, params })); });
  const ev = async (x) => { const r = await c("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description)); return r.result?.result?.value; };
  return { w, c, ev }; }
async function findSW(name) { for (let i = 0; i < 60; i++) { for (const t of (await targets().catch(() => [])).filter((t) => t.type === "service_worker")) {
    const k = await open(t.webSocketDebuggerUrl); const n = await k.ev("chrome.runtime.getManifest().name+'/'+(typeof updateRules)").catch(() => null); if (n && (n.startsWith(name+"/") || (name==="GROUPER" && n.endsWith("/function")))) return k; k.w.close(); } await sleep(500); } throw new Error("no SW " + name); }
const count = (k) => k.ev("chrome.tabGroups.query({}).then(g=>g.length)");
const tabsN = (k) => k.ev("chrome.tabs.query({}).then(t=>t.length)");
const groupsDesc = (k) => k.ev("chrome.tabGroups.query({}).then(g=>g.map(x=>x.title).join('|'))");

const nuker = await findSW("Tab Group Nuker");
if (phase === "C") {
  await sleep(3000); console.log("C: after 3rd launch: tabs", await tabsN(nuker), "groups", await count(nuker), "[", await groupsDesc(nuker), "]");
  const b = await open((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl); await b.c("Browser.close", {});
} else if (phase === "A") {
  const grouper = await findSW("GROUPER");
  await grouper.ev(`chrome.storage.sync.set({"r-groupByDomain":true,"r-scope":"all"})`);
  await grouper.ev(`updateRules()`); await sleep(500);
  for (const u of ["https://example.com/", "https://example.com/a", "https://www.wikipedia.org/", "https://www.wikipedia.org/#x", "https://github.com/", "https://github.com/about"])
    await nuker.ev(`chrome.tabs.create({url:${JSON.stringify(u)},active:false}).then(t=>t.id)`);
  await sleep(10000);
  console.log("A: tabs", await tabsN(nuker), "groups", await count(nuker), "[", await groupsDesc(nuker), "]", "nuker session:", JSON.stringify(await nuker.ev("chrome.storage.session.get(null)")));
  const b = await open((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl);
  await b.c("Browser.close", {}); console.log("A: browser closed gracefully");
} else {
  console.log("B: nuker session before:", JSON.stringify(await nuker.ev("chrome.storage.session.get(null)")));
  console.log("B: groups restored by session restore:", await count(nuker), "[", await groupsDesc(nuker), "]");
  await nuker.ev('beginStartupSweep("harness: --load-extension never delivers onStartup")');
  for (let t = 0; t <= 20; t += 2) { console.log(`B: t=${t}s tabs`, await tabsN(nuker), "groups", await count(nuker), "[", await groupsDesc(nuker), "]"); await sleep(2000); }
  console.log("B: activate each restored tab (simulates user clicking lazy tabs; grouper re-groups on load)");
  const ids = await nuker.ev("chrome.tabs.query({}).then(t=>t.map(x=>x.id))");
  for (const id of ids) { await nuker.ev(`chrome.tabs.update(${id},{active:true}).then(()=>1)`); await sleep(700); }
  for (let t = 0; t <= 10; t += 2) { console.log(`B: after clicks t=${t}s groups`, await count(nuker), "[", await groupsDesc(nuker), "]"); await sleep(2000); }
  const final = await count(nuker); console.log(final === 0 ? "B: PASS zero groups" : "B: FAIL groups remain");
  console.log("B: wait for sweep window to end, then click tabs again (grouper should win now, by design)");
  await nuker.ev("chrome.storage.session.set({sweepUntil:0})"); await sleep(1500);
  for (const id of ids) { await nuker.ev(`chrome.tabs.update(${id},{active:true}).then(()=>1)`); await nuker.ev(`chrome.tabs.reload(${id}).then(()=>1)`); await sleep(1200); }
  await sleep(3000); console.log("B: after sweep ended + reloads: groups", await count(nuker), "[", await groupsDesc(nuker), "]");
  const b = await open((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl); await b.c("Browser.close", {});
}
process.exit(0);
