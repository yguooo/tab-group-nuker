const port = 9333, phase = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Chrome for Testing 155 listens on [::1] only; older builds on 127.0.0.1.
let host = "[::1]";
const get = async (p) => { try { return await (await fetch(`http://${host}:${port}${p}`)).json(); } catch (e) { host = host === "[::1]" ? "127.0.0.1" : "[::1]"; return (await fetch(`http://${host}:${port}${p}`)).json(); } };
const targets = () => get("/json");
async function open(url) { const w = new WebSocket(url); await new Promise((r) => (w.onopen = r)); let i = 0; const pd = {};
  w.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pd[m.id]) { pd[m.id].r(m); delete pd[m.id]; } };
  w.onclose = () => { for (const k of Object.keys(pd)) { pd[k].j(new Error("devtools socket closed: " + url)); delete pd[k]; } };
  const c = (method, params) => new Promise((r, j) => { const n = ++i; pd[n] = { r, j }; w.send(JSON.stringify({ id: n, method, params })); });
  const ev = async (x) => { const r = await c("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description)); return r.result?.result?.value; };
  return { w, c, ev }; }
async function findSW(name) { for (let i = 0; i < 60; i++) { for (const t of (await targets().catch(() => [])).filter((t) => t.type === "service_worker")) {
    const k = await open(t.webSocketDebuggerUrl); const n = await k.ev("chrome.runtime.getManifest().name+'/'+(typeof updateRules)").catch(() => null); if (n && (n.startsWith(name+"/") || (name==="GROUPER" && n.endsWith("/function")))) return k; k.w.close(); } await sleep(500); } throw new Error("no SW " + name); }
const count = (k) => k.ev("chrome.tabGroups.query({}).then(g=>g.length)");
const tabsN = (k) => k.ev("chrome.tabs.query({}).then(t=>t.length)");
const groupsDesc = (k) => k.ev("chrome.tabGroups.query({}).then(g=>g.map(x=>x.title).join('|'))");

const nuker = await findSW("Tab Group Nuker");
const closeBrowser = async () => { const b = await open((await get("/json/version")).webSocketDebuggerUrl); await b.c("Browser.close", {}); };
const show = async (tag) => console.log(tag, "tabs", await tabsN(nuker), "groups", await count(nuker), "[", await groupsDesc(nuker), "]");
let fails = 0;
const expect = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) fails++; };

if (phase === "A") {
  const grouper = await findSW("GROUPER");
  await grouper.ev(`chrome.storage.sync.set({"r-groupByDomain":true,"r-scope":"all"})`);
  await grouper.ev(`updateRules()`); await sleep(500);
  const add = async (urls) => { for (const u of urls) await nuker.ev(`chrome.tabs.create({url:${JSON.stringify(u)},active:false}).then(t=>t.id)`); await sleep(8000); };
  await add(["https://example.com/", "https://example.com/a", "https://www.wikipedia.org/", "https://www.wikipedia.org/#x"]);
  await show("A: grouper done:");
  expect((await count(nuker)) >= 2, "A: grouper created groups");
  const before = await tabsN(nuker);
  console.log("A: nuke:", JSON.stringify(await nuker.ev("nukeOpenGroups()")));
  await sleep(1000); await show("A: after nuke:");
  expect((await count(nuker)) === 0, "A: zero groups after nuke");
  expect((await tabsN(nuker)) === before, "A: all tabs kept");
  await add(["https://github.com/", "https://github.com/about"]);
  await show("A: new site after nuke:");
  expect((await count(nuker)) >= 1, "A: grouper still groups new tabs (nuker does not fight it)");
  await sleep(2000);
  expect((await count(nuker)) >= 1, "A: that group survives in-session");
  console.log(`A: ${fails} failures; quitting with groups open so Chrome saves them`);
  await closeBrowser();
} else {
  await sleep(3000); await show("C: relaunch on blank page:");
  expect((await count(nuker)) === 0, "C: zero groups after wipe + relaunch");
  console.log(`C: ${fails} failures`);
  await closeBrowser();
}
process.exit(fails ? 1 : 0);
