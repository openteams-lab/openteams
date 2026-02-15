# agents-chatgroup

AI Coding Agents Chatgroup - A cross-platform installer and runner for the agents-chatgroup application.

## Quick Start

Run directly with npx (no pre-installation required):

```bash
npx agents-chatgroup
```

This will automatically:
1. Check system dependencies
2. Clone the source code from GitHub
3. Install dependencies
4. Build the project
5. Start the application

## Commands

| Command | Description |
|---------|-------------|
| `npx agents-chatgroup` | Install (if needed) and start |
| `npx agents-chatgroup install` | Install/update only |
| `npx agents-chatgroup start` | Start the application |
| `npx agents-chatgroup update` | Update to latest version |
| `npx agents-chatgroup status` | Show installation status |
| `npx agents-chatgroup uninstall` | Remove installation |
| `npx agents-chatgroup --help` | Show help message |

## Supported Platforms

| Platform | Architecture | Status |
|----------|--------------|--------|
| macOS    | Intel (x64)  | ✅     |
| macOS    | Apple Silicon (ARM64) | ✅ |
| Linux    | x64          | ✅     |
| Linux    | ARM64        | ✅     |
| Windows  | x64          | ✅     |
| Windows  | ARM64        | ✅     |

## Requirements

### Required
- **Node.js** 18 or higher
- **npm** (comes with Node.js)
- **Git** for cloning the source code

### Optional
- **Rust** (if building Rust components)

## How It Works

1. **First Run**: The CLI clones the source code from GitHub to `~/.agents-chatgroup/source/`
2. **Dependencies**: Automatically runs `npm install` for frontend and server
3. **Build**: Builds the frontend and any Rust components (if Rust is installed)
4. **Run**: Starts the application using the appropriate entry point

## Installation Directory

All files are stored in `~/.agents-chatgroup/`:

```
~/.agents-chatgroup/
├── source/      # Cloned source code
└── config/      # Configuration files
```

## User Experience

```
$ npx agents-chatgroup

  ╔═══════════════════════════════════════════════╗
  ║         🤖 Agents Chatgroup Installer         ║
  ╚═══════════════════════════════════════════════╝

  📍 Platform: macOS arm64
  📦 Version:  v1.0.0
  📂 Install:  /Users/you/.agents-chatgroup

  First time setup - installing agents-chatgroup...

  [1/4] Checking dependencies...

     Dependency  Version              Status
     ─────────────────────────────────────────
     Node.js     v20.10.0             ✓
     npm         v10.2.3              ✓
     Git         2.42.0               ✓
     Rust        1.75.0               ✓

  [2/4] Getting source code...
       Cloning repository...

  [3/4] Installing dependencies...
       Installing frontend dependencies...

  [4/4] Building project...
       Building frontend...

  ✅ Installation complete!

  🚀 Starting agents-chatgroup...
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AGENTS_CHATGROUP_DEBUG=1` | Enable debug output |

## Troubleshooting

### Git not found
Install Git from https://git-scm.com/downloads

### Node.js version too old
Update Node.js to version 18 or higher from https://nodejs.org/

### Build errors
- Ensure you have the required build tools installed
- On macOS: `xcode-select --install`
- On Linux: `sudo apt install build-essential`
- On Windows: Install Visual Studio Build Tools

## License

MIT

## Links

- [GitHub Repository](https://github.com/anthropics/agents-chatgroup)
- [Report Issues](https://github.com/anthropics/agents-chatgroup/issues)
