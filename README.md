# llmdoc

[Website](https://llmdoc.tokenroll.ai/) · [简体中文](README.zh-CN.md)

**Detached Engineering Knowledge Base.** llmdoc preserves engineering understanding
that is costly to reconstruct from code, so agents can retrieve useful context
without rediscovering the same decisions in every task.

Source Git commits define facts; Knowledge Git commits preserve verified
understanding of those facts. Agents maintain that knowledge; humans review
conclusions when useful and feed corrections back to the agent.

## How it fits a task

| Responsibility | Owner |
|---|---|
| Current implementation facts | Source Git; code takes precedence when knowledge conflicts with it. |
| Decisions, rationale, constraints, and cross-module contracts | Standard Markdown in an independent Knowledge Git. |
| What is worth preserving and whether it remains true | The agent working on the task. |
| Retrieval, structural checks, and guarded publication | The llmdoc CLI. |

On each task, the agent retrieves relevant context, checks the code, and decides
whether it learned anything worth preserving. A task may need no knowledge write;
a new source file does not automatically need a document. Related source changes
prompt semantic review of existing knowledge, not an automatic changelog.

One source worktree binds to one independent knowledge worktree through a
user-level registry. External knowledge storage is the default, keeping personal
knowledge commits separate from business-code collaboration.

[Principles](#design-principles) · [Boundaries](#protocol-boundaries) ·
[Install](#install) · [Daily use](#daily-use) · [Reference](#reference)

## Design principles

These principles guide product decisions and tradeoffs:

1. **Separate facts from understanding.** Source commits are the traceable factual
   baseline; Knowledge commits preserve the engineering understanding that agents
   formed and verified against that baseline. Source answers "what the system is
   now"; llmdoc answers "why it is designed this way, which constraints must hold,
   and what future changes need to know."
2. **Record only durable engineering knowledge.** Only knowledge with future
   decision value, high reconstruction cost, and stability across multiple source
   commits enters the formal knowledge base: architectural intent, design decisions,
   constraints, invariants, failure semantics, and cross-module contracts. File
   structure, symbol relations, call graphs, and similar source-rebuildable
   information belong in indexes or caches, not durable knowledge.
3. **Treat source change as a review obligation.** A source change means related
   knowledge must be re-verified, not that the prose must change. Semantic review has
   three outcomes: update the prose, keep the prose and refresh the validation
   baseline, or confirm the change is irrelevant. llmdoc never turns a source diff
   into an automatic knowledge changelog.
4. **Make knowledge validity verifiable.** Every formal document declares its source
   scope, validated source revision, and the content-integrity information needed to
   distinguish `current`, `needs_review`, and `unverified` states. Retrieval
   returns content together with its validation evidence instead of relying on
   document update times.
5. **Agents maintain knowledge; humans review conclusions.** Agents drive discovery,
   organization, editing, verification, and sealing. Humans can review agent
   conclusions and raise corrections, additions, or challenges; that feedback
   re-enters the agent's update flow, and llmdoc performs the formal edit and
   re-verification. Human review is an optional quality-control step, not a
   precondition for routine knowledge maintenance.
6. **Keep knowledge separate from execution instructions.** llmdoc preserves
   readable, searchable, citable, and auditable reference knowledge. It does not
   distribute rules, skills, prompts, hooks, or other execution instructions, and no
   knowledge content may depend on hidden instructions or runtime behavior to hold.

## Protocol boundaries

These are enforced invariants: when one does not hold, the protected workflow must
fail instead of guessing or weakening the protocol.

1. **Source Git is read-only.** llmdoc must not modify its files, index, history,
   or configuration. Source development is a separate workflow.
2. **Knowledge Git is independent and never falls back.** The Knowledge Repository
   must be its own Git repository, external by default and nested only when explicitly
   selected. Persistent writes must fail when the binding or independent Git is
   missing; only explicit read-only retrieval may use a no-Git knowledge directory.
3. **Formal review uses a valid, clean committed source snapshot.** Only a source
   commit with a valid HEAD and a fully clean worktree/index counts. The source
   revision is the validation basis; the knowledge revision is the Knowledge Git
   commit.
4. **Knowledge publication is guarded and atomic.** A Review Manifest binds
   the source revision, content digests, and scope. Bodies, relations, and meta
   are published in one step through a temporary index and a compare-and-swap ref
   update; the knowledge index must have nothing staged, and it is synchronized
   on success together with llmdoc-owned generated files.
5. **Only committed standard Markdown is formal knowledge.** Formal documents come
   from committed `docs/**/*.md`; inbox candidates and rebuildable caches never enter
   the formal knowledge surface or claim verified status.

The "only write boundary" means the knowledge content and its Git. `bind` may
write a user-level registry, and temporary files and caches are written under the
knowledge directory or a user-level cache. Those are explicit exceptions, and
none of them may write into the source repository. Nested mode only writes the
independent knowledge subtree; it never changes the outer Git, ignore rules, or
other source files. If the source directory must remain byte-for-byte unchanged,
use external mode.

## Install

### Claude Code

Add the marketplace and install the plugin:

```text
/plugin marketplace add vegetablebird6/llmdoc
/plugin install llmdoc@llmdoc-plugin
```

If the install summary says `Run /reload-plugins to activate.`, run that command.
If the reload warns about rereading the conversation, rerun it as
`/reload-plugins --force`. Once the plugin is active, initialize a repository
with `/llmdoc:init`.

### Codex

Add the marketplace and start Codex from the repository:

```bash
codex plugin marketplace add vegetablebird6/llmdoc
codex
```

Inside Codex, run `/plugins`, open the `llmdoc-plugin` marketplace, and install
`llmdoc`. Review the plugin and its hooks before enabling them, then ask a new
session to use the `llmdoc:init` skill.

### Direct CLI

No plugin is required. View the external CLI help from the target repository:

```bash
npx -y @vegetablebird6/llmdoc --help
```

`@vegetablebird6/llmdoc` is external tooling. Do not add it to the consumer project's
`package.json` or lockfile, and never use the unrelated bare package name
`npx llmdoc`. For reproducible runs, pin the package spec:
`npx -y @vegetablebird6/llmdoc@<version> <command>`.

## Daily use

### Initialize once

After installing the plugin, ask the agent to use the `llmdoc:init` skill and
choose an external knowledge directory. The skill investigates the project,
creates the binding, and builds the initial useful knowledge surface.

The CLI provides the repository setup step; it does not write engineering
understanding by itself:

```bash
npx -y @vegetablebird6/llmdoc init --source ./app --knowledge ../app-knowledge
# Or bind an existing independent knowledge repository
npx -y @vegetablebird6/llmdoc bind --source ./app --knowledge ../app-knowledge
```

`init` never overwrites a non-empty target. Select `--nested` explicitly only
when the outer Git does not track the knowledge subtree; formal review still
requires the source worktree to be clean.

### Move an existing knowledge repository

This relocation flow applies only when the existing knowledge repository and
the new environment both use a compatible v3-ng dual-repository format.
Move the complete, clean Knowledge Git worktree, including its `.git/`, then
bind its new absolute path to the new source clone. A path move does not use
the legacy `migrate` command; moving V2/V3 knowledge into v3-ng is a format
migration and must use the explicit migration workflow instead.

```bash
npx -y @vegetablebird6/llmdoc bind --source /path/to/new-source --knowledge /path/to/project-knowledge
cd /path/to/new-source
npx -y @vegetablebird6/llmdoc status
npx -y @vegetablebird6/llmdoc validate
npx -y @vegetablebird6/llmdoc delta
```

Keep the knowledge repository external by default; use `--nested` only when it
lives inside the source worktree. The new clone must contain the source commits
recorded by the knowledge ledger, ideally with its current HEAD at or descended
from them. Missing or diverged history remains readable but is reported for
review. If `bind` reports `E_BINDING_CONFLICT`, deliberately remove or update
only the stale path entry in the user registry; `bind` never overwrites it.

### Retrieve the context the task needs

Choose one entry point for the question; these are alternatives, not a checklist:

| Need | Command after `npx -y @vegetablebird6/llmdoc` |
|---|---|
| Get oriented | `tree` |
| Find a concept | `search "retry policy"` |
| Locate knowledge for a source change | `context --files src/api/client.ts` |
| Browse a topic without bodies | `index --topic lifecycle` |
| Read a selected document | `show lifecycle/task-recovery.md` |

The agent uses the returned knowledge as context and checks current facts in
code. `status` and `delta` help identify review obligations when maintaining
knowledge; they are not mandatory retrieval steps.

### Preserve useful understanding

The agent decides during each task whether knowledge needs to be added, corrected,
or re-verified. It merges useful conclusions into their existing owner where
possible. Human approval is not a routine prerequisite for knowledge maintenance.

For verified understanding, the agent edits formal Markdown in the Knowledge Git
and publishes through the review protocol:

```bash
npx -y @vegetablebird6/llmdoc validate
npx -y @vegetablebird6/llmdoc review
npx -y @vegetablebird6/llmdoc review --confirm <reviewId>
npx -y @vegetablebird6/llmdoc commit --review <reviewId>
```

The agent performs semantic review before confirming. Conclusions are `changed`,
`unchanged`, or `insufficient`; `--set <id>=<conclusion>` can override a proposal.
Unchanged prose can receive a refreshed validation baseline. Insufficient evidence
does not advance verification. Any edit after confirmation requires a new review.

Formal review and seal require a valid, fully clean source snapshot and an
unstaged knowledge index. The CLI writes the validation ledger; never hand-edit
`.llmdoc/meta.json`.

**Capture only when deferring.** If a useful finding cannot yet be finalized—for
example, the source is still uncommitted—the agent may use `capture` to save an
unverified candidate in `inbox/`. Later it can merge the finding into an existing
document or promote it with `update`. Candidates stay out of formal retrieval.
Capture is optional, not a required step before every knowledge edit.

## Knowledge layout

```text
knowledge/
├── .git/
├── llmdoc.yaml            # shared identity and layout version
├── README.md              # machine-generated navigation region
├── docs/
│   ├── architecture.md
│   └── lifecycle/task-recovery.md
├── inbox/                 # unverified candidates
├── .llmdoc/meta.json      # per-document validation evidence
└── .llmdoc-cache/         # rebuildable, excluded by the knowledge .gitignore
```

Document IDs are docs-relative POSIX `.md` paths, and `docs/` may be nested to
any depth. The `README.md` navigation region is generated from titles,
descriptions, and paths, and is never a knowledge node or a validation target.

## Document format and source evidence

Every formal document requires a non-empty `source.paths` list of repo-relative
globs. Absolute paths and `..` are rejected, and each concrete path must exist in
the specified snapshot.

```yaml
---
kind: decision
description: Why task recovery joins lease and timeout to decide owner expiry.
source:
  paths:
    - internal/task/**
    - pkg/lease/**
relations:
  requires:
    - lifecycle/architecture.md
  supersedes:
    - decisions/old-recovery.md
---
```

`kind` is one of `architecture`, `decision`, `guide`, or `reference`. `relations`
supports `requires`, `related`, and `supersedes`. `supersedes` points from a new
decision to the older one it replaces; it does not change either document's
validation state. `requires` forms an acyclic dependency graph: when an upstream
document changes and is re-sealed, its dependents become `needs_review` until
they are re-verified against the new digest.

## Understanding validity

Retrieval reports both the source revision used as the factual snapshot and the
Knowledge Git revision containing the documents. Each document has one status:

| Status | Meaning |
|---|---|
| `unverified` | No validation evidence has been recorded. |
| `current` | Content and scope match the recorded evidence, source history is available and compatible with no relevant changes, and required knowledge remains current with matching digests. |
| `needs_review` | Content, relevant source, dependencies, or available evidence no longer support the previous verification. |

`current` describes the document's recorded evidence; it is not proof that the
knowledge covers all code or that the agent's interpretation is infallible. The
agent remains responsible for semantic judgment.

Source conditions such as `source_dirty`, `invalid_head`,
`history_unavailable`, and `diverged` are reported separately. Uncommitted
source does not become part of the verified snapshot. Existing knowledge can
still be retrieved while formal review is blocked.

The ledger stores four evidence fields: `validatedSourceRevision`,
`validatedContentDigest`, `validatedSourcePaths`, and `validatedRequires`.
`lastGlobalReviewRevision` records an explicit global review baseline, not the
validity of every document. See the [protocol](docs/v3-ng-design/architecture.md)
for schemas, dependency rules, and publication guarantees.

## Operations when needed

| Situation | Entry point |
|---|---|
| Save an unverified finding for later | `capture --title "lease vs timeout" --from notes.md`; use the returned candidate ID. |
| Process a candidate | `update --promote <candidateId> --to <newDocId> --kind decision --description "..." --source-path "internal/task/**"`, or `update --reject <candidateId>`; then review, confirm, and seal. |
| Consolidate redundant knowledge | Start with `prune --report`; the agent judges whether removal is warranted before `prune --remove <id>` and publication. |
| Read legacy V3 knowledge | Explicit `migrate --dry-run --knowledge <newRoot>`, then `migrate` with the same target when requested. |
| Browse committed knowledge | `serve` starts a read-only viewer on `127.0.0.1`. |
| Integrate lifecycle diagnostics | `hook session-start`, `hook stop`, or `hook compact`; read-only and fail-open. |

Candidate IDs are relative to `inbox/`; promotion creates a new document and does
not overwrite an existing one. `update` prepares changes, never verifies them by
itself. Hooks report diagnostics; they do not maintain knowledge or create bindings.

Legacy V3 layouts are read only by explicit migration. Migration copies into a new
independent Knowledge Git without changing the old repository or importing its
history; converted documents must be verified through the new protocol.

Use `npx -y @vegetablebird6/llmdoc --help` or `help <command>` for exact flags.
Retrieval supports `--json`, `--budget`, `--limit`, and `--cursor`.
For other agents, use the [portable integration recipe](docs/agent-integration.md).
CLI interface text, diagnostics, and the viewer are English; Chinese queries and
knowledge content are supported.

## Develop this repository

The repository root is a private development workspace; the public consumer
artifact is the `@vegetablebird6/llmdoc` CLI.

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run build
npm run validate:dogfood
npm run check:prompts
```

`npm test` is the quick development gate: protocol contracts, host surfaces,
selected read paths, and one real review/seal smoke transaction. Run
`npm run test:integration` for the complete dual-Git, CAS, lock, migration,
rollback, and fault-injection suite; CI runs it once on Node 22 while the quick
gate runs across the supported Node matrix.

Install from the repository root so the local `llmdoc` bin is linked before
validation. CLI semantics changes must stay synchronized with the host surfaces,
the bilingual READMEs, the design documentation, and dogfood knowledge.

## Reference

- [Portable Agent integration recipe](docs/agent-integration.md)
- [Architecture and protocol](docs/v3-ng-design/architecture.md)
- [Operating protocol](skills/llmdoc/SKILL.md)
- Workflow contracts: [`init`](skills/init/SKILL.md),
  [`update`](skills/update/SKILL.md), [`prune`](skills/prune/SKILL.md), and
  [`migrate`](skills/migrate/SKILL.md)
- Runtime reference: `npx -y @vegetablebird6/llmdoc --help`
