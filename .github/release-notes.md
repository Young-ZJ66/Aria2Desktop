# Aria2Desktop v1.3.7 Release Notes

v1.3.7 is a remote-access release. The built-in **Web Console** becomes an installable PWA with scoped API tokens and an OpenAPI document, webhooks gain retries, a failed-delivery queue and HMAC signatures, settings can be exported/imported between machines, and a new headless guide shows how to run the app as a system service.

## 📱 Web Console: PWA, scoped tokens, OpenAPI

- The Web Console is now an **installable PWA** — open it on a phone, choose "Add to Home Screen", and it launches full-screen with its own icon, offline shell and automatic update prompt.
- **Scoped API tokens**: besides the master token, create named tokens limited to `tasks:read`, `tasks:write`, `tasks:control`, `audit:read` or `admin`. A read-only token can browse the queue but cannot add, pause or delete anything.
- Each token shows its scopes, creation time and last-used time in **Settings → Advanced → API Tokens**, and can be revoked at any time.
- **OpenAPI 3.0.3 document** served at `/openapi.json`, covering every console endpoint, the bearer auth scheme and the scope semantics — import it into Postman, Insomnia or any generator.
- Unauthorized and insufficient-scope requests are rejected with `401` / `403 { error: "insufficient_scope", required }` and recorded in the audit log.

## 🔁 Webhooks: retries, queue and HMAC

- Webhook actions in completion rules now **retry automatically** with exponential backoff (default 4 attempts, 60 s base delay, capped at 6 h).
- Failed deliveries are kept in a **delivery queue** shown under Settings → Workflow, with attempts, next attempt time and the last error; retry any entry by hand or clear the queue.
- **HMAC-SHA256 signatures**: set a secret per webhook and each request carries `X-Aria2-Timestamp` and `X-Aria2-Signature: sha256=<hex>` over `<timestamp>.<body>`, so receivers can verify authenticity and reject replays.
- Queue contents are persisted, so pending deliveries survive an app restart.
- New per-rule fields: `secret`, `maxRetries` (0–10) and `retryDelaySeconds` (5–3600).

## 💾 Settings export / import

- **Export** all settings to a JSON file — optionally including secrets, which requires an explicit confirmation first.
- **Import** with a **dry-run preview** showing how many keys will be applied, skipped or rejected, plus which secrets stay local instead of being overwritten.
- Secrets (engine RPC secret, web console tokens, webhook secrets) are preserved from the local machine when the imported file is redacted.
- Useful for moving a setup between machines or keeping a known-good configuration around.

## 🖥️ Headless service guide

- New `docs/headless.md`: run Aria2Desktop with `--headless` as a **systemd user service** on Linux (including `loginctl enable-linger` and the `APPIMAGE_EXTRACT_AND_RUN` note) or as a **Windows scheduled task**.
- Covers SSH port forwarding for the Web Console (`6802`) and the extension API (`6801`), plus the `allowedIps` / strong-token / firewall checklist before exposing either port.
- MCP, CLI and Webhook entry points are documented together with working examples.

## 🛠️ Other changes

- The CLI `add` command now matches the MCP tool schema (`--fileName/-n` supported; `--dir` reports a clear error because the target directory is decided by in-app category rules).
- 21 languages updated with all new strings (80 new keys per locale).
- Web Console layout is now mobile-first: the task table collapses into cards on narrow screens, with safe-area padding for notched devices.

## ⚠️ Known limitations

- Push notifications for the Web Console are not implemented; the page polls every 3 seconds while open.
- The PWA offline shell caches only the console UI, not task data — without a connection the last rendered state is shown.
- Webhook signatures cover the raw body only; receivers must tolerate clock skew when validating `X-Aria2-Timestamp`.

---

**Full changelog**: https://github.com/Young-ZJ66/Aria2Desktop/compare/v1.3.6...v1.3.7
