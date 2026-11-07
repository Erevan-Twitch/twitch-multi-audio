# twitch-multi-audio

Aggregate several browser audio sources into a single virtual audio device captured by OBS, pick which one is playing, and show the current title / artist / cover on stream.

## Layout

| Path | Package | Role |
| --- | --- | --- |
| `apps/extension` | `@tma/extension` | Browser extension: captures tab audio + now-playing metadata, streams them to the server |
| `apps/server` | `@tma/server` | Local WebSocket server: receives sources, selects the active one, feeds the virtual audio device |
| `packages/shared` | `@tma/shared` | Protocol types and constants shared by apps |
| `packages/tsconfig` | `@tma/tsconfig` | Shared TypeScript configs |

Planned later: Stream Deck plugin, web control UI. See [docs/roadmap.md](docs/roadmap.md) for the current plan.

## Requirements

- Node.js 24 (see `.nvmrc`)
- pnpm via Corepack: `corepack enable pnpm`

## Commands

```sh
pnpm install
pnpm dev         # run all apps in watch mode
pnpm build       # build everything (Turbo, cached)
pnpm typecheck
pnpm --filter @tma/server dev   # run a single app
```

## Loading the extension in Chrome

The extension uses plain Manifest V3 and Chrome APIs (no framework); esbuild only bundles the TypeScript.

1. `pnpm --filter @tma/extension dev` (or `build`) → outputs `apps/extension/dist/`
2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and select `apps/extension/dist`
3. Click the extension's toolbar icon to open the side panel
4. After code changes, click the reload icon on the extension card (and reopen the panel)
