# Custom fork releases

The fork keeps the local notebook execution and sidebar sorting additions on
`custom/main`. Feature branches start there. Preserve a known working release
before changing the installed application.

## Recovery point

`safety/baseline-2026-10-22` identifies the source before project collections and
thread tabs. Its GitHub release contains the matching server recovery bundle.
The baseline server SHA256 is
`c4629b87ae0d8d63f2bdac807922011a8e8b51a0deda1a4ea059d4b298d58305`.

To restore the installed features on Windows:

1. Download and extract the recovery bundle from that release.
2. Quit T3 Code completely.
3. Run `pwsh -NoProfile -File ./Restore-ForkServer.ps1` in the extracted folder.
4. Start T3 Code again.

The script checks the desktop shell and native dependency hashes, verifies the
archive, and saves the replaced server beside the installation. It refuses a
different desktop version. It does not restore conversations, projects, credentials,
or notebooks: those remain in their existing locations.

For a source checkout, first save any uncommitted work, then use
`git switch --detach safety/baseline-2026-10-22`. Use a new branch to continue from
that point; no force push or history reset is needed.

## New releases

Keep each feature in its own commits and run its focused tests and the affected
client typecheck/build. Build and test against an isolated T3 home. Never launch
a development server with the installed application's userdata directory.

Create a recovery bundle with `scripts/New-ForkRecovery.ps1` before installing a
new build. Attach its archive and manifest to the corresponding fork release.
Keep account settings, API keys, conversations, and local environment files out
of Git and release assets.

Official updates replace the custom server. Integrate an upstream version on a
separate branch, resolve conflicts, verify the retained features, and publish a
new matching desktop/server build. A recovery bundle from another desktop
version must not be installed over it.
