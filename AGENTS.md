# AGENTS.md

This file defines repository-specific guidance for coding agents working in this project.

## Project overview

- Desktop application built with Tauri 2.
- Frontend: React 19, TypeScript, Vite, Tailwind CSS 4, Base UI, and shadcn.
- Backend/native layer: Rust under `src-tauri/`.
- JavaScript package manager: `pnpm` (the repository contains `pnpm-lock.yaml`).
- Primary development environment: Windows with PowerShell 7.

## Repository layout

- `src/`: React and TypeScript application code.
- `src/components/`: reusable UI and feature components.
- `src/lib/`: shared frontend utilities and Tauri API wrappers.
- `src-tauri/src/`: Rust application and Tauri command code.
- `src-tauri/migrations/`: database migrations, when present.
- `src-tauri/tauri.conf.json`: Tauri application configuration.
- `public/`: static frontend assets.

Keep frontend-only logic in `src/`. Put privileged filesystem, database, workbook-processing, or operating-system work in Rust and expose it through narrow Tauri commands.

## Setup and common commands

Use the existing package manager and lockfile. Do not introduce npm or Yarn lockfiles.

```powershell
pnpm install
pnpm dev
pnpm build
pnpm tauri dev
pnpm tauri build
```

For Rust-only checks:

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

The repository currently has no dedicated frontend `test` or `lint` script. Do not claim those checks passed unless such scripts are added and run.

## Working conventions

- Inspect nearby code before editing and follow its established patterns.
- Keep changes focused on the requested task; do not refactor unrelated code.
- Never render browser-native interactive form controls directly in application code, including raw `button`, `input`, `select`, `textarea`, checkbox, radio, or dialog elements. Use or extend the components in `src/components/ui/` instead.
- Treat user-provided implementation and design guidance as internal product constraints, not UI copy. Do not restate those instructions as helper text, descriptions, banners, tooltips, or placeholders unless the user explicitly requests that wording in the interface.
- Prefer self-explanatory layout, familiar controls, clear labels, sensible defaults, and immediate feedback so users understand the interface naturally without instructional copy.
- Prefer small, typed React components and explicit TypeScript types at module boundaries.
- Avoid `any`. If external data is untrusted, validate or narrow it before use.
- Keep state as local as practical. Derive values instead of duplicating state.
- Reuse existing UI primitives and utilities before adding new dependencies or components.
- Preserve the current visual language unless the task explicitly requests a redesign.
- Use accessible labels, keyboard behavior, focus states, and semantic HTML.
- Keep Tauri commands narrow, validate all arguments in Rust, and return useful errors.
- Never expose secrets, unrestricted filesystem access, or shell execution to the frontend.
- Avoid blocking work on the Tauri async runtime; move CPU-heavy or blocking I/O work to an appropriate blocking task.
- Use `serde` types for the frontend/backend contract and keep field naming consistent across the boundary.

## Search and inspection

On Windows, use PowerShell 7 and the installed modern CLI tools:

- `rg` for content search.
- `fd` for file discovery.
- `sg` for structural code search.
- `bat --paging=never` for reading files.
- `jq` or `yq` for structured data.

Scope searches to relevant directories and respect ignore files. Do not search generated directories such as `node_modules`, `dist`, or `src-tauri/target` unless necessary.

## Editing rules

- Preserve the repository's existing line endings and formatting.
- Do not edit generated artifacts or dependency lockfiles unless the task requires it.
- If dependencies change, update `package.json` and `pnpm-lock.yaml` together.
- If Rust dependencies change, update `src-tauri/Cargo.toml` and its lockfile together.
- Database schema changes must be additive migrations; do not rewrite migrations that may already have been applied.
- Do not delete or overwrite user work. Check for existing changes before touching overlapping files.

## Verification

Run the narrowest relevant checks first, then broaden according to the change:

- Frontend TypeScript/UI changes: `pnpm build`.
- Rust changes: `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, followed by targeted tests or `cargo test`.
- Cross-boundary Tauri changes: verify both `pnpm build` and Rust checks.
- Configuration or packaging changes: run the relevant Tauri build when practical.

When a full check cannot be run, report exactly what was verified and what remains unverified.

## Git safety

- Do not commit, push, create branches, or open pull requests unless explicitly requested.
- Do not use destructive commands such as `git reset --hard` or discard unrelated changes.
- Review the final diff for accidental formatting churn, generated files, secrets, and unrelated edits.

## Communication

In the final handoff:

- Lead with the completed outcome.
- List the important files changed.
- State the checks run and their results.
- Call out remaining risks, assumptions, or follow-up work concisely.
