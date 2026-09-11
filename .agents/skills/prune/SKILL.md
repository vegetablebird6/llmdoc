---
name: prune
description: >-
  Explicit convergence pass that removes duplicated, fragmented, or
  low-value reconstructable Knowledge Git content.
argument-hint: '[--report | --remove <id...>] [summary]'
---

# /llmdoc:prune

Use this command only when existing Knowledge Git documents need convergence after growth, duplication, fragmentation, or accumulation of reconstructable inventory.

Load the `llmdoc` skill before broad exploration. CLI commands below run as `npx -y @tokenroll/llmdoc <cmd>`.

## Authorization

An explicit `/llmdoc:prune` invocation authorizes this run to:

- rewrite, merge, or delete documents under `docs/` in the knowledge worktree
- repair every inbound relation and link after removal
- form an unconfirmed Review Manifest for later `review --confirm` and `commit --review`
- write temporary investigation notes under `.llmdoc-tmp/investigations/` when needed

This command does not authorize source-code edits.

## Preconditions

- Formal review and seal require a valid source HEAD and an entirely clean source worktree/index.
- The knowledge worktree may be dirty, but the knowledge index must have no staged content.
- Rollback means discarding the uncommitted knowledge write-set; never hand-edit `.llmdoc/meta.json`.

## Workflow

1. Run `prune --report`.
   - Use the report as the primary mechanical signal for exact duplicates, superseded decisions, and fragmentation.
   - `prune --remove` removes only documents with concrete evidence (exact duplicates or superseded decisions); fragment-only candidates stay `insufficient` and are conservatively retained.
   - A clean report does not prove good knowledge density; semantic review remains the recorder's job.

2. Decide the convergence plan with `recorder`.
   - If the plan moves ownership, changes topic boundaries, or merges/splits documents, read [Knowledge Topology and Context Floor](../llmdoc/references/knowledge-topology.md) before rewriting.
   - Read [Startup Configuration](../llmdoc/references/startup-config.md) when host startup guidance references affected documents.
   - Merge duplicated docs, rewrite fragmented docs when a clearer boundary exists, and delete docs with no unique durable knowledge.
   - Apply the Stable Knowledge Gate sentence by sentence. Remove file inventories and other facts a reader can cheaply recover from canonical sources.
   - Preserve decisions and rationale, boundaries, invariants, cross-module contracts, non-obvious failures, and risky workflows.
   - `prune --remove` rewrites inbound `requires` / `related` / `supersedes` and links, then forms an unconfirmed Review Manifest.

3. Re-validate and seal.
   - Run `validate`.
   - Confirm surviving documents still declare accurate `source.paths`; do not attach unrelated paths merely to preserve coverage.
   - Run `review` and `review --confirm <reviewId>`, then `commit --review <reviewId>` to seal.
   - Report `success` only when durable knowledge density or routing materially improves.

## State Invariants

- `prune` updates validation evidence only on a successful sealed convergence.
- Deleting or renaming a document never silently rewrites other documents' validation evidence; affected documents enter the review write-set.
- Per-document evidence updates happen only for documents that survived or replaced prior documents.

## Result Contract

- `success`: knowledge density or routing materially improved and the result was sealed.
- `no_change`: the declared scope was fully verified and no justified convergence action remained.
- `dry_run`: only `prune --report` or planning output was produced without writing the Knowledge Git; do not advance state.
- `incomplete`: evidence was insufficient, user input is required, or the request belongs to another workflow; discard the uncommitted write-set.
- `failed`: prune failed and the uncommitted write-set was discarded.

Always report:

- the `prune --report` signal that justified the run
- which docs were merged, rewritten, or deleted, and how inbound relations were repaired
- the `review --confirm` and `commit --review` results
- how reconstructable evidence was reduced without losing durable decisions or contracts
