# hire-me-mono

[![CI](https://github.com/rjmcgee53192/hire-me-mono/actions/workflows/ci.yml/badge.svg)](https://github.com/rjmcgee53192/hire-me-mono/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Stack](https://img.shields.io/badge/stack-Next.js%2015%20%E2%80%A2%20React%2019%20%E2%80%A2%20TypeScript%20strict%20%E2%80%A2%20Tailwind%20v4-blue)

A recruiter-grade monorepo by **Ryan McGee**, Senior Full-Stack Software
Engineer. Five production-quality builds, each one a **live interactive demo**
backed by its own tested package — real-time systems, data-heavy dashboards,
and infrastructure tooling. No mockups, no screenshots: click through and break
things.

## Projects

| Project | One-liner | Live demo | Package |
|---|---|---|---|
| Astra Telemetry | Mission-control dashboard streaming live rocket telemetry. | [/demos/astra](/demos/astra) | `packages/astra-core` |
| Volt Fleet | EV fleet operations with cost-optimized smart charging. | [/demos/volt](/demos/volt) | `packages/volt-core` |
| TensorGrid | GPU cluster observability for ML training workloads. | [/demos/tensorgrid](/demos/tensorgrid) | `packages/tensorgrid-core` |
| Pulse | Realtime collaborative whiteboard with CRDT conflict resolution. | [/demos/pulse](/demos/pulse) | `packages/pulse-core` |
| TraceLens | API observability with synthetic load generation. | [/demos/tracelens](/demos/tracelens) | `packages/tracelens-core` |

## Architecture

```
hire-me-mono/
├── apps/
│   └── showcase/              # Next.js 15 app — landing page + /demos/* routes
│       ├── app/
│       │   ├── page.tsx       # landing (hero, project grid, toolbox)
│       │   └── demos/<slug>/  # one interactive demo per project package
│       └── lib/projects.ts    # single source of truth for the project catalog
├── packages/
│   ├── ui/                    # @repo/ui — shared dark-mode design system
│   │                          # (Button, Card, charts, controls — canvas-based)
│   ├── astra-core/            # rocket telemetry sim + pipeline
│   ├── volt-core/             # fleet scheduling & charging optimization
│   ├── tensorgrid-core/       # GPU cluster model + scheduling theory
│   ├── pulse-core/            # CRDT ops engine + presence model
│   └── tracelens-core/        # load generator + streaming stats
├── turbo.json                 # build/test/lint/typecheck pipeline
├── tsconfig.base.json         # strict TS config shared by every package
└── .github/workflows/ci.yml   # typecheck → lint → test → build on every push

Each demo route renders against its package's public API; the UI package owns
every shared component so the demos stay visually consistent.
```

## How to run

```bash
pnpm install
pnpm dev        # turbo runs every package in dev mode
pnpm test       # turbo runs the test pipeline
pnpm typecheck  # strict TypeScript across the whole tree
pnpm build      # production build
```

Requirements: Node 20+, pnpm 10+.

## Repo

https://github.com/rjmcgee53192/hire-me-mono
