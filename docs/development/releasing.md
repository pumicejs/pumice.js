# Releasing

npm releases are cut from main by a tag; GitHub Actions publishes. Nothing is published from a
laptop. (From the playbook's `guidelines/ci-cd/releases.md`.)

## Steps

1. **main is green.** Every change is merged and CI passed on main.
2. **Bump the version** on a branch, in its own commit, and merge it like any PR:

   ```sh
   npm version <patch|minor> --no-git-tag-version   # 0.x: minor for breaking or notable changes
   git commit -am "chore(release): v$(node -p 'require("./package.json").version')"
   ```

3. **Tag main** once the bump is merged and main's CI is green:

   ```sh
   git switch main && git pull
   v="v$(node -p 'require("./package.json").version')"
   git tag -a "$v" -m "pumice.js $v"
   git push origin "$v"
   ```

4. **The Release workflow** (`.github/workflows/release.yml`) checks that the tag matches
   `package.json` and is on main, runs `npm run check` and the audit again, publishes with
   `npm publish --provenance --access public` through npm trusted publishing, and creates the
   GitHub release with generated notes.
5. **Verify** in a temp directory that the published version installs and imports:

   ```sh
   cd "$(mktemp -d)" && npm init -y >/dev/null && npm i pumice.js@latest zod hono
   node --input-type=module -e 'import("pumice.js").then((m) => console.log(Object.keys(m).length, "exports"))'
   npm view pumice.js@latest dist.attestations
   ```

If a manifest change is in the release, say in the notes what the client and docs packages need
([contract.md](contract.md)).

If a safety check blocks an agent from pushing a tag, it stops and hands over the command
above; it doesn't try another way.

## One-time setup (the user's, on npmjs.com)

Trusted publishing replaces a stored `NPM_TOKEN`: npm trusts this repository's workflow through
GitHub's OIDC.

1. npmjs.com → the `pumice.js` package → **Settings** → **Trusted Publisher** → **GitHub
   Actions**.
2. Organization or user: `pumicejs`; repository: `pumice.js`; workflow filename: `release.yml`;
   environment: leave empty; tick **Allow npm publish**.
3. Save. Optionally, under **Publishing access**, require two-factor authentication and
   disallow tokens, so only the workflow can publish.

**Allow npm publish** must be ticked on the trusted publisher. Configurations created after
3 September 2026 allow only `npm stage publish` by default, and the workflow runs a plain
`npm publish`, so without the box the publish fails with `E403 … OIDC permission denied for
this action` (it did for v0.1.0). The workflow doesn't need **Allow npm dist-tag**.

A new trusted publisher must complete its first successful publish within 2 days, or it
expires and has to be deleted and created again. After a publish, the registry can take a
minute or two before `npm install` sees the new version.
(Staged publishing, where each version waits for a maintainer's 2FA approval, is
deliberately not used; see the roadmap.)

Provenance needs a public repository (pumice.js is). The workflow needs npm 11.5.1 or later,
which Node 24 brings; it checks before publishing.
