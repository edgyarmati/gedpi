# Repo Map Design

Date: 2026-04-19
Status: proposed

## Summary

Add a SoulForge-style repo map to GedPi so the agent gets better codebase awareness from a ranked, context-adaptive graph of files and symbols instead of relying only on flat file listings and ad hoc reads.

The product direction targets broad SoulForge-style parity over time, but the delivery shape is hybrid:
- ship a core repo map first
- design the architecture so semantic summaries, git co-change, and secondary analysis features can plug in later without a rewrite

The shipped feature must be documented clearly in the README, and deferred parity work must remain visible in future-facing TODO/docs.

## Goals

- Build a primary codebase-awareness mechanism for GedPi
- Index source files incrementally while respecting `.gitignore`
- Extract file- and symbol-level structure useful for ranking and prompt rendering
- Rank files using both structural importance and current-turn context
- Render a compact repo-map block into Ged's prompt within a bounded token budget
- Refresh affected files after edits without rescanning the whole repository

## Non-Goals for the First Ship

- Full guaranteed parity with every SoulForge analysis feature on day one
- Blocking session startup on a complete repo scan in large repositories
- Treating repo-map cache data as durable `.ged/` memory
- Hiding deferred work; roadmap items should stay documented

## User Value

Primary users are developers using GedPi on medium-to-large codebases who want the agent to understand project structure faster and choose better context. Secondary users are maintainers extending GedPi's prompt/context pipeline and users working in repositories where dependency relationships and blast radius matter.

## Architecture

The repo map should be implemented as a dedicated subsystem in `src/` with clear boundaries rather than as prompt-specific glue.

### Modules

1. **Repo-map contracts/config**
   - types for files, symbols, edges, ranking signals, renderable entries, freshness state, and cache schema versioning
2. **Indexer**
   - walks the repository, respects `.gitignore`, detects eligible files, extracts symbols/imports/references, and produces normalized records
3. **Store**
   - persists repo-map state under `.pi/` as runtime cache data, not `.ged/`
   - stores indexed files, symbols, edges, rank metadata, schema versions, and freshness/dirty state
4. **Ranker**
   - computes stable base importance and applies current-turn personalization
5. **Renderer**
   - converts ranked entries into a compact prompt block under a configurable token budget
6. **Runtime/coordinator**
   - manages startup loading, partial refreshes, dirty-file handling, and lifecycle integration with Ged's agent hooks

### Integration Points

- `extensions/ged-core/index.ts`
  - load or warm repo-map state on startup
  - inject a rendered repo-map block into prompt assembly before agent start
- prompt/context code
  - treat repo-map output as an additional context block, not a replacement for `.ged/` context
- edit/read lifecycle hooks
  - mark touched files as recent and dirty so the next turn can boost and refresh them

## Storage

Repo-map data belongs under `.pi/` because it is runtime-local, derived, and regenerable.

Proposed storage area:
- `.pi/repo-map/manifest.json`
- `.pi/repo-map/index.sqlite` or equivalent persistent cache files

The store must support:
- schema/version invalidation
- fast lookup by file path
- efficient updates for changed files
- room for future pluggable datasets such as semantic summaries and git co-change links

## Indexing Flow

### Discovery

The indexer should:
- walk from the current working directory
- respect `.gitignore`
- skip generated/build/vendor/cache directories where appropriate
- prioritize source files in supported languages
- keep unsupported files visible at a shallow file level when useful, even if symbol extraction is unavailable

### Per-file indexed data

For each file, store:
- path
- fingerprint / mtime / size
- detected language
- exported symbols and signatures
- imports and reference candidates
- outgoing and incoming edges
- parser status / fallback status
- last indexed time

### Startup behavior

On session start:
1. load manifest/store state if present
2. determine whether the repo map is fresh, partially stale, or missing
3. make existing usable data available immediately when possible
4. kick off initial or partial indexing without unnecessarily blocking the session

### Incremental updates

Re-index a file when:
- its contents changed
- Ged edited it
- schema/parser versions changed
- nearby path/import resolution changes require edge repair

When one file changes:
- re-index that file
- update affected edges
- refresh impacted ranking state
- avoid rescanning unrelated files

## Ranking Design

Use a two-layer ranking model.

### Base score

Stable structural importance derived from the code graph, including:
- import/reference graph centrality
- blast radius / dependent count
- optional light weighting to avoid poor ranking from sparse or trivial nodes

### Turn personalization

Temporary boosts derived from current activity, including:
- files recently edited by Ged
- files recently read
- files explicitly mentioned by the user or agent
- graph neighbors of those files
- optionally active task context files when Ged workflow data makes that helpful

### Deferred pluggable ranking signals

These should be designed for later addition without ranker rewrites:
- git co-change
- semantic summary relevance
- dead-code / clone-analysis signals

## Prompt Rendering

The renderer should consume ranked intermediate data, not raw index output.

Each rendered file block should favor compact, high-signal output such as:
- file path
- blast radius / dependent count
- top exported symbols
- small state tags like `recently-edited`, `recently-read`, `mentioned`, or `new`

Rendering behavior:
- budget-aware rather than fixed-size
- show more orientation earlier in a conversation
- tighten later when active context is already established
- prefer breadth-first usefulness over spending too much space on one file
- drop lowest-value entries first

## Real-Time Update Behavior

After Ged edits a file, the runtime should immediately:
- mark that file hot for ranking
- mark index data dirty if needed
- refresh that file and affected graph neighbors on the next update cycle

This allows the next prompt to reflect the latest working set without a full rescan.

## Error Handling

Repo-map failures should degrade gracefully.

- Parser failure on one file must not fail the whole repo map
- Unsupported languages should fall back to shallow file presence where possible
- Missing or stale cache state should trigger rebuild behavior, not user-facing breakage
- Ranking/rendering should tolerate partial index data
- Store/schema migration issues should invalidate and rebuild cache safely

## Testing

Testing should cover both core behavior and integration points.

### Core tests

- file discovery respects `.gitignore`
- changed files are re-indexed incrementally
- graph edges update correctly after edits/renames
- ranking reflects both base graph importance and turn-specific boosts
- renderer respects token budgets and ordering
- failure in one parser/file does not collapse the whole repo map

### Integration tests

- startup with no existing repo-map cache
- startup with partially fresh cache
- prompt assembly includes repo-map output when available
- post-edit flow updates ranking inputs for the next turn
- repo-map cache remains under `.pi/`, not `.ged/`

## Documentation

When the feature ships:
- README must explain what the repo map is, what it improves, and what the first shipped version includes
- implementation docs should explain storage location, lifecycle hooks, and extension points
- deferred parity work should remain visible in future-facing docs/TODO notes rather than being implied only in code

## Deferred TODOs / Roadmap

Keep these explicitly documented after the first ship:
- semantic symbol summaries
- git co-change ranking
- richer graph proximity signals
- clone-detection views
- dead-code / unused-export analysis
- broader language/parser coverage as needed

## Recommended Delivery Shape

Use a hybrid architecture:
- build a persistent graph-oriented core from day one
- ship the core repo-map feature first
- keep extension points clean so parity-oriented features plug in later with minimal churn

This balances immediate user value with long-term parity ambitions.
