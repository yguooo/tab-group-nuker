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

So the job is split in three parts, plus one Chrome setting. See [docs/INTERNALS.md](docs/INTERNALS.md)
for how each works.

## The one Chrome setting that matters

`chrome://settings/appearance` → turn **off** *Automatically pin new tab groups to the bookmarks
bar*. Chrome still saves every group, but a group made by your auto-grouper is no longer pinned, so
it never becomes a pill. The pills already there: right-click each → *Unpin* or *Delete group*, or
let the quit hook below delete them all. Prefer an empty bar altogether? Turn off *Show tab groups
in bookmarks bar* as well.

This is the only part that cannot race with anything. Do it first; the rest of this repo keeps the
saved-group *list* (the "Tab groups" menu, and what syncs to your other devices) from growing.

## Parts

| Part | What it does | Needs |
|---|---|---|
| `extension/` | Deletes all **open** groups on demand (button or `⌘⇧X`) | Chrome, load unpacked |
| `wipe-saved-groups.mjs` | Deletes all saved groups, **open or closed**, from the profile store on disk, with a backup | Node 20+, Chrome quit |
| `launchd/` + `install.sh` | Runs the wipe automatically every time Chrome quits. No resident process | macOS |

A useful fact the extension relies on: ungrouping every tab of a saved group **deletes** the saved
group, the same as Chrome's own *Ungroup* menu item, just without the confirmation dialog.

## Install

### 1. Extension

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the `extension/`
   folder (not the repo root).
2. Repeat per Chrome profile. The extension points at this folder, so don't move it afterwards.

What you get:

- Toolbar button → **Delete all open groups**, or press `⌘⇧X` / `Ctrl+Shift+X`.

That is all it does, on purpose. Earlier versions also swept groups at startup; with an
auto-grouper running, the tabs API cannot tell a tab Chrome restored from one you opened a second
ago, and the sweep kept deleting the group the auto-grouper had just made. The automatic part of the
job (clearing the groups Chrome keeps when it quits) is done by the quit hook below, not by the
extension.

Run `test/run.sh` to see the whole cycle against the real "Tab Groups Extension" in a throwaway
Chrome for Testing profile (needs node and ~200 MB for the browser download).

### 2. Wipe script

```sh
npm install
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

Recommended first clean-up: press the extension's **Delete all open groups** in every window, quit
Chrome, run `--all --delete`, relaunch.

### 3. Automatic wipe on quit (macOS)

```sh
./install.sh        # from a checkout, or in one line without cloning:
curl -fsSL https://raw.githubusercontent.com/yguooo/tab-group-nuker/main/install.sh | bash
```

This copies the script, its dependency and a private copy of the `node` binary to
`~/.tab-group-nuker/` and registers a launchd *WatchPaths* job on Chrome's `SingletonLock`, a file
Chrome creates at launch and removes at quit. launchd runs the job on each change: it polls for
Chrome's browser process every 200 ms and, the moment it is gone, wipes every profile; if Chrome is
still up after a minute it just logs the on-disk count. Nothing stays running in between. launchd
cannot read `~/Desktop` or `~/Documents`, which is why the files are copied out of the repo.

Chrome removes the lock early in its shutdown and the process can take a few seconds to exit, so
the wipe happens a few seconds *after* ⌘Q. Relaunch Chrome within that window and it loads the
groups before they are deleted; the log then says so (`Chrome was relaunched while the wipe ran`).
Chrome restarting itself (`chrome://restart`, *Relaunch to update*) is the same race. Give it a
few seconds, or just quit again. The hook ignores Chrome's relauncher helper so a restart still
counts as a quit.

**Then one click only you can do.** Recent macOS blocks other programs from
`~/Library/Application Support/Google/Chrome`, and no program can grant itself that access. The
installer opens System Settings → Privacy & Security → Full Disk Access and puts the path on your
clipboard: click `+`, press ⌘⇧G, paste, Return, switch `node` on. macOS ties the permission to the
program launchd starts, which is why the job starts `node` directly rather than through a shell, and
uses its own copy of `node` so a Homebrew upgrade cannot invalidate the grant. Until then every run
logs `EPERM` and nothing is deleted.

If you only want the extension: set Chrome → On startup → *Continue where you left off* and skip
parts 2 and 3; every group open at quit comes back at launch and the extension deletes it. Parts 2
and 3 exist for people who start Chrome on a blank New Tab page, where Chrome never reopens those
groups.

```sh
tail ~/.tab-group-nuker-backups/quit.log      # see it work
./uninstall.sh                                # remove the job and ~/.tab-group-nuker
```

Backups accumulate, one folder per profile per quit. They are small; delete old ones freely.

## Day-to-day

Flip the Appearance setting, install the three parts once, then do nothing. Groups form while you
browse, nothing is pinned, every quit wipes the pile, and your auto-grouper starts fresh. If you
only install the script, run it whenever the "Tab groups" menu fills up.

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
  `chrome://settings/syncSetup/advanced`) and the wipe is final on the first quit. With the
  Appearance setting above they come back unpinned at worst, never as pills.
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
