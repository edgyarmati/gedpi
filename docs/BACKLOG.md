# Backlog

This file is historical context from the earlier multi-agent design. Until a refreshed backlog is written, treat it as archival.

Current direction:

- Improve the single-brain interview and implementation flow
- Keep `.ged/` documentation current and compact
- Expand the bundled extension set for a better out-of-the-box experience
- Keep the package install and publish workflow clean

## Repo Map roadmap

Shipped core:

- runtime repo-map cache under `.pi/repo-map/`
- incremental discovery/index refresh for supported source files
- TypeScript/JavaScript symbol + import extraction with graceful fallback
- graph-plus-activity ranking and prompt rendering in Ged mode

Deferred follow-up work:

- semantic symbol summaries
- git co-change ranking signals
- richer graph proximity and blast-radius refinements
- dead-code / unused-export analysis
- clone-detection or other secondary analysis views
- broader parser and language coverage where it materially improves results

## Orchestration roadmap from Pi 0.78 / pi-subagents 0.28

Deferred follow-up work:

- structured verifier/checkpoint evidence with compact artifact pointers
- structured planner/explorer outputs using `outputSchema` and named chain outputs
- parallel `ged-explorer` agents for disjoint read-only reconnaissance scopes
- dynamic fanout from a structured exploration-scope step once checkpoint coverage can track multiple scopes
- prompt-context dedupe using `ctx.getSystemPromptOptions()` where the Pi API is available
