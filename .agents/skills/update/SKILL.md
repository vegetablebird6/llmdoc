---
name: update
description: >-
  Explicit semantic verification and sync of Knowledge Git documents
  against the fixed source revision.
argument-hint: '[summary] [--promote <candidate> --to <docId>] [--reject <candidate...>]'
---

# /llmdoc:update

Use this command when inbox candidates or source/knowledge changes require formal knowledge to be reviewed or synchronized.

Load the `llmdoc` skill before broad exploration. CLI commands below run as `npx -y @vegetablebird6/llmdoc <cmd>`.

## Authorization

An explicit `/llmdoc:update` invocation authorizes this run to:

- read source state, the Knowledge Git, and `.llmdoc-tmp/reflections/pending/` candidates
- apply explicit `--promote` / `--reject` decisions to the knowledge worktree
- form an unconfirmed Review Manifest for later `review --confirm` and `commit --review`
- write temporary investigation reports under `.llmdoc-tmp/investigations/`

This command does not authorize source-code edits, and it never marks anything `current` by itself.

## Preconditions

- Formal review and seal require a valid source HEAD and an entirely clean source worktree/index. Uncommitted source may still be read or captured.
- Knowledge worktree edits are allowed, but the knowledge index must have no staged content before seal.
- Rollback means discarding the uncommitted knowledge write-set; never hand-edit `.llmdoc/meta.json`.

## Workflow

1. Measure the current state.
   - Run `status` to read tri-state document status, source blockers, and review obligations.
   - Run `delta` to list the documents that need semantic review after source or knowledge changes.
   - Read pending candidates under `.llmdoc-tmp/reflections/pending/` when present. A pending candidate is an update signal even when the source delta is empty.

2. Gate candidates before promotion.
   - Require a verifiable trigger, a wrong assumption or action, root cause, preventive rule, scope, confidence, and an existing-doc match.
   - Verify repository claims against code, tests, or current documents. User corrections prove intent, not repository facts.
   - Reject transient failures, one-task preferences, and unverified speculation. Use `search` and `show` to find an existing owner before creating a document.

3. Choose the lightest sufficient path from delta plus qualified candidates.
   - Light: owners are mapped and the facts are clear.
   - Deep: files are unmapped, owner/root cause is unclear, boundaries changed, facts conflict, or impact is broad.
   - For unmapped or moved code and boundary changes, read [Knowledge Topology and Context Floor](../llmdoc/references/knowledge-topology.md) and classify each surface as missing mapping, missing owner, or intentional no-doc.

4. Apply the semantic outcome with `recorder`.
   - Treat `delta`, `status`, and candidates as review evidence, not a write list or prose to copy.
   - Rewrite only false or incomplete claims, or new conclusions that pass the Stable Knowledge Gate.
   - Keep `source.paths` and relations accurate; every formal document needs non-empty `source.paths`.
   - `update` applies promote/reject decisions to the worktree and forms an unconfirmed Review Manifest. It never seals.

5. Confirm and seal.
   - Run `review` to generate a Review Manifest bound to the fixed source revision and document digests.
   - Review each document's semantic conclusion, then run `review --confirm <reviewId>` (use `--set id=changed|unchanged|insufficient` to override a conclusion; add `--global` for a global scan).
   - Seal with `commit --review <reviewId>`; it writes documents and `.llmdoc/meta.json` in a single knowledge commit and refreshes the four validation-evidence fields.
   - Any edit after confirmation invalidates the manifest; re-run `review`.

6. Fold durable lessons into stable docs directly.
   - Put reusable cautions, invariants, and workflow fixes into the relevant architecture, decision, guide, or reference document.
   - Candidates are a temporary evidence queue, not a tracked knowledge kind.
   - When knowledge changes affect host startup guidance, read [Startup Configuration](../llmdoc/references/startup-config.md) and update that guidance in the same write set.

## State Invariants

- `update` never advances validation by itself; only a sealed `commit --review` writes the four evidence fields.
- A `needs_review` document stays `needs_review` until it is reviewed against the fixed source revision and re-sealed.
- `lastGlobalReviewRevision` advances only on a confirmed global scan, never per partial update.

## Result Contract

- `success`: the declared scope was semantically reviewed and sealed through `commit --review`.
- `no_change`: the declared scope was already current, so neither prose nor evidence needed to change.
- `dry_run`: only status/delta/investigation/planning output was produced without writing the Knowledge Git; do not advance state.
- `incomplete`: evidence was insufficient, user input is required, or the scope belongs to another workflow; discard the uncommitted write-set.
- `failed`: update failed and the uncommitted write-set was discarded.

Always report:

- the chosen path (`light` or `deep`) and why
- the `status` / `delta` signals and source blockers used
- each reflection candidate and its disposition (`promoted`, `already_covered`, `dismissed`, or `pending`)
- the documents changed and the review conclusion per document
- the `review --confirm` and `commit --review` results, or why finalization was skipped
