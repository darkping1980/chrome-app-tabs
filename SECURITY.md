# Security Policy

## Supported versions

Only the latest release on the [Releases page](https://github.com/darkping1980/chrome-app-tabs/releases/latest) receives fixes.

## Reporting a vulnerability

Please **do not** report security vulnerabilities in a public issue.

Use GitHub's private vulnerability reporting instead:
**[Report a vulnerability](https://github.com/darkping1980/chrome-app-tabs/security/advisories/new)**
(repository → *Security* tab → *Report a vulnerability*).

Please include the affected version, the steps to reproduce, and the impact you expect. Remove personal information
(user names, paths, screenshots of unrelated windows) from logs and screenshots before you send them.

This is a volunteer project without a support contract. Reports are handled on a best-effort basis; there is no
guaranteed response time and no bug bounty.

## Security model (for reviewers)

- The extension communicates only with its own native host `com.kbj.chrome_app_tabs` through Chrome Native Messaging.
  The host manifest allows exactly one extension ID (`bahmlmpijalpgcnbnkgplggendgjhdlk`).
- The host runs with the current user's normal rights. It is installed per user under `%LOCALAPPDATA%` and registered under `HKCU`;
  no administrator rights and no system-wide changes.
- The host only moves, resizes, shows/hides, re-orders and focuses top-level windows of the current desktop. It does not inject code,
  read other processes' memory, re-parent windows or terminate programs.
- `manifest.json` contains the extension's **public** key, which only fixes the extension ID. No private signing key exists in this repository.
- Release ZIPs ship a `SHA256SUMS.txt` that the installer verifies, and a `.sha256` file for the whole ZIP on the release page.
  The files are not code-signed.
