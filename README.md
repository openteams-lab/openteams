# Bloop

A full-stack monorepo with Rust backend (Axum) and React/TypeScript frontend.

## Project Structure

```
bloop/
├── backend/               # Rust backend (Axum API)
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs
│       ├── routes/
│       └── models/
├── frontend/              # React + TypeScript app
│   ├── package.json
│   ├── vite.config.ts
│   ├── components.json    # shadcn/ui config
│   ├── tailwind.config.js
│   └── src/
│       ├── components/
│       │   └── ui/        # shadcn/ui components
│       ├── lib/
│       └── app/
├── shared/                # Shared types/schemas
│   └── types.ts
├── Cargo.toml             # Workspace configuration
├── pnpm-workspace.yaml    # pnpm workspace
└── package.json           # Root scripts
```

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [Node.js](https://nodejs.org/) (>=18)
- [pnpm](https://pnpm.io/) (>=8)

### Installation

```bash
# Install dependencies
pnpm install

# Install cargo-watch for backend development
cargo install cargo-watch
```

### Development

```bash
# Run both frontend and backend in development mode
pnpm dev

# Or run them separately:
pnpm backend:dev    # Runs on http://localhost:3001
pnpm frontend:dev   # Runs on http://localhost:3000
```

### Building

```bash
# Build both frontend and backend for production
pnpm build

# Or build them separately:
pnpm frontend:build
pnpm backend:build
```

## Tech Stack

### Backend
- **Rust** with **Axum** web framework
- **Tokio** async runtime
- **Tower** middleware
- **Serde** for JSON serialization

### Frontend
- **React 18** with **TypeScript**
- **Vite** for build tooling
- **Tailwind CSS** for styling
- **shadcn/ui** component library
- **Radix UI** primitives

## API Endpoints

- `GET /` - API root
- `GET /health` - Health check
- `GET /hello?name=<name>` - Hello endpoint
- `POST /echo` - Echo JSON payload

The frontend proxies `/api/*` requests to the backend during development.

## Development Scripts

- `pnpm dev` - Start both frontend and backend in development
- `pnpm build` - Build both for production
- `pnpm frontend:dev` - Start only frontend
- `pnpm backend:dev` - Start only backend with hot reload
- `pnpm backend:run` - Run backend without hot reload

## Adding shadcn/ui Components

```bash
cd frontend
npx shadcn-ui@latest add button
npx shadcn-ui@latest add card
# etc.
```
