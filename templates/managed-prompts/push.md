---
description: Push the current branch; only involve the model if push fails
thinking: high
run:
  command: git
  args:
    - push
  shell: false
handoff: on-failure
timeout: 120000
---
The initial `git push` failed.

Your job:
- diagnose exactly why the push failed
- make the minimum safe changes needed to fix the problem
- if the fix requires local commits, create them with clear conventional commit messages
- retry `git push`
- continue until the branch is pushed successfully, or stop only if the issue cannot be resolved safely from inside the repo

Rules:
- prefer fixing local repository issues first
- do not rewrite history unless it is clearly necessary and safe
- do not use force-push unless there is a strong explicit reason from the repo state
- explain the root cause and what you changed before the final push result

When done, report:
- whether push succeeded
- the root cause
- any commits or fixes you made
