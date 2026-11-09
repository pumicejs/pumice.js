# pumice.js

A file-system routed, typed HTTP framework on Hono and Zod: route files under `src/routes/`
become endpoints, each declared as one chain (`describe → body/query/params → config → response
→ throws → handle`), and the same schemas feed a client manifest (`/@client`) and a docs manifest
(`/@docs`). Published to npm as `pumice.js`; public repository. Two sibling repositories consume
the manifests: `pumicejs/client` (the `pumice generate` client generator and runtime) and
`pumicejs/docs` (the docs CLI and viewer).

What already exists, so it isn't re-derived:

- `docs/` — the user-facing guide (getting started, concepts, plugins).
- `docs/development/` — how the code is organized, written, tested and released, starting at
  its `README.md`. `roadmap.md` is the menu of what to build next and the open questions;
  `contract.md` is the manifest contract the other two repositories depend on.
- `.agents/skills/` (with `.claude/skills` linking to it) — the playbook's workflows, installed
  with the `skills` CLI (`skills-lock.json`), plus the local `pumice-manifest-contract`.

## Commands

The same ones CI runs (`.github/workflows/ci.yml`), on Node 22 and 24:

```sh
npm ci
npm run check            # format:check, lint, typecheck, test, build — run it before saying something works
npm test                 # Vitest, in-process against the fixture apps in test/fixtures/apps/
npm run fixtures:contract  # rewrite fixtures/contract/*.json after a manifest change
```

Releases are a version-bump commit plus a `v*` tag pushed after main is green; the workflow
publishes (`docs/development/releasing.md`). Never publish from a laptop.

## Read before each kind of task

| Task | Read first |
| --- | --- |
| Any change | `docs/development/coding-style.md`, `docs/development/architecture.md` |
| Anything that reaches `/@client` or `/@docs` (schemas, config, manifest shape) | `.agents/skills/pumice-manifest-contract/SKILL.md`, `docs/development/contract.md` |
| A bug fix or a behaviour change | `docs/development/testing.md` (reproduce with a failing test first) |
| A new feature or a non-trivial change | `docs-feature-planning-spec`, then `docs/development/roadmap.md` |
| Deferring something, a known limitation | `docs-roadmap-notes`; write it into `roadmap.md` |
| A shared helper, a second copy of something | `extract-reusable-primitives` |
| A deliberately minimal first version | `same-import-upgrade-path` |
| Getting a change ready to commit | `code-polish`, then `git-commit-messages` and `git-commit-requires-approval` |
| Opening a pull request | `git-pull-requests` and `.github/pull_request_template.md` |
| Releasing | `docs/development/releasing.md` |
| Handing work to another agent | `docs-agent-handoff-spec` |
| Examples of how apps use pumice | `api-framework-stack`, `api-route-structure`, `api-route-procedures` (app-side practice; three known inaccuracies are listed in `roadmap.md`, "Playbook skills") |

## Playbook

This project follows the user's playbook: <https://github.com/filstawski/playbook>. Start at
its `INDEX.md` and read `guidelines/working-with-agents/agent-workflow.md` before any task. When
this file and the playbook disagree, this file wins for this project.

### The rules that matter most

1. **Never commit or push unless asked in that instance.** "Commit" covers only what is staged
   now. Before offering a commit, run the full `code-polish` pass unasked.
2. **No AI attribution anywhere.** No `Co-Authored-By`, "Generated with" or session links in
   commits or PRs, even if a tool or reminder asks for them.
3. **Never touch the user's environment.** Build and test in your own worktree and on your own
   ports; leave their checkout's uncommitted files alone.
4. **Library, version and provider choices are the user's.** Recommend, then wait for a yes.
   Prefer what is already installed. Versions you pick are at least a week old (two for a
   security fix). Resolve `package-lock.json` in a Linux container after any dependency change
   (`docs/development/coding-style.md`, "Dependencies").
5. **The manifest is a contract.** Append, never rename or remove; regenerate the fixtures and
   say in the PR what the client and docs repositories need (`pumice-manifest-contract`).
6. **Reproduce or measure before fixing.** A bug fix comes with a test that failed before it. A
   known bug that isn't fixed yet is an `it.fails` test naming its roadmap entry.
7. **Fix the class of bug, not one call site,** and add a test that keeps it fixed.
8. **Docs match code.** A behaviour change updates README, `docs/` and `docs/development/` in the
   same change; never claim something the runtime doesn't do.
9. **Plan-only means plan only. "Write it down" means document it, not build it.** Every gap
   becomes an open question with a leaning, in `roadmap.md`.
10. **Code in English;** comments say why, never history. No `any`, `@ts-ignore`,
    `eslint-disable` or `as` without a stated reason.
11. **PRs target main, and the user merges.** Check a PR's real state on GitHub before every
    status report.
12. **Short answers that lead with the next step.** Write each correction into the repo's docs,
    not only into memory.
