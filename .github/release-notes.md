# Aria2Desktop v1.3.5 Release Notes

v1.3.5 is a feature release: AppImages now ship embedded update information with zsync delta updates, task history moves to a SQLite database with incremental writes, and a new BT Insights page gives real-time visibility into peers and trackers.

## 🔄 AppImage Update Information & zsync

- **Embedded update information**: Linux AppImages now embed the standard `gh-releases-zsync` update string in the runtime's `.upd_info` section, so AppImageUpdate / `appimageupdatetool` can discover and install updates.
- **zsync delta files**: Each release now ships a `.AppImage.zsync` file next to the AppImage, enabling bandwidth-saving delta updates instead of full re-downloads.
- **CI integration**: The release workflow embeds update info and generates the zsync file right after the Linux build, verifies both artifacts with `verify-dist`, and uploads them together with SHA-256 checksums. PR builds use the same pipeline, so the artifacts CI tests are exactly what users get.
- **AppImageHub warning resolved**: The AppImage directory test previously flagged "AppImage contains no update information"; this release addresses it.

## 🗄️ SQLite Task History

- **SQLite backend**: Completed task history now lives in a proper SQLite database (`tasks-history.db`, WAL mode) via Node's built-in `node:sqlite` — no new native dependencies. The old JSON file is migrated automatically on first launch, with a backup kept as `persisted-tasks.json.migrated`.
- **Incremental writes**: Completing a task writes a single row; deleting a task removes its row. The previous approach re-serialized the entire history on every change, which meant re-writing tens of thousands of rows for each completion.
- **Capacity management**: History is capped at 50,000 records; the oldest records are trimmed first. The silent 24-hour timer that deleted records older than 180 days has been removed — pruning by age was data loss nobody asked for. `cleanupExpiredTasks` remains as an explicit API for a future settings action.
- **JSON fallback**: Environments without `node:sqlite` automatically fall back to the previous JSON storage, so older Electron/Node combinations keep working.
- **Diagnostics**: The stats channel now reports which backend is active (`sqlite` / `json`).

## 📡 New: BT Insights Page

- A new **BT Insights** entry in the sidebar opens a live view for BitTorrent / magnet tasks.
- **Task picker** lists only BT and magnet tasks (including magnet metadata stages before torrent info attaches).
- **Summary cards**: peer count, seeder count, aggregate download/upload speed, BT mode, and info hash.
- **Peers table**: address, client identification, download/upload speed, seeder flag, and progress — with the existing IP geolocation lookup.
- **Trackers table**: full announce list grouped by tier, deduplicated.
- **Smart polling**: refreshes every 5 seconds while the page is visible and connected; pauses when the tab is hidden or the connection drops, and keeps the last good frame on RPC errors.
- **All 21 languages** fully translated for every new string.

## 🛠️ Other

- Application and browser extension versions are now 1.3.5.
- Task history testing expanded: 691 unit tests pass, covering the SQLite history database, the incremental persistence service, and the BT insights polling logic.

## ⚠️ Known Limitations

- Windows installers are unsigned; SmartScreen may warn about an unknown publisher. Use the `.sha256` files on the Release page to verify downloads.
- macOS builds are unsigned and un-notarized; right-click → "Open" on first launch. Removing the Gatekeeper prompt requires an Apple Developer Program membership.
- In-app auto-update is still primarily for Windows installers; Linux users can update via AppImageUpdate / `appimageupdatetool` using the new update information.
