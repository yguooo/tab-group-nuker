# Internals

Notes for anyone who wants to understand, port, or debug this. Everything here was established by
reading the profile on disk and by experiments with Chrome 154 on macOS, not from documentation,
because Google documents none of it.

## Where saved tab groups live

Each profile has a sync datastore at `<profile>/Sync Data/LevelDB`, a plain LevelDB with the
default comparator (the `classic-level` npm package opens it as is). Chrome stores every sync model
type in it under a key prefix. Saved tab groups use `saved_tab_group`:

| Key | Content |
|---|---|
| `saved_tab_group-dt-<guid>` | the entity, a serialized `sync_pb::SavedTabGroupData` |
| `saved_tab_group-md-<guid>` | per-entity sync metadata |
| `saved_tab_group-GlobalMetadata` | progress marker for the whole type |

Groups **and tabs** are both entities under the same prefix. Each tab is its own record that points
at its group by guid. A profile with 852 groups and 2800 tabs therefore has about 3650 `dt-` keys.

The store is written whether or not sync is enabled; it is Chrome's local persistence for the
feature. It is locked (LevelDB `LOCK`) for as long as Chrome runs.

## Record layout

`SavedTabGroupData` wraps the sync specifics:

```
SavedTabGroupData
  1: version (varint)
  2: SavedTabGroupSpecifics
       1: guid (string)
       2: creation_time_windows_epoch_micros
       3: update_time_windows_epoch_micros
       4: SavedTabGroup      { 2: title, 3: color, 4: position, ... }   -- group record
       5: SavedTab           { 1: group_guid, 3: url, 4: title, ... }   -- tab record
```

`wipe-saved-groups.mjs` carries a 30-line protobuf wire-format walker to pull titles and group
membership for the dry run. It never depends on the layout to delete: deletion is by key prefix.

## What the wipe deletes and keeps

It deletes every `saved_tab_group-dt-*` and `saved_tab_group-md-*` key and keeps
`saved_tab_group-GlobalMetadata`. Keeping the progress marker tells Chrome "you are up to date with
the server", so on next launch it does not do an initial merge and re-download everything. The
server copy still exists; another device that modifies a group will push that one back.

Before touching the store it copies the whole LevelDB directory to
`~/.tab-group-nuker-backups/<profile>-<ms>/`. Rollback is a copy in the other direction with Chrome
quit.

The dry run never opens the live store. It copies the directory to a temp dir and reads the copy,
so it works while Chrome holds the lock.

## Ungrouping deletes a saved group

In the extension API, `chrome.tabs.ungroup()` on every tab of a group removes the group. For a
*saved* group this also deletes the saved record, which is why Chrome's own *Ungroup* context menu
item shows a "this will delete the group" confirmation. The API path skips the dialog. Verified by
ungrouping, quitting, and reading the store: the record is gone.

Closing the last tab of a group is different: the group becomes a *closed saved group* and stays.
There is no "before close" event, so the extension cannot convert a close into an ungroup.

## What the extension API cannot see

`chrome.tabGroups.query` returns open groups only. Closed saved groups are not in
`chrome.bookmarks` (the bookmarks-bar pills are a separate UI surface), not in `chrome.sessions`,
and there is no method to open one. The only way for an extension to reach a closed group is for
the user to click it; auto-kill mode exists for that.

## Running something when Chrome quits

Chrome creates `<user data>/SingletonLock` (a symlink) at launch and removes it at quit. A launchd
agent with `WatchPaths` on that file is run by launchd on each change and exits when done, so there
is no resident process. The script waits up to 15 s for the Chrome process to disappear (the lock is
removed slightly before the process exits), then wipes.

Two gotchas:

- **TCC.** launchd agents are denied access to `~/Desktop`, `~/Documents` and `~/Downloads` with a
  bare "Operation not permitted". `install.sh` therefore copies the tooling to `~/.tab-group-nuker/`.
- **PATH.** launchd gives a minimal PATH; the plist sets it to include the directory of the `node`
  found at install time.

## Why a launcher app was rejected

An intermediate design wrapped Chrome in an AppleScript app that wiped first, then launched Chrome.
It works but requires everyone to launch Chrome through the wrapper; a link clicked from another app
bypasses it. The quit hook catches every exit regardless of how Chrome was started.

## Testing the extension without a real profile

Branded Chrome 137+ ignores `--load-extension`. Instead:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir=/tmp/udd --remote-debugging-port=9333 --enable-unsafe-extension-debugging
```

then call `Extensions.loadUnpacked {path}` on the browser DevTools target, find the extension's
`service_worker` target in `/json`, and `Runtime.evaluate` against it (`nukeOpenGroups()` is a
top-level function in the worker). Quit and run the wipe script with `CHROME_USER_DATA=/tmp/udd` to
check the store.
