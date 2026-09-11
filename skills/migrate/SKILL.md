---
name: migrate
description: "Explicit legacy V3 to Knowledge Git migration. Never suggest this command implicitly."
disable-model-invocation: true
---

# /llmdoc:migrate

Use this command only for an explicit legacy V3-to-Knowledge-Git migration.

Do not suggest this command proactively. Do not mention its internals outside this file.

CLI commands below run as `npx -y @tokenroll/llmdoc <cmd>`.

## Authorization

An explicit `/llmdoc:migrate` invocation authorizes this run to:

- copy losslessly convertible legacy V3 knowledge into a new independent Knowledge Git
- create the target `llmdoc.yaml`, `docs/**/*.md`, `inbox/`, and `.llmdoc/meta.json`
- bind the source to the new knowledge root only after the target fully validates
- write temporary investigation reports under `.llmdoc-tmp/investigations/`

`migrate` is the only command that reads legacy V3 `.mdx`, CodeRef, `code.paths`, `llmdoc/meta.json`, or `llmdoc.config.json`. It never modifies the legacy repository or the source worktree, and it never extracts the old Git history.

## Preconditions

- Confirm the legacy surface has a recoverable Git backup; migration creates a new baseline instead of rewriting old history.
- The target `--knowledge` root must be new or empty; existing targets are never overwritten.
- Choose external mode by default; add `--nested` only when the user explicitly wants the knowledge repository inside the source worktree.
- Run the CLI migration directly; do not hand-simulate its mapping logic.

## Workflow

1. Map the legacy surface.
   - Use `investigator` to identify the legacy layout, surviving durable knowledge, and obsolete material.
   - Read [Knowledge Topology and Context Floor](../llmdoc/references/knowledge-topology.md) to understand the target topic/owner model, and [Startup Configuration](../llmdoc/references/startup-config.md) for target host guidance.

2. Run the migration in dry-run first.
   - Run `migrate --dry-run --knowledge <new-root>` (add `--legacy`, `--source`, or `--nested` as needed).
   - The dry-run shows every per-file target, conversion, collision, and validation evidence that cannot be preserved.

3. Apply the migration.
   - Run `migrate --knowledge <new-root>`.
   - Legacy `.mdx` and CodeRef become `.md` text, ordinary links, or prose evidence; `code.paths` becomes `source.paths`; `llmdoc/meta.json` becomes `.llmdoc/meta.json` with document IDs stripped of the old prefix and re-extensioned.
   - Components that cannot convert losslessly are listed for manual review rather than guessed.
   - Migrated documents start `unverified`: revision/digest are null, `validatedSourcePaths` is `[]`, and `validatedRequires` is `{}` until a new review seals them. Do not treat converted content as already verified.

4. Validate and seal.
   - Run `validate`; repair any structural failure.
   - Run `review` and `review --confirm <reviewId>`, then `commit --review <reviewId>` for documents that should become current. Unreviewed documents remain `unverified`.
   - Confirm the new binding is written only after the target validates.

## State Invariants

- Migration establishes a new target history; the legacy repository and its Git history stay byte-for-byte unchanged.
- Repeated runs never overwrite an existing target or its drafts.
- A failed migration leaves the old knowledge and source untouched; retry or delete only the unpublished target it created.

## Result Contract

- `success`: migration completed, the target validated, and the new binding was recorded.
- `no_change`: the declared scope was fully checked and no migration write was needed.
- `dry_run`: the mapping report was produced without writing anything.
- `incomplete`: evidence was insufficient, user input is required, or normal `update`/`prune` is the correct workflow; discard the unpublished target.
- `failed`: migration failed and the unpublished target was discarded.

Always report:

- the legacy surfaces consumed
- the `migrate --dry-run` mapping and any conservative downgrades
- the target Knowledge Git and mode
- the documents migrated, skipped, or left `unverified`
- the `validate`, `review --confirm`, and `commit --review` results
