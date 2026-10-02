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
| `extension/` | Deletes all **open** groups on demand; ungroups whatever session-restore brings back at startup; optional auto-kill mode | Chrome, load unpacked |
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
- On every Chrome start it ungroups the groups that session-restore brings back, over the first
  20 seconds, so a launch always begins with zero groups.
- **Auto-kill mode**: any group that appears is ungrouped instantly. Useful to clear closed saved
  groups by clicking them one by one (each opens and vanishes) when you cannot quit Chrome. Leave it
  **off** if you run an auto-grouping extension, otherwise the two fight.

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
./install.sh
```

This copies the script and its dependency to `~/.tab-group-nuker/` and registers a launchd
*WatchPaths* job on Chrome's `SingletonLock`, a file Chrome creates at launch and removes at quit.
launchd runs the job on each change: while Chrome is up it just logs the on-disk count; once Chrome
is gone it wipes every profile. Nothing stays running in between. launchd cannot read `~/Desktop`
or `~/Documents`, which is why the files are copied out of the repo.

```sh
tail ~/.tab-group-nuker-backups/quit.log      # see it work
./uninstall.sh                                # remove the job and ~/.tab-group-nuker
```

Backups accumulate, one folder per profile per quit. They are small; delete old ones freely.

## Day-to-day

Install all three parts once, then do nothing. Every quit wipes the pile, every launch clears what
session-restore brought back, and your auto-grouper starts fresh. If you only install the script,
run it whenever the bookmarks bar fills up.

## Sync caveats

- The wipe keeps the store's sync progress marker, so Chrome does not re-download the deleted
  groups from the server at next start.
- Other signed-in devices still hold their copies and will push changes back if a group is touched
  there. Run the wipe on each device, or turn off *Open tabs* in `chrome://settings/syncSetup/advanced`.
- Shared tab groups (`shared_tab_group_data` entities) are left alone.

## Tested on

Google Chrome 154 on macOS 26. The extension was verified by loading it through the DevTools
protocol in a throwaway profile, creating groups, nuking them, quitting, and confirming the saved
records were gone from disk. The on-disk layout is Chrome's `SavedTabGroupData` proto; if Google
changes it the dry run shows `unparsed` records instead of titles and nothing is deleted blindly.

## License

MIT
