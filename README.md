# Mission Control

Orchestration and visualisation over multiple coding agents.

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

1. Install Postgres

2. Configure .env (see template in backend/.env.example)

3. Install dependencies

```bash
# Install dependencies
npm install
```

### Development

```bash
# Run both frontend and backend in development mode
npm dev
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

## Adding shadcn/ui Components

```bash
cd frontend
npx shadcn-ui@latest add button
npx shadcn-ui@latest add card
# etc.
```
