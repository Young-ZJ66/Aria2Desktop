# Code signing policy / 代码签名政策

**Project:** Aria2Desktop  
**Repository:** <https://github.com/Young-ZJ66/Aria2Desktop>  
**License:** MIT  
**Code signing policy last updated:** 2026-11-08

## Free code signing provided by SignPath.io

Free code signing on Windows provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

Aria2Desktop is an open-source project. Once accepted into the SignPath Foundation open-source code signing program, Windows installers distributed through the official GitHub Releases page are signed through that program. The signing certificate is issued to SignPath Foundation; the publisher shown in Windows file properties is therefore **SignPath Foundation**, not an individual maintainer.

> **Status (2026-11-08):** the signing pipeline is integrated and documented, but the SignPath Foundation application has not yet been approved. Until it is approved and the repository secrets are configured, Windows installers in GitHub Releases remain unsigned.

## Scope of signing

The following artifacts are eligible for signing:

- Windows NSIS installers named `Aria2Desktop-<version>-<arch>-Setup.exe` (x64 and x86), built by the GitHub Actions workflow [`.github/workflows/release.yml`](../.github/workflows/release.yml) from a tag in this repository.

The following artifacts are **not signed** by the current process:

- Portable ZIP archives and the application executable inside them.
- macOS `.dmg` / `.zip` builds and Linux `.deb` / `.AppImage` builds (no free publicly trusted signing service is available for these platforms).
- Browser extension packages.
- Any binary that was not produced by the official GitHub Actions release workflow.

Only artifacts built by GitHub Actions on GitHub-hosted runners from this public repository are submitted to SignPath. Local developer builds are never signed.

## Team roles and responsibilities

The project currently has a single maintainer:

| Role | Member | Responsibility |
|---|---|---|
| Author | [@Young-ZJ66](https://github.com/Young-ZJ66) | Writes and reviews code, prepares releases |
| Reviewer | [@Young-ZJ66](https://github.com/Young-ZJ66) | Reviews changes before merge; all changes require review |
| Approver | [@Young-ZJ66](https://github.com/Young-ZJ66) | Approves each SignPath signing request before signing |

All team members are required to enable multi-factor authentication (MFA) on both GitHub and SignPath. If additional maintainers join the project, they must be added to this table and complete MFA before being allowed to author, review, or approve releases.

### Release approval process

1. Changes are made through pull requests and reviewed by a Reviewer.
2. CI must pass type checking, unit tests, linting, extension validation, and end-to-end tests.
3. A maintainer creates a version tag; the release workflow builds the Windows installer on a GitHub-hosted runner.
4. The workflow uploads the unsigned installer to SignPath as a GitHub Actions artifact.
5. An Approver manually reviews the signing request in SignPath, confirming that it comes from the expected repository, tag, workflow run, and version, then approves it.
6. SignPath signs the installer; the workflow verifies `Get-AuthenticodeSignature` reports `Status=Valid` before publishing the release.

Signing requests are never approved automatically. A failed or rejected signing request stops the release; the project does not publish an unsigned installer as a fallback.

## Privacy policy

Aria2Desktop does not collect telemetry, analytics, or personal information. Settings, download history, logs, and plugin data are stored locally on the user's computer. Network connections are made only for the features the user enables (for example downloading files, checking GitHub Releases for updates, or fetching the optional plugin registry).

Read the full privacy policy: [docs/privacy.md](privacy.md).

## Verification

Users can verify a signed Windows installer with PowerShell:

```powershell
Get-AuthenticodeSignature .\Aria2Desktop-<version>-x64-Setup.exe | Format-List Status, StatusMessage, SignerCertificate
```

Expected result: `Status: Valid`, and the signer certificate subject contains `SignPath Foundation`.

The SHA-256 checksum of every release asset is published alongside the file in GitHub Releases. See [docs/code-signing.md](code-signing.md) for detailed verification steps and the signing setup.

## Reporting a problem

If you believe a signed binary was not produced by this project, or you find a security issue, please open a private security advisory at <https://github.com/Young-ZJ66/Aria2Desktop/security/advisories/new> or contact the maintainer through GitHub. Do not disclose suspected supply-chain issues publicly before they are investigated.

## Changes to this policy

This policy is versioned in the repository. Material changes will be committed to the `main` branch and reflected in the **last updated** date above.
