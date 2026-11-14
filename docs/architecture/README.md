# Architecture (LikeC4)

The architecture as code, written in [LikeC4](https://likec4.dev). The diagrams are generated from these files.

```
pnpm arch            # interactive diagrams with live reload, http://localhost:5173
pnpm arch:validate   # check the files
```

## Files

| File | Content |
| --- | --- |
| `specification.c4` | The vocabulary used by the other files. Element kinds. Relationship kinds: `audio` (green), `control` (amber, dashed: requests and commands), `state` (indigo, dotted: broadcasts). Status tags: `#built`, `#spike`, `#planned`. |
| `model.c4` | The **target architecture**. The local server is the mixer and the only control center. The extension, and later a native desktop helper, provide sources. The side panel, Stream Deck plugin and web UI are controllers. An overlay shows the track on stream. |
| `spike.c4` | The **test B spike**, as coded on `spike/server-mix`, file by file. |
| `views-target.c4` | Target views: 1. overview, 2. containers, 3a/3b. components of the extension and the server, 4. build status, 5a–5e. main flows. |
| `views-spike.c4` | Spike views: overview, extension side, server side, two flows. |
| `deployment.c4` | Where each part runs: the target and the spike. |

In the target views, a dashed border marks what's planned and a solid border what's built. Click an element to open its own view. Elements link to their code.

## Keeping it current

- When a spike result or a decision changes the plan, update `model.c4`, and the roadmap with it.
- When version 2 code lands, change its components from `#planned` to `#built`.
- The spike files go away with the spike branch.
