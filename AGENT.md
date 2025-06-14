# Bloop Agent Guide

## Commands

- `pnpm dev` - Start full development environment (backend + frontend)
- `pnpm build` - Build both frontend and backend for production
- `pnpm frontend:dev` - Start frontend only (Vite dev server on :3000)
- `pnpm backend:dev` - Start backend only with hot reload (cargo-watch on :3001)
- `pnpm backend:run` - Run backend without hot reload
- `cd frontend && npm run lint` - Run ESLint on frontend
- `cargo check --manifest-path backend/Cargo.toml` - Check backend
- `cargo test --manifest-path backend/Cargo.toml` - Run backend tests
- `cd frontend && npm test` - Run frontend tests (if configured)

## Architecture

- **Full-stack Rust + React monorepo** with pnpm workspace
- **Backend**: Rust/Axum API server (port 3001) with Tokio async runtime
- **Frontend**: React 18 + TypeScript + Vite (port 3000) with shadcn/ui components
- **Shared**: Common TypeScript types in `/shared/types.ts`
- **API**: REST endpoints at `/api/*` proxied from frontend to backend in dev

## Code Style

- **Rust**: Standard rustfmt, snake_case, derive Debug/Serialize/Deserialize
- **TypeScript**: Strict mode, @/ path aliases, interfaces over types
- **React**: Functional components, hooks, Tailwind classes
- **Imports**: Workspace deps, @/ aliases for frontend, absolute imports
- **Naming**: PascalCase components, camelCase vars, kebab-case files

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

# Managing Shared Types Between Rust and TypeScript

ts-rs allows you to derive TypeScript types from Rust structs/enums. By annotating your Rust types with #[derive(TS)] and related macros, ts-rs will generate .ts declaration files for those types.
When making changes to the types, you can regenerate them using `npm run generate-types`
Do not manually edit shared/types.ts
