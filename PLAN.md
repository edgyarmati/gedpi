# GedPi Plan

This file is historical context from the earlier multi-agent design.

GedPi now uses a single conversational brain with bundled extensions. There are no separate planner/worker/expert roles.

Current source of truth:

- [README.md](README.md) — features, install, usage
- [CLAUDE.md](CLAUDE.md) — architecture and development guidance
- [src/brain.ts](src/brain.ts) — brain system prompt and `.ged/` initialization
- [extensions/ged-core/index.ts](extensions/ged-core/index.ts) — extension wiring
