# openteams

`openteams` is a zero-build NPX launcher.

It **does not compile source code** on the user's machine.
Instead, it downloads prebuilt binaries from object storage (OSS preferred, R2 fallback), verifies checksum, extracts, installs, and runs.

## Behavior

When you run:

```bash
npx openteams
```

the CLI does:

1. Detect current platform/arch
2. Download prebuilt `openteams.zip` from configured object storage
3. Verify SHA256 from manifest
4. Extract to `~/.openteams/bin`
5. Add `~/.openteams/bin` to PATH (current process + persistent profile)
6. Launch binary immediately

## Commands

- `npx openteams` - install (if needed) + run
- `npx openteams install` - install only
- `npx openteams start [args]` - run binary
- `npx openteams update` - force re-download + reinstall
- `npx openteams status` - show install status
- `npx openteams uninstall` - remove `~/.openteams`
- `npx openteams --help`

Pass-through args example:

```bash
npx openteams -- --port 54321
npx openteams start --port 54321
```

## Binary Source

Release workflow injects these values into `bin/download.js` during `npm pack`:

- `__OSS_PUBLIC_URL__` (when OSS is enabled)
- `__R2_PUBLIC_URL__`
- `__BINARY_TAG__`

Runtime fetches:

- `${BASE_URL}/binaries/${BINARY_TAG}/manifest.json`
- `${BASE_URL}/binaries/${BINARY_TAG}/${platform}/openteams.zip`

Global latest version check uses:

- `${BASE_URL}/binaries/manifest.json`

Source selection order:

1. `OPENTEAMS_OSS_BASE_URL`
2. Injected `__OSS_PUBLIC_URL__`
3. `OPENTEAMS_R2_BASE_URL`
4. Injected `__R2_PUBLIC_URL__`

## Installation Paths

- Install root: `~/.openteams`
- Binary: `~/.openteams/bin/openteams` (or `.exe` on Windows)
- Cache: `~/.openteams/cache/<tag>/<platform>/`
- Metadata: `~/.openteams/install.json`

## Local Dev Mode

If `openteams-npx/dist/` exists (or `OPENTEAMS_LOCAL=1`), CLI reads binaries from local `dist` instead of remote object storage.

You can also override runtime source manually:

- `OPENTEAMS_OSS_BASE_URL`
- `OPENTEAMS_R2_BASE_URL`
- `OPENTEAMS_BINARY_TAG`

## Requirements

- Node.js >= 18
- Network access to configured OSS/R2 public URL

No Rust/Git/build toolchain is required for end users.
