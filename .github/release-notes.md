# Aria2Desktop v1.3.6 Release Notes

v1.3.6 is an automation release: a new **Automation** page adds RSS/Atom subscriptions and watched folders that create download tasks by themselves, the yt-dlp integration gains playlist, subtitle, cookie and format-preset support, and the browser extension now ships a Firefox variant.

## 📡 New: RSS / Atom Subscriptions

- A new **Automation** entry in the sidebar manages subscriptions and watched folders, plus a log of the last 200 auto-import records.
- Subscribe to any **RSS 2.0 / Atom** feed and let matching entries become downloads automatically — no external dependency, the parser is built in.
- **Filters & limits**: include/exclude regular expressions, a per-fetch cap (1–50 entries), an optional save directory, and a fetch interval from 5 minutes to 7 days.
- **No duplicates**: each subscription remembers up to 500 seen entries keyed by guid / enclosure URL / link, so nothing is added twice.
- **Entry types**: magnet links are added directly; `.torrent` enclosures are downloaded and added via `aria2.addTorrent`; plain http(s) links are added as normal downloads.
- **Fetch Now** shows a preview of the matching entries, and the list displays each subscription's last fetch time and status.
- Works against the **active connection profile**, so subscriptions can fill a remote instance too.

## 📁 New: Watched Folders

- Point Aria2Desktop at a folder and every new **`.torrent` / `.metalink` / `.txt`** file (one magnet link per line) is imported automatically.
- Choose what happens to the source file after a successful import: **delete it** or **move it into an `imported/` subfolder**.
- A file is imported only after it is **stable** (unchanged size across scans and at least 3 seconds old), so partially written files are never picked up.
- **SHA-256 content deduplication**: the same file content is never imported twice, even under a different name.
- Failed imports are retried on the next scan; nothing is lost while the engine is offline.

## 🎬 yt-dlp: Playlists, Subtitles, Cookies & Format Presets

- **Playlist downloads**: paste a playlist URL to load its entries (up to 500) with titles and durations, then pick the ones you want.
- **Quality presets**: Best / 1080p / 720p / 480p / Best audio / Extract MP3 — one click instead of reading format tables; a custom expression field remains for power users.
- **Subtitles**: download subtitles in the languages you choose, optionally including auto-generated ones, converted to `srt`.
- **Cookie file support** for sites that require a login.
- Playlist progress now shows the **entry title and index (n/m)** so batch downloads are easy to follow.

## 🦊 Firefox Extension

- Every release now ships **`Aria2Desktop-Extension-Firefox-v1.3.6.zip`**, a Firefox-specific build (event-page background + `browser_specific_settings.gecko`) ready for AMO submission.
- The background script now feature-detects `chrome.downloads.onDeterminingFilename`; since Firefox never implemented it, the "take over browser downloads" option applies to Chromium browsers only for now.
- `npm run check:extension` grew from 16 to **21 checks**, validating the Firefox manifest variant on every CI run.

## 🛠️ Other

- All **21 languages** fully translated for every new string (96 new keys, plus the yt-dlp keys propagated to every locale).
- The test suite grew from 691 to **795 unit tests**, covering the feed parser, both auto-import services, playlist mapping, and stream argument construction; E2E remains at 137 passing checks.

## ⚠️ Known Limitations

- Auto-import results are not pushed to the UI; the Automation page refreshes its data every 30 seconds while it is open.
- Windows installers are unsigned; SmartScreen may warn about an unknown publisher. Use the `.sha256` files on the Release page to verify downloads.
- macOS builds are unsigned and un-notarized; right-click → "Open" on first launch.
- In-app auto-update is still primarily for Windows installers; Linux users can update via AppImageUpdate / `appimageupdatetool`.
