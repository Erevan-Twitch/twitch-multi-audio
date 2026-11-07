# twitch-multi-audio

Before starting, read [docs/sessions/HANDOFF.md](docs/sessions/HANDOFF.md): current state, next task, and how the user works. The plan and its decisions are in [docs/roadmap.md](docs/roadmap.md).

Key rules (details in the handoff):
- Never run automated browser tests; write manual test cases in `apps/extension/test/cases/` instead.
- Commit, push or open PRs only when asked.
- Plain Chrome APIs, no extension framework. TypeScript, pnpm (Corepack), Turbo.
- Verify changes with `pnpm typecheck` and `pnpm build`.
- Keep HANDOFF.md up to date at the end of a session.
