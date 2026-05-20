---
description: Clarify ambiguous non-trivial tasks one question at a time before planning
thinking: high
---

Start a GedPi grill-me clarification session for the current request.

First declare one of these exact forms:

- `grill-me: needed` — then ask exactly one unresolved question and include `Recommended answer:` or `Default assumption:`.
- `grill-me: skipped; reason: <why the request is already sufficient>` — then synthesize goal, users/audience, scope, constraints, and success criteria.

Rules:

- Ask one question per turn and wait for the answer.
- If code or `.ged/` memory can answer the question, inspect that instead of asking.
- Stop once behavior, constraints, and success criteria are concrete enough to plan safely.
- For terminology, glossary, domain-model, CONTEXT.md, or ADR-heavy clarification, use `grill-with-docs` instead of plain `grill-me`.
- Do not implement during grilling.

When clarification is done or explicitly skipped as sufficient, record an auditable clarification checkpoint in `.ged/runtime/<work-id>/checkpoints.json` before planning non-trivial work. For a skip, use:

```json
"clarification": {
  "status": "skipped",
  "source": "manual",
  "timestamp": "<ISO timestamp>",
  "sufficiency": "sufficient-from-request",
  "skipReason": "<why no question was needed>"
}
```
