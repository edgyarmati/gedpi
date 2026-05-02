---
name: verify
description: Run the full quality gate for GedPi — type-check then test suite. Use before committing or after significant changes.
---

Run the full quality gate:

```bash
npm run check && npm run lint && npm test
```

Report any type errors, lint errors, or test failures. If all pass, the codebase is ready to commit.
