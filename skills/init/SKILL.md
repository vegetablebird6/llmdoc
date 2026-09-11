---
name: init
description: "Explicit bootstrap that creates an independent Knowledge Git and binds it to the source repository."
---

# /llmdoc:init

Use this command only when the source repository has no bound Knowledge Git yet.

Load the `llmdoc` skill before broad exploration. CLI commands below run as `npx -y @tokenroll/llmdoc <cmd>`.

## Authorization

An explicit `/llmdoc:init` invocation authorizes this run to:

- create a new independent Knowledge Git at the user-chosen `--knowledge` root and bind it to the source
- write `llmdoc.yaml`, `README.md`, `docs/**/*.md`, `inbox/`, and `.llmdoc/meta.json` inside that knowledge repository
- write temporary investigation reports under `.llmdoc-tmp/investigations/`

The source repository stays read-only. Stop instead of improvising when a binding already exists (use `/llmdoc:update`) or when a legacy V3 layout is present (use `/llmdoc:migrate`).

## Preconditions

- The target `--knowledge` root must be new or empty; `init` never overwrites a non-empty target.
- Choose external mode by default. Add `--nested` only when the user explicitly wants the knowledge repository inside the source worktree, and the outer Git must ignore that subtree.
- `init` creates the knowledge Git, the layout, the initial knowledge commit, and the user binding. It never modifies the source repository.

## Workflow

1. Inventory the repository surface.
   - Before choosing boundaries, read [Knowledge Topology and Context Floor](../llmdoc/references/knowledge-topology.md). Use its domain/topic tests and Context Floor acceptance contract.
   - Read top-level manifests, README files, entrypoints, test surfaces, and release/config files.
   - Use one or more `investigator` subagents for complementary evidence scopes; keep their write ownership in `.llmdoc-tmp/`.

2. Create the Knowledge Git and binding.
   - Run `init --source <root> --knowledge <new-root>` (add `--nested` only if explicitly chosen).
   - The target is an independent Git repository with `llmdoc.yaml` identity, `docs/`, `inbox/`, and `.llmdoc/meta.json`.

3. Build the first knowledge surface with `recorder`.
   - Define topic boundaries before drafting leaf docs. A topic is the first path segment under `docs/`; deeper directories are allowed.
   - Prefer the smallest sufficient set of high-value owner docs over broad shallow inventory.
   - Every formal document needs `description`, `kind` (architecture | decision | guide | reference), and non-empty `source.paths` (repo-relative globs, no absolute paths, no `..`).
   - Keep temporary notes out of the Knowledge Git.

4. Capture candidates and promote before sealing.
   - Candidates are saved with `capture` into `inbox/` as unverified; formal retrieval never returns them.
   - Promote reviewed candidates with `update --promote ...` (or reject with `update --reject`), then confirm the Review Manifest with `review --confirm <reviewId>`.

5. Validate before reporting success.
   - Run `validate` and fix all front matter, relation, source-scope, and schema failures.
   - Treat `validate` as structural only. Run the Context Floor acceptance from the topology reference: natural-query searches, per-boundary `context --files` probes, and broad-glob precision probes.
   - Confirm the source is a valid HEAD with a clean worktree/index before `review` and `commit`.
   - Seal with `commit --review <reviewId>`; it writes the documents and `.llmdoc/meta.json` in one knowledge commit.
   - For host startup guidance, read [Startup Configuration](../llmdoc/references/startup-config.md); do not add optional startup guidance during bootstrap unless the user asks.

## State Invariants

- `init` seeds the binding and the initial knowledge commit only after the target validates.
- New documents start `unverified` (null revision/digest, empty paths/requires) until sealed through review.
- A failed init never leaves a half-created target bound; delete only the target it created.

## Result Contract

- `success`: Knowledge Git created, bound, populated, and validated.
- `no_change`: the declared scope was fully checked and no write was needed.
- `dry_run`: investigation or planning completed without writing the Knowledge Git; do not advance state.
- `incomplete`: init was refused (binding exists, migration required) or evidence was insufficient; roll back writes and do not advance state.
- `failed`: bootstrap failed and writes were rolled back.

Always report:

- whether init ran or was refused
- the knowledge root and mode (external or nested)
- the investigation report paths used
- the topics and documents created, with their `source.paths` coverage
- the `validate`, `review --confirm`, and `commit --review` results
- any intentional gaps; an unresolved first-class gap makes init `incomplete`, not `success`
