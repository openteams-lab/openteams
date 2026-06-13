# openteams frontend

规范化的 Vite + React + TypeScript 前端项目。

## Run Locally

**Prerequisites:** Node.js 22+ and pnpm 10+

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Run the app:

   ```bash
   pnpm dev
   ```

3. Build for production:

   ```bash
   pnpm build
   ```

## Project Structure

- `src/components`: UI workspaces and dialogs
- `src/context`: shared React context and state orchestration
- `src/data.ts`: demo seed data
- `src/i18n.ts`: locale dictionary aggregation from `src/locales/<locale>/`
- `src/types.ts`: shared TypeScript models
