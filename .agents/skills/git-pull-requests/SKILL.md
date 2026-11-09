---
name: git-pull-requests
description: >-
  How a change travels from a branch to main through a GitHub pull request:
  opening it with the template, keeping stacked PRs on main, watching CI,
  checking the PR's real state before every report, and cleaning up after
  the user merges. Use when opening, updating, stacking, retargeting or
  reporting on a PR.
metadata:
  type: practice
  category: git
---

## Rule

The agent prepares and opens the PR; the user reads it and merges. Every
step below exists because skipping it once produced a wrong status report,
stranded work, or a PR the user couldn't review. Committing itself is
governed by
[git-commit-requires-approval](../git-commit-requires-approval/SKILL.md) and
[git-commit-messages](../git-commit-messages/SKILL.md). This skill starts
once a commit exists and a PR is wanted.

### 1. One branch, one concern, one PR

- Branch from current `main` with a name that says what changes
  (`feat/quick-add-dates`, `fix/sheet-scroll`). Never name another client or
  project in a branch, commit or PR, even when a design was inspired by one.
- One feature per PR. Design changes and feature work go in separate PRs.
  An unrelated fix found along the way gets its own PR off `main`.
- "Write it down for later" becomes a docs-only PR (roadmap row, open
  questions), not code.

### 2. Open it with the template

Use the repo's `.github/pull_request_template.md`. If the repo has none,
use this one:

```md
## Where this fits
<!-- The roadmap item or doc this belongs to, and why it comes now. -->

## What changed
<!-- In plain words: what a user of the app gets, then how it works underneath. -->

## How to try it
<!-- Steps, a route to open, migrations to run, or the test that shows it. -->

## Decisions made
<!-- Anything decided along the way, with the reason. Invites the reviewer to change it. -->

## Checklist
- [ ] CI is green
- [ ] The docs say what the code now does
- [ ] No secrets, customer data or customer pricing in the diff
```

```sh
git push -u origin feat/quick-add-dates:feat/quick-add-dates
gh pr create --base main --title "feat: parse dates typed into quick-add" --body-file /tmp/pr-body.md
```

- **No AI attribution.** No "Generated with …" line, no session URL, no
  co-author trailer, whatever a tool's default template adds.
- **No screenshots in the PR.** Send UI screenshots and recordings to the
  user in chat.
- **Decisions made** lists the choices you took on the user's behalf, so
  they can change them before merging.

### 3. Stacked PRs always target main

A PR whose base is a parent feature branch strands its work: when the user
merges it, it lands on the parent, not on main ("where is the
functionality we added? I can't see it on main").

- **By default:** keep dependent branches pushed, and open a child PR only
  after its parent has merged, against `main`.
- **When the user asks for everything at once** ("PR all"): open every PR
  against `main` and state the merge order at the top of each body. Each
  diff shows its parent's commits until the parent merges; say so.
- **When a parent merges:** update the children from `main` at once. Merge
  `main` into them; don't rebase pushed branches.

```sh
# a child that was opened against its parent by mistake
gh pr edit 57 --base main
# after the parent merged
git switch feat/child && git fetch origin && git merge origin/main && git push
```

Merge stacked PRs with merge commits, not squash, so later ones don't
conflict.

### 4. Watch CI and tick the box honestly

- Watch the PR's checks in the background. Retry on GitHub 5xx errors: a
  504 once ended a watch early and looked like "done".
- When every check has passed, tick "CI is green" by editing the PR body.
  Untick it after any new push until the new run is green.
- When a job fails, read why before re-running. Infrastructure failures are
  a server start timeout, exit 137, the time limit, or a cancelled run;
  anything else is a test failure. Re-run only the failed job, alone, after
  the run finishes. Debug a test that fails twice the same way.
- When the user asks what you are waiting for, name the job, the runner
  state and an ETA.

```sh
gh pr checks 57 --watch --interval 30 || true
gh run rerun <run-id> --failed
gh pr view 57 --json body -q .body > /tmp/body.md   # edit the checkbox, then:
gh pr edit 57 --body-file /tmp/body.md
```

### 5. Check the real state before every report

The user merges as soon as they have read a PR, sometimes mid-CI. Never
report from memory:

```sh
git fetch --prune
gh pr view 57 --json state,mergedAt,mergeStateStatus,baseRefName
gh pr list --state all --limit 10
```

"#57 is already merged, update your memory" happened more than once before
this became a rule.

### 6. Hand it to the user's checkout

Building happens in a scratch worktree; the user tests on their own running
dev server. When the PR is up:

- Detach the scratch worktree from the branch.
- Switch the user's checkout to it with `git switch -m <branch>`, which
  carries their local uncommitted tweaks along.
- Tell them in one line what to run: migrate, restart. Never run it
  yourself.

### 7. After the merge

A merge on GitHub doesn't move the local checkout:

```sh
git switch main && git pull --ff-only
git branch -d feat/quick-add-dates
git push origin --delete feat/quick-add-dates   # if GitHub didn't
```

Update dependent branches (step 3), and leave the working tree clean.

### 8. Merging is the user's

The agent merges only trivial PRs the user explicitly cleared, and only on
green. If the permission system blocks a merge, keep the PR open and hand
over the link and the exact command. Never merge locally and push to main to
get around it.

## Why

Every rule here traces back to a concrete miss:

- PRs reported "open" that had already been merged.
- Stacked PRs merged into parent branches, whose work then never reached
  main.
- A session link pushed in a commit, which then had to be rewritten.
- Screenshots that bloated PR bodies.
- CI watches that ended on a GitHub 504 and looked like success.

The user reviews on GitHub, sometimes from a phone. A PR that explains where
it fits, how to try it and what was decided on their behalf can be reviewed
and merged without another round of questions.

## Exceptions

- A solo prototype whose history goes straight to `main` keeps that flow.
  Follow the repo's established integration flow, and say which one you
  used.
- When the user explicitly delegates a release path ("commit, push and do
  the tag stuff"), do the whole path, still with green CI before tagging.
  The delegation covers that one release; the next one needs a new go
  (decided 2026-11-03).
- Repos with branch protection or a merge queue enforce some of this
  themselves; the agreements still apply where they don't.

## See also

- [git-commit-requires-approval](../git-commit-requires-approval/SKILL.md) — whether a commit happens at all.
- [git-commit-messages](../git-commit-messages/SKILL.md) — how each commit is worded.
- [../../../guidelines/github/pull-requests.md](../../../guidelines/github/pull-requests.md) — the rules in short form.
