# Tab Group Nuker

Bulk-delete **every** Chrome saved tab group, including the closed ones that pile up on the
bookmarks bar, and keep them from coming back.

Chrome gives you exactly one way to get rid of a saved group: right-click it, *Delete group*,
confirm. One at a time. This repo removes hundreds in under a second and, on macOS, does it
automatically every time Chrome quits.

## The problem

Since 2024 Chrome auto-saves every tab group ("saved tab groups v2"). That has three consequences
most people never asked for:

- **Groups never die on their own.** Close the last tab of a group and the group *closes* but stays
  saved, shown as a pill on the bookmarks bar. Quit Chrome and every open group is kept too.
- **Sync spreads them.** With *Open tabs* sync on, every saved group is uploaded to your Google
  account and mirrored to every signed-in Chrome. A group you closed on your laptop months ago is
  still on your desktop, and deleting it on one device is the only way to delete it anywhere.
- **Auto-grouping extensions manufacture them.** Extensions like
  [Tab Groups Extension](https://chromewebstore.google.com/search/tab%20groups%20extension) that
  group tabs by domain create a fresh group for every site you visit. Each one gets saved. Browse
  for a few months and you have a wall of `google`, `youtube`, `reddit` pills.

This repo was written after finding **852 saved groups in one profile and 1038 in another**, nearly
all single-tab groups named after a domain. This tool is the natural companion to an auto-grouper:
keep the grouping while you browse, lose the residue when you quit.

## Why an extension alone cannot fix it

The extension API (`chrome.tabGroups`, `chrome.tabs`) only sees groups that are **open in a
window**. Closed saved groups are not bookmarks, are not in `chrome.sessions`, and there is no API
to list, open, or delete them. They exist only in the profile's sync datastore on disk, which
Chrome keeps locked while it runs. An extension also cannot run anything at quit time; Chrome kills
its workers first.

So the job is split in three parts. See [docs/INTERNALS.md](docs/INTERNALS.md) for how each works.

## Parts

| Part | What it does | Needs |
|---|---|---|
| `extension/` | Deletes all **open** groups on demand (button or `⌘⇧X`) | Chrome, load unpacked |
| `wipe-saved-groups.mjs` | Deletes all saved groups, **open or closed**, from the profile store on disk, with a backup | Node 20+, Chrome quit |
| `launchd/` + `install.sh` | Runs the wipe automatically every time Chrome quits. No resident process | macOS |

A useful fact the extension relies on: ungrouping every tab of a saved group **deletes** the saved
group, the same as Chrome's own *Ungroup* menu item, just without the confirmation dialog.

## Setup

You need Google Chrome and, for the automatic wipe, macOS with Node 20+ (`brew install node` or
[nodejs.org](https://nodejs.org)). Windows and Linux get parts 1 and 2 (manual wipe only).

### Part 1 · Extension (1 minute)

1. Get the extension folder: download `tab-group-nuker-extension.zip` from
   [Releases](https://github.com/yguooo/tab-group-nuker/releases) and unzip it, or clone this repo
   and use its `extension/` folder.
2. Open `chrome://extensions`, switch **Developer mode** on (top right), click **Load unpacked**,
   pick the folder that contains `manifest.json`.
3. Do step 2 again in every Chrome profile you use. Chrome keeps pointing at that folder, so
   don't move or delete it.

Check: the toolbar button shows *Open groups right now: N*. Pressing **Delete all open groups**
(or `⌘⇧X` / `Ctrl+Shift+X`) ungroups every open group in every window; the tabs stay open. That
is the whole extension: a manual "ungroup everything" button. It never runs on its own.

### Part 2 · Automatic wipe when Chrome quits (macOS, 3 minutes)

```sh
curl -fsSL https://raw.githubusercontent.com/yguooo/tab-group-nuker/main/install.sh | bash
```

(from a clone: `./install.sh`). This puts the wipe script and a private copy of `node` in
`~/.tab-group-nuker/` and registers a launchd job that runs the wipe every time Chrome quits.

**Then one click only you can do.** macOS blocks other programs from Chrome's data folder, and no
program can grant itself that access. The installer opens *System Settings → Privacy & Security →
Full Disk Access* and puts the path on your clipboard. In that window: click **+**, press
**⌘⇧G**, paste, press **Return**, make sure the switch next to `node` is on. Done.

Check: quit Chrome (`⌘Q`), wait 5 seconds, open it again, then run

```sh
tail -20 ~/.tab-group-nuker-backups/quit.log
```

- `chrome quit -> wiping` … `deleted N records` — working.
- `EPERM` — the Full Disk Access step above is missing.
- `Chrome was relaunched while the wipe ran` — you reopened Chrome too fast; quit again.

Re-running the installer later (after a `git pull`) is safe; it skips the access step when the
log shows it already works.

### Part 3 · Chrome settings (optional)

- *Appearance → Automatically pin new tab groups to the bookmarks bar*: you can leave it on. Pinned
  groups show on the bookmarks bar while they are open, and the quit hook deletes them when you
  quit. Turn it off if you'd rather never see a pill at all, even on a too-fast relaunch.
- *Sync → Tabs*: leave it on unless groups you never touched come back after a quit; that means
  another signed-in device or the account is pushing them again.

### Manual wipe (any OS, no install)

```sh
git clone https://github.com/yguooo/tab-group-nuker && cd tab-group-nuker && npm install
node wipe-saved-groups.mjs                         # which profiles have saved groups
node wipe-saved-groups.mjs --profile "Profile 5"   # dry run: lists every group and its tab count
node wipe-saved-groups.mjs --profile "Profile 5" --delete
node wipe-saved-groups.mjs --all --delete          # every profile
```

- `--profile` accepts the folder name (`Default`, `Profile 5`) or the display name shown in Chrome.
- `--delete` refuses to run while Chrome is open; it needs the database lock. Quit fully first.
- Every wipe first copies the store to `~/.tab-group-nuker-backups/<profile>-<timestamp>/`. To roll
  back, quit Chrome and copy that folder over `<user data>/<profile>/Sync Data/LevelDB`.
- Non-default user data directory: set `CHROME_USER_DATA`. Defaults cover macOS, Linux and Windows.

### Uninstall

```sh
./uninstall.sh      # removes the launchd job and ~/.tab-group-nuker; backups are kept
```

Then remove the extension in `chrome://extensions`, and optionally remove `node` from Full Disk
Access.

### How the quit hook works

launchd watches Chrome's `SingletonLock`, a file Chrome creates at launch and removes at quit. On
each change the job polls for Chrome's browser process every 200 ms and, the moment it is gone,
wipes every profile; if Chrome is still up after a minute it just logs the on-disk count. Nothing
stays running in between. Chrome removes the lock early in shutdown and the process can take a few
seconds to exit, so the wipe lands a few seconds after ⌘Q; a relaunch inside that window loads the
groups before they are deleted, and the log says so. The hook ignores Chrome's relauncher helper so
`chrome://restart` and *Relaunch to update* count as a quit. The job starts its own copy of `node`
directly (no shell) because macOS ties Full Disk Access to the program launchd starts.

If you only want the extension: set Chrome → On startup → *Continue where you left off* and skip
parts 2 and 3; every group open at quit comes back at launch and you press `⌘⇧X`. Parts 2 and 3
exist for people who start Chrome on a blank New Tab page, where Chrome never reopens those groups.

Backups accumulate, one folder per profile per quit. They are small; delete old ones freely.

## Day-to-day

Install parts 1 and 2 once, then do nothing. Groups form while you browse, every quit wipes the
pile, and your auto-grouper starts fresh. `⌘⇧X` is there for when you want a clean window right
now. If you only install the script, run it whenever the bookmarks bar fills up.

`~/.tab-group-nuker-backups/quit.log` tells you what happened at each quit:

- `chrome quit -> wiping` … `deleted N records` — worked.
- `chrome running, skip` — Chrome was still up a minute after the trigger (a launch, or Chrome
  writing to its folder; launchd also fires on those). Normal.
- `Chrome was relaunched while the wipe ran` — see part 3; quit again.
- `EPERM` — Full Disk Access not granted to `~/.tab-group-nuker/node`.

## Sync caveats

- If the profile syncs tab groups to a Google account, groups the wipe deleted locally can come
  back from the account (the wipe never tells the server). Groups then seem to survive one quit and
  vanish after the next. **Turn off tab sync for the profile** (*Open tabs* / *Tabs* in
  `chrome://settings/syncSetup/advanced`) and the wipe is final on the first quit.
- Other signed-in devices still hold their copies and will push changes back if a group is touched
  there. Run the wipe on each device, or turn off tab sync as above.
- Shared tab groups (`shared_tab_group_data` entities) are left alone.

## Tested on

Google Chrome 154 on macOS 26. The extension was verified by loading it through the DevTools
protocol in a throwaway profile, creating groups, nuking them, quitting, and confirming the saved
records were gone from disk. The on-disk layout is Chrome's `SavedTabGroupData` proto; if Google
changes it the dry run shows `unparsed` records instead of titles and nothing is deleted blindly.

## License

MIT
