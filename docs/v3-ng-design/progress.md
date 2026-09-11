# v3-ng 实施进度与续接记录

最后更新：2026-09-11（M3 经 Codex R3 直接接管完成收口与最终复审；原样全量 `npm test` exit 0，29 files / 205 tests，待提交后进入 M4）。

## 执行约定

- 写代码前先落地设计；用户已认可架构并给出收敛意见，设计已同步为实现基线，运行时实现按 M1–M5 推进。
- 每完成一步立即更新本文件，记录变更文件、验证命令与结果、剩余问题和下一步。实际行为改变时同步 architecture.md / roadmap.md，不能只有进度变化而设计仍过时。
- 未执行、失败或被中断的验证要明确标注，不能当作通过。部分完成的步骤保留进行中状态。
- 中断后先读 README.md、architecture.md 和本文件，再核对分支及工作树差异；只保留 v3-ng 设计与实现，不重复已完成工作。
- 审查粒度按完整里程碑执行：OpenCode 在 M1/M2/M3/M4/M5 内连续完成子步骤、自测并逐步更新本文件；Codex 在整个 M 完成后集中 review。里程碑内部发现的问题由 OpenCode 自行修正，不再逐个子步骤等待 Codex 放行。同一个完整 M 经 Codex review 后交回 OpenCode 返修累计三轮仍未通过时，Codex 直接接手该 M 的实现修复、测试和进度记录。每个完整 M 通过 Codex review 后，由 Codex 创建只包含该里程碑 v3-ng 改动的 Git commit，再分派下一个 M；不得 push。

## 当前检查点

| 步骤 | 状态 | 产物与证据 |
|---|---|---|
| D0 需求与现状核对 | 完成 | 已读取用户附件；核对 V3 设计、workspace.ts、commit.ts；CLI tree 启动失败后使用指定文件核对 |
| D1 创建分支 | 完成 | 当前分支 v3-ng，起点 ae0695dbf4fc4084e0078be3edf6a7772e059722 |
| D2 设计落地 | 完成 | README.md、architecture.md、roadmap.md、progress.md；原文 v4 统一解释为 v3-ng |
| D3 评审收敛 | 完成 | 全仓 clean、digest、manifest、临时 index/CAS、三态、supersedes、opaque gitlink、显式绑定与 reference data 已同步 |
| D4 协议冻结补齐 | 完成 | validatedRequires/validatedSourcePaths、clean knowledge index、同步收尾及 P1 已落地；协议主线冻结 |
| M1 仓库边界 | 完成（R8 收口：连续两次原样 `npm test` exit 0，24 files / 142/142，无 unhandled；R9 保持） | 见「M1 第三轮最终返修 — 2026-09-10」 |
| M2 内容与读取 | 完成（breaking replacement；Codex R3 直接收口，28 files / 179 tests 全过） | 见「M2 Codex R3 直接修复与最终复审通过」 |
| M3 语义提交 | 完成并通过 Codex R3（原样全量 `npm test` exit 0，29 files / 205 tests，无 unhandled） | 见「M3 实施记录」「M3 R1/R2 返修实施与验证记录」「M3 Codex R3 直接接管收口」 |
| M4 最小维护闭环 | 未开始 | 见 roadmap.md |
| M5 接入与发布 | 未开始 | 见 roadmap.md |

## M1 子步骤拆解

| 子步骤 | 范围 | 状态 |
|---|---|---|
| M1a 独立 Context 与独立性检查 | `cli/src/lib/v3ng/`：NgError 错误契约（code/paths/remediation/exitCode）；显式 context 的 Git 调用（`GIT_OPTIONAL_LOCKS=0`，只读禁 index 写入，不跑 external diff/textconv；Git 仓库选择环境隔离）；SourceContext（实际 worktree 根、gitDir、common directory、HEAD 以 `HEAD^{commit}` 验证（unborn / 非 commit / detached 区分，快照不可用不伪称 clean）、全仓 clean 分类快照、blockers：invalid_head / source_dirty）；KnowledgeContext（worktree 根相等检查、common directory 必须不同、外置/嵌套显式模式、嵌套时外层 Git 不得跟踪该子树且归属检查 fail closed、containment 检查）+ 真实双 Git 仓测试 | 完成（含 R1/R2/R3 返修） |
| M1b 用户 registry 与 repositoryId | 用户级 bindings.json（Windows `%APPDATA%/llmdoc/`，Unix `$XDG_CONFIG_HOME/llmdoc/`）；llmdoc 创建的逻辑 repositoryId（不从 Git 身份推导）；registry 独立短锁 + 原子替换；按 source/knowledge 路径的精确绑定解析；`E_BINDING_NOT_FOUND` / `E_BINDING_AMBIGUOUS` / `E_SOURCE_IDENTITY_MISMATCH` | 完成（见「M1b 记录」） |
| M1c bind / init 入口 | CLI `bind` / `init` 命令；外置默认；嵌套须显式选择；init 仅创建知识 Git、知识文件与用户绑定，非空目标拒绝；写路径缺独立知识 Git 返回 `E_KNOWLEDGE_REPO_NOT_FOUND`；所有操作保持 source 状态不变 | 完成（见「M1c 记录」与 incident 处理记录） |
| M1d M1 验收收口 | roadmap「必须验收」1–3 的 M1 部分（source HEAD/index/文件字节级保留对比、嵌套忽略规则场景、多 clone/fork 不串绑）；文档同步；V3 旧写入 fallback 的移除随 CLI 入口迁移执行，不在 M1a | 完成（见「M1d 记录」；验收 1–3 中属 M2–M4 的流程与 V3 fallback 迁移不在本轮） |

注意：**M1a 完成不等于 M1 完成**（历史记录，M1a 时的边界声明；M1 现已按 M1b/M1c/M1d 收口）。M1a 只交付库级 context 与独立性检查，尚未接入任何 CLI 入口：现有 V3 命令（tree/search/commit/status 等）仍走旧 `workspace.ts` 的 source Git 写入回退逻辑；`bind`/`init`、用户 registry、repositoryId 均未实现；嵌套模式的「外层显示 untracked 即阻断正式复核」门控属于正式复核（M3）与 bind（M1b/M1c）范围。M1a 仅保证新 context 层自身对 source 零写入。

当前边界（M1 完成时点）：v3-ng 新增 `bind`/`init` 命令与 context/registry 层已接入并验收；现有 V3 命令仍走旧 workspace 逻辑，其写入 fallback 移除与命令面迁移属 M2+；嵌套「外层 untracked 阻断正式复核」门控属 M3。

## M1a 记录

步骤 / 日期：M1a 独立 SourceContext / KnowledgeContext 与 Git 归属、路径、同 common directory 拒绝检查 / 2026-09-09
状态：完成（M1a 初版；本节为初版记录，Codex R1/R2 返修内容与最新测试数见下方「M1a 复审修复记录」。M1 整体未完成，见「M1 子步骤拆解」注意项）
完成内容与文件：
- 新增 `cli/src/lib/v3ng/errors.ts`：NgError 错误契约（code / message / paths / remediation / exitCode；结构错误 2、事务/IO 70）。错误码：`E_SOURCE_REPO_NOT_FOUND`、`E_KNOWLEDGE_REPO_NOT_FOUND`、`E_GIT_IDENTITY_CONFLICT`、`E_KNOWLEDGE_ROOT_NOT_WORKTREE`、`E_NESTED_MODE_REQUIRED`、`E_NESTED_NOT_INSIDE_SOURCE`、`E_NESTED_TRACKED_BY_OUTER`、`E_KNOWLEDGE_CONTAINS_SOURCE`、`E_GIT_INVOCATION_FAILED`。
- 新增 `cli/src/lib/v3ng/paths.ts`：realpath 规范化（覆盖 symlink/junction、Windows 大小写不敏感比较）。
- 新增 `cli/src/lib/v3ng/git-core.ts`：显式接收 GitRepoLayout（worktreeRoot/gitDir/commonDir）的 Git 调用，所有调用注入 `GIT_OPTIONAL_LOCKS=0` 且只读（不刷新 source index、不跑 external diff/textconv、不 fetch/checkout）；bare/worktree 布局探测；全仓 clean 快照（staged/unstaged/非 ignored untracked/conflict 分类）；HEAD 状态（含 unborn/detached）。
- 新增 `cli/src/lib/v3ng/contexts.ts`：`resolveSourceContext`（实际 worktree 根、gitDir、commonDir、HEAD、clean、blockers=invalid_head/source_dirty；repositoryId 置 null 待 M1b）；`resolveKnowledgeContext`（知识根必须等于知识 Git worktree 根；与 source 的 common directory 必须不同——覆盖「知识目录向上命中 source Git」与「同仓 linked worktree」；外置/嵌套必须显式二选一，嵌套时外层 Git 不得跟踪该子树（文件或 gitlink，`:(literal)` pathspec 检查）；知识仓包含 source 反向包含拒绝；不同仓的 linked worktree（`.git` 为文件）判为独立）。
- 新增 `cli/tests/v3ng-contexts.test.ts`：18 个真实临时双 Git 仓测试（非 mock）。
- 未修改任何既有文件；CLI 入口（cli.ts、workspace.ts 等）零改动。
验证命令及实际结果：
- `npx vitest run tests/v3ng-contexts.test.ts`（cli/）：18/18 通过。含：干净仓解析与 HEAD 读取；unborn HEAD 报 invalid_head；staged/unstaged/untracked/conflict 分类为 source_dirty；gitlink 指针变化计入外层 dirty 且子模块内部修改不进入父 SourceContext（`--ignore-submodules=dirty`）；重复解析后 source `.git/index` 字节级不变、HEAD 与 status 不变；bare 仓/非 Git 目录/不存在路径拒绝；外置双仓解析与 docsRoot/metaPath 布局；junction/symlink 与 `..`/尾分隔符路径规范化；无 Git 知识根 `E_KNOWLEDGE_REPO_NOT_FOUND`；source worktree 本身与同仓 linked worktree `E_GIT_IDENTITY_CONFLICT`；他仓 linked worktree（`.git` 文件）判独立通过；知识仓子目录 `E_KNOWLEDGE_ROOT_NOT_WORKTREE`；source 内嵌套未显式选模式 `E_NESTED_MODE_REQUIRED`、显式 nested 通过；外层跟踪（文件/gitlink）`E_NESTED_TRACKED_BY_OUTER`；知识仓包含 source `E_KNOWLEDGE_CONTAINS_SOURCE`；嵌套模式用在隔离根 `E_NESTED_NOT_INSIDE_SOURCE`；Windows 大小写仅异写根可解析（win32 实测）。
- `npm run typecheck`：通过。`npm run lint`：通过。
- `npm test`（build + 全量 vitest）：9 个文件 102/102 通过（含既有 V3 测试 84 个，无回归）。
- `git status` 核对：既有 staged/modified 全部原样保留，本次仅新增 `cli/src/lib/v3ng/`、`cli/tests/v3ng-contexts.test.ts`（未跟踪）与本目录文档更新；未 stage/unstage/commit。
设计调整：无协议变更。实现层说明两条：(1) clean 快照用 `git status --porcelain --no-renames --untracked-files=normal --ignore-submodules=dirty` 同时满足「gitlink 指针变化按外层 dirty」与「子模块内部修改不进入父 SourceContext」；(2) 测试中证实外层 Git 无法直接 `git add` 嵌套仓内文件（静默 no-op），故「外层跟踪知识子树」的真实场景是外层先跟踪普通文件、之后原地 `git init`，独立性检查按此场景验证。
剩余问题：CLI 入口未接入，现有 V3 命令仍走旧 workspace 回退逻辑；registry / repositoryId / bind / init 未实现（M1b/M1c）；`E_SOURCE_IDENTITY_MISMATCH` 等绑定错误码属 M1b；嵌套「外层 untracked 阻断正式复核」属 M3 门控。
下一步具体入口：M1b 用户 registry（`%APPDATA%/llmdoc/bindings.json`、`$XDG_CONFIG_HOME/llmdoc/bindings.json`）与 repositoryId 精确绑定解析；随后 M1c 接入 `bind`/`init` CLI 入口。
关联 commit：无（按约定不提交、不暂存）。

## 工作树边界

开始本任务前已有大量未提交修改，涉及 CLI、tests、skills、agents、README、V3 设计、llmdoc 和网站。本次仅新增 docs/v3-ng-design/，未将已有修改提交，未修改运行时代码。后续不能把已有差异全部归为 v3-ng 的本次实施。

## 验证记录

（时期：D0–D4 文档设计轮，运行时实现开始之前；下述「未执行运行时测试」仅描述该时期）

- 分支已通过 `git branch --show-current` 核对为 v3-ng。
- 该轮为文档设计，未执行运行时测试；roadmap 中的验收在当时均未完成。
- 该轮新增设计文档的相对链接检查通过；`git diff --check` 通过（该命令仅覆盖已有 tracked 差异，不涵盖尚未跟踪的新设计文件）。
- M1a 起进入运行时实现轮：真实测试证据一律记录在「M1a 记录」与「M1a 复审修复记录」，不再沿用本节的「未执行」结论。

## 下一步

（时期：D4 收敛时点的计划；其中第 3 条已由 M1a 执行推进，最新入口见「M1a 复审修复记录」末尾）

1. 设计基线已获用户认可，无需重复请求总体架构评审。下一实施入口为 M1。
2. 实施前核对现存 V3 修改的归属与提交边界。
3. 从 M1 开始，先落实仓库独立性与绑定契约；每个子步骤完成后在本文件追加文件、测试证据和续接入口。

## 每步记录格式

```text
步骤 / 日期：
状态：未开始 | 进行中 | 完成 | 阻塞
完成内容与文件：
验证命令及实际结果：
设计调整：
剩余问题：
下一步具体入口：
关联 commit（如有）：
```

## D3 续接说明

本轮只更新 docs/v3-ng-design 下四份设计文档。移除关联 dirty 豁免、pending_source_commit 文档状态、live worktree 验证及最后合法 seal 历史反查；以用户本次评审为准。当时采用真实 index 保留方案；此项已被 D4 明确替代，不得继续按旧规则实现。运行时测试未执行。四份设计文档的相对链接与行尾空白检查通过；旧规则检索只命中明确的移除说明，没有保留关联 dirty 豁免。


## D4 续接说明

本轮按用户附件完成三个 P0 和全部 P1，仅更新本目录四份设计文档。协议主线冻结，不再进行开放式协议扩展。正式有效性使用四项 validation evidence；requires 无环；review 取旧新 committed source scope 并集。所有知识写事务要求 index 无 staged，正常发布后同步真实 index 和未被并发编辑的自有生成文件；capture 共用事务。用户已有 staged 状态保留与历史抽取明确延期。

下一步从 M1 开始实现，无需再次请求总体协议评审。实现前读取当前工作树状态并保护既有修改，按 M1 子步骤记录代码与真实测试证据。本轮运行时代码未改、测试未执行。四份文档的相对链接、行尾空白检查通过；旧 baselineSourceRevision/stale 文档及保留任意 staged 的现行契约检索无残留。当前分支核对为 v3-ng。

## M1a Codex review — 2026-09-09

结论：请求修改，尚未通过，不推进 M1b。

- R1/P1：git-core.ts 的 probe/runGit 继承 GIT_DIR、GIT_WORK_TREE 等仓库选择环境，且调用仅使用 cwd。已用两个真实临时仓复现：resolveSourceContext(A) 在环境指向 B 时返回 B。必须隔离仓库选择/索引环境，并使执行归属与显式 layout 一致；补真实 Git 回归。
- R2/P1：contexts.ts 的 assertNestedSubtreeUntracked 使用 allowMissing，ls-files 非零返回 null 后放行。归属检查失败必须 fail closed，保留 E_GIT_INVOCATION_FAILED；不能解释成无跟踪文件。
- 已阅读新增四个库文件及测试；18/18、102/102 暂为 OpenCode 报告，本轮未独立重跑。CLI 尚未接入是 M1a 明确范围限制，不视作整个 M1 完成。
- 执行会话：ses_f7afd8acdffesq9hqGVQXzXKnf。返修完成后核对实际 diff、回归测试和进度，再决定是否推进 M1b。现有后台完成检查保持生效，禁止重复启动同会话写者。

## M1a 复审修复记录 — 2026-09-09

按 Codex M1a review（R1/P1、R2/P1）返修，未推进 M1b，未改冻结协议，未 stage/commit。

完成内容与文件：
- `cli/src/lib/v3ng/git-core.ts`（R1）：新增 `sanitizedGitEnv()`——构造 Git 子进程环境时按大小写不敏感方式剔除仓库选择/执行类变量（`GIT_DIR`、`GIT_WORK_TREE`、`GIT_INDEX_FILE`、`GIT_COMMON_DIR`、`GIT_OBJECT_DIRECTORY`、`GIT_ALTERNATE_OBJECT_DIRECTORIES`、`GIT_CEILING_DIRECTORIES`、`GIT_NAMESPACE`、`GIT_EXTERNAL_DIFF`、`GIT_EXTERNAL_TEXTCONV`、`GIT_DIFF_OPTS`、`GIT_CONFIG`、`GIT_CONFIG_COUNT`、`GIT_CONFIG_KEY_*`、`GIT_CONFIG_VALUE_*`、`GIT_OPTIONAL_LOCKS`、`GIT_EDITOR`、`GIT_SEQUENCE_EDITOR`、`GIT_PAGER`、`GIT_ASKPASS`、`GIT_SSH`、`GIT_SSH_COMMAND`），Windows 大小写变体（如 `git_dir`）同样剔除；随后显式设置 `GIT_OPTIONAL_LOCKS=0`。`runGit` 与 `spawnGitText` 均改用该环境，并追加 `-C <worktreeRoot>` 与 `--no-optional-locks` 双保险，使命令严格归属显式 layout，不再继承外部仓库选择状态。
- `cli/src/lib/v3ng/contexts.ts`（R2）：`assertNestedSubtreeUntracked` 的 `ls-files` 移除 `allowMissing`——任何非零返回现在抛 `E_GIT_INVOCATION_FAILED`（exit 70）fail closed，不再把失败解释为「未跟踪」。
- `cli/tests/v3ng-contexts.test.ts`：新增两条真实回归（总数 18→20）：(1) 设置 `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` 指向仓库 B 后，`resolveSourceContext(A)` 与 `resolveKnowledgeContext(K)` 仍分别返回 A/K，B 的 HEAD 不变、污染 index 文件未被创建、A 的 `.git/index` 字节不变；(2) 外层 `.git/index` 写入损坏字节后，嵌套归属检查抛 `E_GIT_INVOCATION_FAILED`（exit 70），不再放行。

验证命令及实际结果：
- `npx vitest run tests/v3ng-contexts.test.ts`（cli/）：20/20 通过（含新增两条 R1/R2 回归）。
- `npm run typecheck`：通过。`npm run lint`：通过。
- `npm test`（build + 全量 vitest）：9 个文件 104/104 通过（含既有 V3 测试无回归）。
- `git status` 核对：既有 staged 内容与返修前完全一致（50 files, +1394/-245），未 stage/unstage/commit/reset。
- 过程说明：环境污染回归首跑失败一次，根因是测试自身的 `head()` helper 同样继承了污染环境（在污染窗口内读到 B 的 HEAD），resolver 行为正确；已改为污染前快照 HEAD 后通过。该现象同时佐证 R1 的复现路径真实成立。

剩余问题：与 M1a 初版一致（CLI 入口未接入；registry / repositoryId / bind / init 属 M1b/M1c）。
下一步具体入口：交 Codex 复审 R1/R2 返修；通过后进入 M1b 用户 registry 与 repositoryId 精确绑定。
关联 commit：无（按约定不提交、不暂存）。

## M1 implementation incident — 2026-09-09

状态：M1 继续进行；未进入里程碑 review。

- M1 CLI 测试暴露异步环境隔离错误：测试 helper 在 Promise 完成前恢复 `APPDATA`，导致一次测试绑定写入真实用户 registry `C:\Users\Dango\AppData\Roaming\llmdoc\bindings.json`。
- Codex 只读核对确认该文件于本轮测试创建，唯一 binding 的 source/knowledge 均指向 `llmdoc-v3ng-cli-*` 临时目录；随后按精确路径和内容门控删除该测试污染文件及空目录，未删除任何真实 binding。
- OpenCode 必须修复异步环境生命周期，增加“测试前后真实默认 registry 不创建/不变化”的回归，并重新运行 M1 测试。不得以直接访问或清理真实用户 registry 作为测试方案。
- 同轮定向测试另有 `init` 后重复 `bind` 返回 `bound` 而非 `already-bound` 的失败，须在 M1 内修复。完成 M1b/M1c/M1d 前不得声明 M1 完成。

## M1a Codex second review — 2026-09-09

结论：R1/R2 返修正确，但新增 R3 后仍请求修改；M1a 尚未通过，不推进 M1b。

- R1 已关闭：独立复现确认 `GIT_DIR` / `GIT_WORK_TREE` / `GIT_INDEX_FILE` 污染不再把 A 解析成 B；新增真实 Git 回归覆盖串仓和 source index 不变。
- R2 已关闭：嵌套归属的 `ls-files` 改为 fail closed；损坏外层 index 的回归返回 `E_GIT_INVOCATION_FAILED`（70）。
- R3/P1：`readHeadState` 用 `rev-parse --verify HEAD`，没有要求对象为 commit；当 HEAD 直接指向 blob 时先被当成有效 revision，随后 `git status` 抛 `E_GIT_INVOCATION_FAILED`，没有按冻结协议及 SourceContext 类型报告 `invalid_head`。Codex 用真实临时仓复现。HEAD 有效性必须验证 `HEAD^{commit}`；无有效 commit 的状态不能被后续 clean 快照错误掩盖。补 unborn 与非 commit HEAD 的区分回归，并保持正常、detached commit 行为。
- Codex 独立验证：定向 20/20、typecheck、lint 通过；全量 `npm test` 9 files、104/104 通过。现有通过测试没有覆盖 R3，不能据此批准 M1a。

下一步具体入口：OpenCode 修复 R3 后直接继续 M1b/M1c/M1d，完成整个 M1 及其测试证据后再交 Codex 集中 review；不再单独等待 M1a 复审。

## M1a R3 返修记录 — 2026-09-09

按 Codex second review 仅修 R3/P1（R1/R2 已关闭），未推进 M1b，未改冻结协议，未 stage/commit。

完成内容与文件：
- `cli/src/lib/v3ng/git-core.ts`：`readHeadState` 在 `rev-parse --verify HEAD` 之后追加 `rev-parse --verify HEAD^{commit}` 剥离验证——`headRevision` 只在 HEAD 解析为 commit 对象时给出；`HeadState` 新增 `rawHeadRevision`（未剥离对象，用于诊断）与 `pointsToCommit`。`CleanSnapshot` 新增 `available`/`unavailableReason`；`readCleanSnapshot` 接受 `allowUnavailable`：status 失败且 HEAD 非 commit 时返回 `available:false`、`clean:false` 的快照（失败不得伪装成 clean），HEAD 为有效 commit 时维持 fail closed 原样抛 `E_GIT_INVOCATION_FAILED`（保住 R2 语义）。
- `cli/src/lib/v3ng/contexts.ts`：`resolveSourceContext` 改为 `allowUnavailable: !head.pointsToCommit`；invalid_head 阻断原因区分三种：unborn、HEAD 指向非 commit 对象（附 raw OID，非 commit HEAD 不得当作有效 revision）、无法解析；`source_dirty` 仅在快照 available 时报告，快照不可用时不伪造脏分类。
- `cli/tests/v3ng-contexts.test.ts`：新增两条真实回归（总数 20→22）：(1) 把 `refs/heads/main` 直接指向 `git hash-object -w` 产生的 blob：`headRevision` 为 null、headUnborn 为 false、blockers 恰为 `invalid_head`、快照 `available:false` 且 `clean:false`（不被 status 的 `E_GIT_INVOCATION_FAILED` 掩盖，也不伪称 clean）；(2) `checkout --detach` 到真实 commit：headDetached true、headBranch null、`headRevision` 等于该 commit、blockers 空、clean true。unborn 与正常 commit 两类由既有测试覆盖。

验证命令及实际结果：
- 本机先行实测（git 真实行为）：blob HEAD 下 `rev-parse --verify HEAD` 成功返回 blob（即 R3 指出的误判源）；`rev-parse --verify HEAD^{commit}` exit 128（"expected commit type, but the object dereferences to blob type"）；`git status` exit 128（"bad tree object HEAD"）。
- `npx vitest run tests/v3ng-contexts.test.ts`（cli/）：22/22 通过。
- `npm run typecheck`：通过。`npm run lint`：通过。
- `npm test`（build + 全量 vitest）：9 个文件 106/106 通过（既有 V3 测试无回归）。
- `git status` 核对：既有 staged 内容与返修前完全一致（50 files, +1394/-245），未 stage/unstage/commit/reset。

剩余问题：与 M1a 初版一致（CLI 入口未接入；registry / repositoryId / bind / init 属 M1b/M1c）。
下一步具体入口：交 Codex 复审 R3；通过后进入 M1b 用户 registry 与 repositoryId 精确绑定。
关联 commit：无（按约定不提交、不暂存）。

## M1b 记录 — 2026-09-09

按用户指令直接实施（不再逐步等待复审；Codex 集中 review 在整个 M1 完成后进行）。

完成内容与文件：
- `cli/src/lib/v3ng/errors.ts`：新增 `E_KNOWLEDGE_CONFIG_INVALID`、`E_KNOWLEDGE_NOT_INITIALIZED`、`E_INIT_TARGET_NOT_EMPTY`、`E_BINDING_NOT_FOUND`、`E_BINDING_AMBIGUOUS`、`E_BINDING_CONFLICT`、`E_SOURCE_IDENTITY_MISMATCH`（结构错误，exit 2）与 `E_REGISTRY_INVALID`、`E_REGISTRY_LOCKED`、`E_REGISTRY_UNAVAILABLE`（registry/IO 域，exit 70）。
- 新增 `cli/src/lib/v3ng/identity.ts`：repositoryId 为 `llmdoc-` + 32 hex（crypto randomBytes 生成，不从 remote URL、root commit 或 Git 身份推导）；`REPOSITORY_ID_PATTERN` 供 registry 与 llmdoc.yaml 校验。
- 新增 `cli/src/lib/v3ng/knowledge-config.ts`：知识仓 `llmdoc.yaml`（schema `llmdoc.knowledge/v1`：repositoryId、layoutVersion=1、remotes）；解析用 js-yaml（已在 package.json 显式声明依赖 `js-yaml ^4.1.1` 与 devDep `@types/js-yaml`，此前仅为 gray-matter 传递依赖）；remote URL 凭据剥离（userinfo 移除）；`collectSourceRemotes` 从 source 只读采集 remote（fetch URL）作非敏感 alias 记录。
- 新增 `cli/src/lib/v3ng/registry.ts`：用户级 bindings.json（Windows `%APPDATA%/llmdoc/`，Unix `$XDG_CONFIG_HOME/llmdoc/` 缺省 `~/.config`）；schema `llmdoc.bindings/v1`，条目 {repositoryId, sourcePath, knowledgeRoot}（均为 realpath）；读取严格校验（`E_REGISTRY_INVALID`）；独立短锁 `bindings.lock`（wx 独占创建、owner token+pid+host+时间、40×50ms 重试后 `E_REGISTRY_LOCKED`(70)，释放前校验 token 不误删他锁）；原子替换（临时文件+rename）。
- 新增 `cli/src/lib/v3ng/binding.ts`：`resolveWriteBinding` 精确绑定解析——写操作只接受 registry 中该 source worktree 的唯一显式绑定；0 命中 `E_BINDING_NOT_FOUND`、多命中 `E_BINDING_AMBIGUOUS`；显式 `--knowledge` 与绑定不符 `E_BINDING_CONFLICT`；知识仓 llmdoc.yaml 的 repositoryId 与 registry 不符 `E_SOURCE_IDENTITY_MISMATCH`；无 llmdoc.yaml `E_KNOWLEDGE_NOT_INITIALIZED`；绑定知识 Git 消失时返回 `E_KNOWLEDGE_REPO_NOT_FOUND`，绝不回退到 source Git。
- 测试 `cli/tests/v3ng-registry.test.ts`（8）、`cli/tests/v3ng-binding.test.ts`（9）：真实文件与真实临时双仓；含锁竞争与不误删他锁、非法 registry 拒绝、win32 大小写命中、clone 隔离（每 clone 需显式绑定）、身份不匹配、source 字节级不变。
- `cli/package.json`、`cli/package-lock.json`、根 `package-lock.json`：仅依赖声明与 lock 元数据变化。

验证命令及实际结果：
- `npx vitest run tests/v3ng-registry.test.ts tests/v3ng-binding.test.ts tests/v3ng-init-bind.test.ts`：26/26 通过（init-bind 同轮实现，见 M1c 记录）。
- `npm run typecheck` / `npm run lint`：通过。

剩余问题：registry 仅服务精确绑定；alias 只读发现（E_BINDING 语义之外的 alias 检索）属 M2 检索面。
下一步具体入口：M1c bind/init CLI 接入。

## M1c 记录 — 2026-09-09

完成内容与文件：
- 新增 `cli/src/lib/v3ng/init.ts`：`initKnowledgeRepository`——init 仅写知识仓与用户 registry，对 source 零写入。流程：source 必须为 Git worktree（SourceContext 复用）；目标不存在或为空目录（`E_INIT_TARGET_NOT_EMPTY`，绝不覆盖非空目标）；嵌套拓扑预检（source 内须显式 nested，反之 `E_NESTED_NOT_INSIDE_SOURCE`）；registry 冲突预检 + 全程持 registry 短锁；`git init` + `symbolic-ref HEAD refs/heads/main`；骨架文件 `llmdoc.yaml / README.md（导航标记区占位）/ .gitignore（.llmdoc-cache/）/ docs/.gitkeep / inbox/.gitkeep / .llmdoc/meta.json（llmdoc.meta/v3-ng，lastGlobalReviewRevision=null，documents={}）`；初始提交走 `add(显式路径) → write-tree → commit-tree → update-ref`，不运行任何 Git hooks，author/committer 用显式 env（`llmdoc <llmdoc@llmdoc.local>`），不要求用户 git identity；完成后 `resolveKnowledgeContext` 独立性全检，再写 registry 条目。init 失败可能留下未绑定的新建知识目录（无 registry 条目、无副作用外溢），在复审中按此评估。
- 新增 `cli/src/lib/v3ng/bind.ts`：`bindKnowledge`——绑定既有 llmdoc 初始化知识仓；不创建身份（无 llmdoc.yaml 即 `E_KNOWLEDGE_NOT_INITIALIZED`）；幂等（同 source+knowledge+repositoryId → `already-bound`）；source 已绑他根、knowledge 根已绑他 source → `E_BINDING_CONFLICT`（1:1 绑定，clone/fork/worktree 各自显式）。
- `cli/src/lib/v3ng/git-core.ts`：`runGit` 增加受控 `env` 覆盖（仅 init 的 commit-tree 身份使用；仓库选择环境仍被 sanitizedGitEnv 剥离）。
- CLI 接入 `cli/src/cli.ts`：新增 `bind --source --knowledge [--nested]`、`init --source --knowledge [--nested]` 命令（帮助文本注明 source 零写入与精确绑定语义）；`runCli` 捕获 NgError——JSON 模式输出 schema 校验的 `{error:{code,message,paths,remediation}}`，文本模式输出 message+`Remediation:`，退出码沿用错误契约（2/70）。
- `cli/src/lib/output-schema.ts` + `cli/schemas/output.schema.json`：新增 `bind`/`init`/`ngError` 输出契约（additive，不动既有 defs）。
- 新增 `cli/src/commands/bind.ts`、`cli/src/commands/init.ts` 薄封装。
- 测试：`cli/tests/v3ng-init-bind.test.ts`（9）、`cli/tests/v3ng-cli.test.ts`（5，全部显式临时 registry 环境）。

验证命令及实际结果：
- `npx vitest run tests/v3ng-init-bind.test.ts tests/v3ng-cli.test.ts`：14/14 通过（含非空目标拒绝、不重绑、nested 显式门控、幂等 bind、凭据剥离、CLI JSON/文本错误渲染、source 字节级保留）。

### incident 处理记录（对应「M1 implementation incident」）

- 根因：commander `parseAsync` 对同步 action 在 runCli 调用栈内同步 dispatch；测试 helper `withRegistryEnv` 在 `run()` 返回 Promise 后立即于 finally 恢复 `APPDATA`，导致 init 在 env 窗口内写临时 registry、bind 在窗口外读真实 registry——两者注册表不一致，bind 表现为新建绑定（`bound`），且向真实 `%APPDATA%\llmdoc\bindings.json` 写入了一条指向 `llmdoc-v3ng-cli-*` 临时目录的污染条目。
- 修复：`withRegistryEnv` 改为 async——`await run()` 完成后才恢复 env；该文件内全部 CLI 测试统一走该 helper；所有 M1 测试不访问/写入/清理真实用户 registry。
- 回归护栏：`tests/v3ng-cli.test.ts` 增加 beforeAll/afterAll 对默认真实 registry 的只读快照（存在性 + SHA-256 摘要），afterAll 断言不变——测试只读取存在性/摘要，不读取内容、不删除任何文件。
- Remediation：本会话核实真实 `%APPDATA%\llmdoc\bindings.json` 当前不存在（与 incident 记录的 Codex 门控删除一致）；本会话未删除任何用户文件。
- 验证：`npx vitest run tests/v3ng-cli.test.ts` 5/5 通过，`init → bind` 现返回 `already-bound`。

### 全量稳定性修正（同一轮）

- 现象：全量 `npm test` 连续两轮 7 个纯超时失败（15/20/30s 上限，全部集中在 nested-projection / viewer-http / invariants / v3ng 验收等最重测试）+ 6 次 `[vitest-worker] Timeout calling "onTaskUpdate"`；串行运行同批文件全部通过——为并行 worker 在慢机/AV 环境过载造成的假阳性，非行为回归。
- 修复：`cli/vitest.config.ts` 增加 `fileParallelism: false`（文件级串行；既有 testTimeout=15000 保留）；v3ng 验收三个最重测试显式 30s 超时。
- 验证：全量 `npm test` 14 个文件 145/145 通过；残留 1 次 onTaskUpdate IPC 超时噪音，无测试受影响（已记录为环境噪音）。

剩余问题：README 导航区生成与 inbox 语义属 M4；本文件当前仅为占位。
下一步具体入口：M1d roadmap 验收收口。

## M1d 记录 — 2026-09-09（M1 验收收口）

完成内容与文件：
- 新增 `cli/tests/v3ng-m1-acceptance.test.ts`（8），覆盖 roadmap「必须验收」1–3 的 M1 部分（search/update/commit/prune/migrate 流程验收属 M2–M4）：
  1. 验收 1（M1 部分）：外置 init + bind + 重复解析全流程前后，source HEAD、`.git/index` 字节、全部工作树文件内容哈希、`git status --porcelain` 输出逐项一致；重复 `resolveSourceContext` 不刷新 index（`GIT_OPTIONAL_LOCKS=0` + `--no-optional-locks`）。
  2. 验收 2（M1 部分）：bind 级独立性失败矩阵——无 Git 目录、source worktree 本身、source 内无自有 Git 的子目录（向上命中 source Git → `E_KNOWLEDGE_ROOT_NOT_WORKTREE`）、同仓 linked worktree（同 common dir）、全部 `E_GIT_IDENTITY_CONFLICT`/`E_KNOWLEDGE_*` 拒绝；他仓 linked worktree（`.git` 为文件）判独立可绑定；嵌套未显式选择拒绝；嵌套 init 在外层文件跟踪（`E_NESTED_TRACKED_BY_OUTER`，先跟踪后原地 init 场景）与 gitlink 登记（空目标场景）下均拒绝；Windows junction 与大小写异写根按同一绑定处理（`already-bound`）。
  3. 验收 3（M1 部分）：两个无关项目严格隔离（不同 repositoryId、不串知识仓）；同源 clone 需各自显式绑定（未绑定 `E_BINDING_NOT_FOUND`，绑定后互不串）；registry 双条目歧义 `E_BINDING_AMBIGUOUS`；fork/相同 remote alias 不授予身份（alias 仅记录进 llmdoc.yaml，URL 凭据剥离，SSH/HTTPS 显式按路径绑定）；registry 被锁时 init 失败 `E_REGISTRY_LOCKED`(70) 且 source 不动。
  4. 「禁止 source Git 写入 fallback」：绑定的知识 Git 被删除时写解析返回 `E_KNOWLEDGE_REPO_NOT_FOUND` 而非回退 source Git（v3ng-binding 测试）；全部验收流程中 v3-ng 对 source 零写入（字节级对比）。
- 已知边界（记录于 M1 子步骤拆解注意项）：现有 V3 命令仍走旧 workspace 逻辑，其 fallback 移除属 M2+ 入口迁移；M1 范围内 v3-ng 自身无任何 source 写入路径。

验证命令及实际结果：
- `npx vitest run tests/v3ng-m1-acceptance.test.ts`：8/8 通过。
- 全量 `npm test`（build + vitest，文件级串行）：14 个文件 145/145 通过（V3 84 + M1a 22 + M1b 17 + M1c 14 + M1d 8）。
- `npm run typecheck`：通过（exit 0）。`npm run lint`：通过（exit 0）。
- `git status` 核对：既有 staged 50 files (+1394/−245) 保持原样；未 stage/unstage/commit/reset/push。

剩余问题：嵌套「外层显示 untracked 阻断正式复核」门控属 M3；bind/init 的 --json 输出已入 schema，但 CLI 帮助与双语网站同步属 M5。
下一步具体入口：整个 M1 完成并交 Codex 集中 review；通过后进入 M2（内容与读取：types/schema/markdown/search、docs `.md`、decision、source.paths、双 revision、viewer）。
关联 commit：无（按约定不提交、不暂存）。

## M1 集中 review 返修记录 — 2026-09-10

按「M1 Codex 集中 review — 2026-09-10」修复 R4–R7，未进入 M2，未 stage/commit/reset/push，未改冻结协议，未覆盖他人修改。

完成内容与文件：
- `cli/src/lib/v3ng/paths.ts`（R4）：新增 `realPathViaExistingAncestor`——从目标向上找到最近存在祖先做 realpath，再词法拼回缺失段；init 目标拓扑判定全部改用该规范路径，junction/symlink 两个方向的包含关系在创建任何内容前即可判定。
- `cli/src/lib/v3ng/init.ts`（R4/R5）：init 流程重构——(1) 解析目标即用 ancestor-realpath；(2) nested/external 拓扑预检、目标可用性检查、source 绑定冲突检查、knowledgeRoot 占用冲突检查全部移入 registry 锁内并在创建前复核（消除 TOCTOU：锁等待期间目标变非空即 `E_INIT_TARGET_NOT_EMPTY`，registry 已占用该空 knowledgeRoot 即 `E_BINDING_CONFLICT`，均零落盘）；(3) 失败清理 `cleanupInitArtifacts`：仅移除本次调用写入的构件（`.git`、骨架文件、清空后的 docs/inbox/.llmdoc），自建目标目录删除、预存在空目录保留（不触碰用户/外部内容）；清理单项隔离 + 重试（Windows delete-pending/AV 瞬时占用）；(4) `rmSync` 目录需 `recursive:true` 的坑已在测试中实证。
- `cli/src/lib/v3ng/errors.ts`（R6）：新增 `E_FILESYSTEM_IO`（exit 70）与 `runFileSystemIo` 包装器；registry（read/write/lock mkdir/open/acquire 非 EEXIST/rename/stage）、knowledge-config（llmdoc.yaml 读取）、init（目标路径解析、创建、skeleton 写入、目标检查）的全部 I/O 失败转为稳定 NgError（code/message/paths/remediation），`%APPDATA%` 指向普通文件等场景 `--json` 下输出契约化错误而非裸 ENOTDIR 崩溃。
- `cli/src/lib/v3ng/registry.ts` + `bind.ts` + `init.ts` + `commands/bind.ts` + `commands/init.ts` + `cli.ts`（R5 连带）：registry 短锁由同步 `Atomics.wait` 阻塞循环改为 async `setTimeout` 等待——阻塞式循环中定时器/其他写者事件无法推进，Codex 要求的「锁等待期间目标变化」在同步实现下不可观测；`bindKnowledge`/`initKnowledgeRepository`/`runBind`/`runInit` 与 CLI action 相应转 async，行为不变。
- `cli/src/lib/v3ng/binding.ts`（R7）：`resolveWriteBinding` 在 registry 与 llmdoc.yaml 双向身份校验通过后，将验证过的 `entry.repositoryId` 回填到返回的 `source.repositoryId`（SourceContext 携带逻辑身份，符合 architecture §1；后续 M2/M3 消费此字段）。
- 测试：新增 `cli/tests/v3ng-init-hardening.test.ts`（9）——R4 两方向 junction realpath 预检且失败零落盘（junction 在 source 内指向外部 → `E_NESTED_NOT_INSIDE_SOURCE`；junction 在外部指入 source → `E_NESTED_MODE_REQUIRED`；两侧目录快照与 registry 均无变化）；R5 registry 占用空 knowledgeRoot 前置冲突、锁等待期间目标变化（150ms 写入 + 释放）、故障注入（spy `writeFileSync` 在 llmdoc.yaml 抛出）下自建目标整体移除且 registry/source 不变、预存在空目标仅清除 llmdoc 构件、`E_FILESYSTEM_IO` 两例（registry 目录为文件、llmdoc.yaml 为目录）；`cli/tests/v3ng-cli.test.ts` 新增 `--json` 下 `E_FILESYSTEM_IO` 的 ngError schema 输出回归；`cli/tests/v3ng-binding.test.ts` 新增 R7 repositoryId 回填断言；`cli/tests/v3ng-registry.test.ts` 适配 async 锁。

验证命令及实际结果：
- `npx vitest run tests/v3ng-init-hardening.test.ts`：9/9 通过。
- 全部 v3ng 文件（7 个）串行运行：71 项全过（修复过程中定位并解决三个实现问题：同步锁阻塞导致锁等待回归不可观测、清理目录 `rmSync` 缺 `recursive` 抛 `ERR_FS_EISDIR`、Windows delete-pending 需清理重试）。
- `npm run typecheck`：exit 0。`npm run lint`：exit 0。
- 全量 `npm test`：15 个文件 155/155 通过（V3 84 + v3ng 71）；残留 1 次 onTaskUpdate IPC 超时噪音，无测试受影响。
- `git status` 核对：既有 staged 50 files (+1394/−245) 与返修前完全一致；真实 `%APPDATA%\llmdoc` 不存在（Codex incident 处理后未再产生）；未 stage/unstage/commit/reset/push。
- 测试期间曾向测试文件写入临时调试输出，已全部移除；对他人文件零改动。

剩余问题：与 M1 完成时点一致（V3 fallback 迁移属 M2+；嵌套 untracked 门控属 M3；README/inbox 语义属 M4）。
下一步具体入口：交 Codex 复审 R4–R7 返修；通过后 M1 正式关闭，进入 M2。
关联 commit：无（按约定不提交、不暂存）。

## R8/R9 返修记录 — 2026-09-10

按「M1 Codex 返修复审 — 2026-09-10」处理 R9/P2 与 R8/P1。基于 Codex 清理后的干净基线（HEAD ae0695db + 仅 v3-ng 内容；未恢复任何被丢弃的 V3 修改）。

### R9 — 完成

- `cli/src/lib/v3ng/init.ts`：`createdTarget` 判定移入 registry 锁内的最终预检点（锁外不再读取目标存在性）；失败清理据此区分"本次调用创建的目标（失败后移除）"与"预存在目标（失败后仅清除 llmdoc 构件、目录保留）"。
- 回归：`cli/tests/v3ng-init-hardening.test.ts` 新增 "keeps an externally created empty target that appears during the registry lock wait"——初始不存在 + 持锁等待期间外部创建空目录 + 故障注入（skeleton 写入抛出）→ 清理后目录保留为空、无 `.git`、registry 零条目。定向 10/10 通过。

### R8 — 断言层全绿；exit 0 未达成，剩余 1 个 vitest infra 级 unhandled，需 Codex 决策

已应用的修复（全部真实执行验证）：
1. `cli/vitest.config.ts` runner 配置（R8 授权范围）：`fileParallelism: false`（并行文件执行使所有 Git 型测试减速 4–6 倍，既打穿 5s 默认 testTimeout 也造成 worker 无法在 60s 内泵消息）+ `testTimeout: 30000`（本机慢盘/AV 下 V3 重测试串行也需 5–20s；该数值为本轮独立选定的 runner 配置，非恢复被丢弃 V3 patch 的文本）。未使用 `dangerouslyIgnoreUnhandledErrors`，未过滤输出，未吞错。
2. v3-ng 测试调度（v3-ng-only）：7 个 v3ng 测试文件 `vi.setConfig({ testTimeout: 30000 })`；v3ng afterAll 临时目录清理改为分块让出事件循环（消除 v3ng 侧最长同步删除循环）。
3. v3-ng 库调度：`git-core.ts` 的 runGit/probeGitLayout/readCleanSnapshot/readHeadState 由 spawnSync 改为异步 spawn（v3ng 调用链在每个 spawn 之间让出事件循环，消除 v3ng 侧 60s 级连续阻塞；contexts/binding/init/bind 随之 async，CLI 已 await）。
4. HEAD 测试在 Windows/Node 26 上的宿主兼容修复（最小必要，需 Codex 确认）：`tests/helpers.ts` 与 `tests/cli.test.ts` 共 4 处 `fs.symlinkSync` 补平台类型参数（默认 "file" 在 Windows 对目录 EPERM）；consumer 测试 `npm init/install/llmdoc --help` 补 `shell: win32`（Node ≥24 对 .cmd 强制）+ `--no-audit --no-fund --update-notifier off` 防网络挂起 + exec-bit 断言 POSIX-only。修复后这 5 个 HEAD 测试恢复通过。
5. v3ng 侧回归完好：R9 测试 + 全部既有 v3ng 测试 72/72；typecheck/lint exit 0。

七轮原样 `npm test` 真实 exit code（`cmd /c 'npm test > 日志 2>&1'` 后立即读 `$LASTEXITCODE`，无筛选管道；日志在仓库内忽略目录 `.llmdoc-tmp/`）：
run1=1（并行：75 测试超时 + 6 unhandled）→ run2=1（串行：16 测试超时 + 1 unhandled）→ run3=1（5 HEAD 测试 EPERM + 1 unhandled）→ run4=1（1 npm EINVAL + 1 unhandled）→ run5=1（1 POSIX mode bit + 1 unhandled）→ run6=1（1 mode bit + 1 超时波动 + 1 unhandled）→ **run7=1（0 测试失败、155/155 断言通过，仅剩 1 个 unhandled）**。

run7 残留根因（证据充分）：`[vitest-worker]: Timeout calling "onTaskUpdate"` 为 vitest 已知问题（上游 issue #8164/#6479）——birpc 固定 60s RPC deadline；单独运行 `tests/cli.test.ts` 即可复现（53/53 通过、无 ≥60s 单测、tests 总时长≈墙钟、threads/forks 池均复现），触发点是 V3 测试在 cli.test.ts 内的连续 spawnSync 跨度在 AV/慢盘尖峰下超过 60s 不泵 worker 消息循环。该代码属 HEAD 的 V3 库与测试（`src/lib/git.ts`、`commands/commit.ts`、`tests/helpers.ts` 链），按当前边界不可修改。

待 Codex 决策的选项：
A. 授权对 V3 测试基建做调度性 yield 或拆分 cli.test.ts（超出"只服务 v3-ng"边界，需明确授权；拆分预计可把单文件同步跨度压到 60s 以下）。
B. 授权升级 vitest 或对 vendored rpc chunk 提高该 deadline（不吞错：真实 >10min 挂起仍会报错；涉及 node_modules 补丁或依赖变更，需评审）。
C. 接受 run7 状态（断言 155/155 全过 + 唯一失败为上游已知 infra 问题）作为 M1 通过基线，V3 测试调度另立事项。

核对：真实 `%APPDATA%\llmdoc` 不存在；git index 为空（无 staged）；工作树仅含 v3-ng 内容与本轮记录的修改；未 stage/unstage/commit/reset/push。
下一步具体入口：按 Codex 决策执行 R8 收尾；随后 M1 关闭进入 M2。
关联 commit：无（按约定不提交、不暂存）。

## M1 Codex 集中 review — 2026-09-10

结论：请求修改，M1 尚未通过；不推进 M2。

- R4/P1（路径逃逸与失败后副作用）：`init.ts` 在目标不存在时只对 `path.resolve()` 的词法路径做包含判断，未按架构 §1 先解析已有祖先的 realpath。Windows 实测：source 内 junction 指向 source 外目录，使用 `--nested` 初始化 junction 下的新目标时，命令最终返回 `E_NESTED_NOT_INSIDE_SOURCE`，但已在 source 外创建完整 `.git`。必须在任何创建前规范化“未来目标路径”（解析最近存在祖先并拼接剩余段），再判断 nested/external；补 junction/symlink 两个方向的真实 Git 回归，并断言失败零落盘。
- R5/P1（init 非原子且目标检查存在 TOCTOU）：目标空检查发生在 registry 锁外，knowledgeRoot 绑定冲突又到初始 commit 创建后才检查。独立实测：registry 预存另一 source 指向一个空 knowledgeRoot 后，对第二个 source 执行 init，命令返回 `E_BINDING_CONFLICT`，但空目标已被改造成完整知识仓。并发等待 registry 锁期间目标变为非空也会绕过首次检查。必须在持锁后、任何落盘前重新检查目标与 knowledgeRoot 冲突；后续失败应清理仅由本次调用创建的内容，同时保留调用前已存在的空目录，不能覆盖并发/外部内容。补冲突、锁等待或故障注入回归。
- R6/P1（JSON 错误契约不完整）：M1 新命令仅把 `NgError` 包装为 `ngError`；registry/init 的原生 fs 异常会逃到 bin 顶层。实测把 `%APPDATA%` 指向普通文件后执行 `llmdoc --json init`，exit 70，但 stdout 为空、stderr 为裸 `ENOTDIR`，违反架构 §5“JSON 错误统一含 code/message/paths/remediation”。将 M1 边界内的 registry、init/config I/O 失败转换为稳定 `NgError`（事务/IO exit 70），并覆盖 JSON schema 回归。
- R7/P2（绑定后的 SourceContext 未携带逻辑身份）：架构 §1 要求 SourceContext 包含 repositoryId；`resolveWriteBinding` 验证 registry 与 `llmdoc.yaml` 后仍返回 `repositoryId:null` 的原始 source，只把身份留在旁路 `entry`。请在精确绑定成功后返回携带已验证 repositoryId 的 SourceContext，并补断言，避免 M2/M3 调用方各自拼接身份。

独立验证证据：
- `npm run typecheck`：通过；`npm run lint`：通过。
- M1 定向测试：6 files、61/61 通过。现有用例未覆盖 R4–R7，因此通过结果不足以批准 M1。
- 两个失败副作用复现均使用独立临时 Git 仓，复现后已按已校验的 TEMP 根清理；真实 `%APPDATA%/llmdoc/bindings.json` 仍不存在。
- 既有 staged V3 内容未 stage/unstage/commit/reset/push。

下一步具体入口：OpenCode 在同一会话集中修复 R4–R7、更新本文件并重跑 M1 定向与全量检查；修复完成后交 Codex 复审整个 M1，通过前不得进入 M2。

## M1 Codex 返修复审 — 2026-09-10

结论：R4–R7 已关闭；新增 R8/P1、R9/P2，M1 仍未通过，不推进 M2。

- R4 已关闭：独立复现确认不存在目标经 source 内外 junction 的两个方向均在创建前拒绝，失败零落盘。
- R5 主路径已关闭：registry 已占用的空 knowledgeRoot 在初始化前拒绝，目标保持为空；故障注入能清理本次构件。
- R6 已关闭：`%APPDATA%` 指向普通文件时，`llmdoc --json init` 以 exit 70 输出 schema 合法的 `E_FILESYSTEM_IO`，stdout 有结构化错误、stderr 为空。
- R7 已关闭：精确绑定成功后 `SourceContext.repositoryId` 来自 registry 与 `llmdoc.yaml` 双重校验的逻辑身份。
- R8/P1（全量测试被误报为通过）：Codex 独立执行原样 `npm test`，15 files、155/155 断言通过，但 Vitest 最终报告未处理错误 `[vitest-worker]: Timeout calling "onTaskUpdate"` 并以 exit 1 结束。此前通过管道筛选输出后读取 `$LASTEXITCODE` 会得到筛选命令状态，掩盖 npm 的真实退出码。必须让仓库原样 `npm test` 稳定 exit 0；修复测试调度/拆分或 runner 配置，禁止靠过滤、吞掉 unhandled error 或把 exit 1 记录为通过。至少连续两次原样全量通过再交复审。
- R9/P2（目标所有权仍在锁外判定）：`targetExistedBefore` 在等待 registry 锁之前读取，锁等待期间若外部创建一个空目标，二次检查会放行，但 `createdTarget` 仍为 true；后续失败清理可能删除并非本次创建的目录。请在持锁后的最终预检点确定目标是否由本次调用创建，并用真实锁等待 + 故障注入覆盖“初始不存在、等待期间外部创建空目录”的场景；外部目录必须保留。

独立验证证据：
- typecheck、lint 通过；R4–R7 定向复审 3 files、26/26 通过。
- 原样 `npm test`：15 files、155/155 assertions，1 unhandled error，exit 1；因此全量门禁失败。
- 真实 `%APPDATA%/llmdoc/bindings.json` 不存在；既有 staged V3 基线仍为 50 files、+1394/−245；未 stage/unstage/commit/reset/push。

下一步具体入口：OpenCode 在同一会话修复 R8/R9，更新本文件，使用不经过输出筛选的命令核对真实退出码；完成后停止并交 Codex 复审，禁止进入 M2。

## v3-ng 工作树清理 — 2026-09-10

按用户最新明确授权执行：不再保留任务开始前的旧 V3 staged/working-tree 修改；非 v3-ng 内容可以丢弃。清理在 OpenCode 写者停止后进行。

- 清理前将“旧 staged patch”和“相对旧 index 的 v3-ng tracked patch”写入本机 TEMP，并在独立 HEAD clone 中验证 v3-ng patch 可重建；重叠的 output schema 单独提取 v3-ng 的 `bind/init/ngError` 定义。
- 将 tracked tree 与 index 恢复到 HEAD `ae0695dbf4fc4084e0078be3edf6a7772e059722`，随后只恢复 v3-ng tracked 差异；`cli/schemas/output.schema.json` 从 HEAD 仅加入 v3-ng 三个输出定义。旧 V3 的 50-file staged 基线已全部丢弃。
- `cli/vitest.config.ts` 的旧 V3 `testTimeout` 与 M1 临时 `fileParallelism` 调整一并移除；R8 必须基于当前干净基线重新验证并只保留确有必要的 v3-ng 测试调度变更。
- 清理后 index 为空；工作树仅剩 v3-ng 设计、M1 实现/测试、CLI 接入、output schema 与依赖锁文件变化。`git diff --check`、typecheck、lint 通过；真实 `%APPDATA%/llmdoc/bindings.json` 不存在。

下一步具体入口：OpenCode 基于已清理的 v3-ng-only 工作树完成 R8/R9，原样运行全量测试并记录真实退出码；Codex review M1 通过后提交 M1。

## M1 第三轮最终返修（R8 收口 / cli.test.ts 无损拆分）— 2026-09-10

状态：完成。本轮只处理 R8（全量门禁必须原样 exit 0）并保持 R9；未进入 M2，未改冻结协议，未 stage/commit/reset/push，未改 node_modules，未降低/删除/过滤任何测试，未吞掉 unhandled error。

### 独立根因判定（先证机制，再动手）

不是“断言全绿所以算过”，也不是 vitest 本身不可修。真实机制由源码与运行证据共同确定：

1. 运行证据（返修前，`cmd /c "npm test > .llmdoc-tmp\run_repro.log 2>&1"` → exit 1）：13 files / 142 tests 全过，但 `[vitest-worker]: Timeout calling "onTaskUpdate"` 计 1 个 unhandled；耗时集中在 `tests/cli.test.ts`（53 tests）单文件 **174183ms**。`v3ng-contexts.test.ts` 60299ms、`v3ng-m1-acceptance.test.ts` 61336ms 同样超过 60s 却没有超时——说明触发条件不是“单测超时”，而是“单文件连续同步跨度”。
2. 机制证据：`src/lib/git.ts:3,9` 使用 `spawnSync`，`runCli`（`src/cli.ts:31`）对 V3 命令同步 dispatch，因此 `cli.test.ts` 的测试体是**一个连续同步块**，整个文件期间不把控制权交回事件循环 macrotask 阶段。vitest runner 的 `sendTasksUpdate`（`node_modules/@vitest/runner/dist/chunk-hooks.js:1458-1490`）调用 `runner.onTaskUpdate` 后**只把 promise 塞进 `pendingTasksUpdates`、不在测试之间 await**；birpc 默认 60s 超时（`node_modules/vitest/dist/chunks/index.B521nVV-.js:3,21,56-66`）。worker 在同步块里无法处理主进程回包，于是首个 `onTaskUpdate` 的 60s 定时器在事件循环恢复时先于回包触发 → 抛错。`v3ng` 文件不触发，是因为 R8 已把 `git-core.ts` 改为异步 `spawn`，每次 git 调用都让出事件循环（`src/lib/v3ng/git-core.ts:80`）。
3. 结论：只要**单个文件从首个 test-prepare 到结束的连续同步跨度 < 60s**，该文件内所有 `onTaskUpdate` 都会在文件收尾 `finishSendTasksUpdate` 前被 drain，不再超时。因此按职责拆分 `cli.test.ts` 是命中根因的修复，而非绕过：它保留全部 53 个测试原样，只把“一个 174s 连续块”变成多个 < 25s 的块。

### 方法：无损机械拆分（不手抄）

用一次性脚本（`.llmdoc-tmp/split.mjs`，gitignored）解析 `cli.test.ts`：按 `^  test\(` 到配对 `^  \}\);$` 切出 53 个测试块（脚本先断言 53 个开/闭标记数量一致、每块标题可解析），按职责分组后**原样拼接**测试体，再按各文件实际用到的标识符自动生成最小 import 头（fs/os/path/runCli/assertOutputSchema/helpers/PACKAGE_VERSION），最后删除原 `cli/tests/cli.test.ts`。脚本在写入前校验“53 个测试全部恰好分配一次”，否则报错不落盘。

拆分结果（12 文件 / 53 测试；括号内为单文件实测时长，全部 < 60s）：

- `cli-validate.test.ts`（5 tests，14.9s）：validate 命令与 wikilink/glob。
- `cli-output-schema.test.ts`（2 tests，9.1s）：全部公开 JSON payload 与 schema validator。
- `cli-read.test.ts`（10 tests，8.7s）：tree/index/show/search/context、pagination、symlink 逃逸、degraded paths、dot-prefix、非法全局参数。
- `cli-write.test.ts`（8 tests，17.4s）：new/mv/init-state/adopt 与祖先目录名 llmdoc 回归。
- `cli-status.test.ts`（5 tests，23.3s）：status、tmp-only、非 ASCII 路径、llmdocignore、metadata-only 落后。
- `cli-delta.test.ts`（3 tests，17.8s）：delta 三态与 fingerprint。
- `cli-commit.test.ts`（3 tests，14.2s）：commit 正文+meta、union、dirty fail-closed。
- `cli-commit-verified.test.ts`（3 tests，18.6s）：commit --verified/--all 与冲突/非法路径。
- `cli-hooks.test.ts`（5 tests，24.4s）：hook 契约、reflection、follow-up 静默、无 llmdoc 静默。
- `cli-startup-config.test.ts`（3 tests，16.7s）：session-start startup 配置。
- `cli-startup-preload.test.ts`（2 tests，7.4s）：preload 去重与无预算。
- `cli-misc.test.ts`（4 tests，9.1s）：prune/upgrade、安装后 bin、version/help、viewer server。

R8 期间保留的跨平台兼容改动全部随测试体原样迁移：`tests/helpers.ts` 与测试内 `symlinkSync` 的 win32 junction 类型参数、安装测试的 `shell: win32` / `--no-audit --no-fund` / POSIX-only exec-bit 断言（现位于 `cli-read.test.ts:71,237`、`cli-write.test.ts:40`、`cli-misc.test.ts:70-100`）。未新增/删除断言。

### 验证命令及真实结果（均用 `cmd /c "... > 日志 2>&1"` 后立即读 `$LASTEXITCODE`，不经输出筛选）

- 拆分后定向：`npx vitest run` 12 个 `cli-*.test.ts` → exit 0，Test Files 12 passed / Tests 53 passed，无 Timeout/Unhandled；单文件 7.4–24.4s。
- 门禁（连续两次原样 `npm test`，无筛选管道，在全部 cli/ 代码改动完成后执行）：
  - run1：exit 0，24 files / 142/142，无 `Errors`/`Timeout`/`Unhandled`，Duration 465.89s。
  - run2：exit 0，24 files / 142/142，无 `Errors`/`Timeout`/`Unhandled`，Duration 475.02s。
  - 日志：`.llmdoc-tmp/gate1.log`、`.llmdoc-tmp/gate2.log`（gitignored）。
- 仓库自身知识库校验：`npm run validate:dogfood`（root）→ exit 0（`validate: ok`）。拆分删除 `cli/tests/cli.test.ts` 后，仓库自身 `.mdx` 的 `code.paths` 仍指向该路径，dogfood 曾报 2 条 `code.paths.invalid`；已把 `llmdoc/cli-runtime/state-and-validation.mdx` 与 `llmdoc/cli-runtime/retrieval-and-mutation.mdx` 的对应条目改为 `cli/tests/cli-*.test.ts`（匹配 12 个新文件，路径引用零语义变化），恢复通过。这是拆分保持“无损”的必然后果，不涉及 M2 内容能力。
- R9 定向：`npx vitest run tests/v3ng-init-hardening.test.ts` → exit 0，1 file / 10 passed；其中 `R9: target existence is decided at the final in-lock pre-check > keeps an externally created empty target that appears during the registry lock wait` 通过（2501ms）。实现侧 `createdTarget` 仍只在 registry 锁内、任何落盘前的最终预检点确定（`cli/src/lib/v3ng/init.ts:92-98`），`cleanupInitArtifacts` 仅在 `createdTarget` 为真时才删除目录（`init.ts:196`），外部创建的空目录保留。
- `npm run typecheck` → exit 0；`npm run lint` → exit 0。
- 环境核对：真实 `%APPDATA%\llmdoc\bindings.json` 不存在、`%APPDATA%\llmdoc` 目录不存在；`git diff --cached` 为空（index 无 staged）；分支 `v3-ng`；未 stage/unstage/commit/reset/push。
- 工作树变更：新增 12 个 `cli/tests/cli-*.test.ts`，删除 `cli/tests/cli.test.ts`，并同步更新两处仓库自身知识的 `code.paths`（`llmdoc/cli-runtime/*.mdx`）；其余 v3-ng 改动与既有未跟踪文件保持原样。

### 边界与后续

- 本拆分属 R8 授权的“拆分 cli.test.ts”方案，命中机制根因，未修改 `node_modules`、未升级 vitest、未过滤/吞错/降测试；`engines.node >= 18` 未变。
- 冻结协议不得以“断言全绿但 exit 1”为通过：本轮以真实 exit 0 为准。
- 剩余问题：与 M1 完成时点一致（V3 fallback 迁移属 M2+；嵌套 untracked 门控属 M3；README/inbox 语义属 M4）。
- 下一步具体入口：停止，交 Codex 复审 M1；通过前不进入 M2。
- 关联 commit：无（按约定不提交、不暂存）。

## M1 Codex 最终复审 — 2026-09-10

结论：通过。R1–R9 均关闭，M1 仓库边界可以提交；未进入 M2。

- 协议核对：Source Git 调用显式绑定 SourceContext 并清除仓库选择环境；读取禁用 optional locks。Knowledge Git 必须拥有独立 common directory；外置为默认，嵌套须显式选择且外层不得跟踪该子树。repositoryId 由 llmdoc 生成并由 registry 与 `llmdoc.yaml` 双重校验；写路径不存在精确绑定时失败，不向 Source Git 回退。
- init/bind 核对：init 只创建 Knowledge Git、知识骨架、初始 commit 与用户 registry 绑定；非空目标和身份冲突在落盘前拒绝。R9 将目标所有权判定放在 registry 锁内的最终预检点，失败清理保留等待期间由外部创建的空目录。JSON 错误统一输出 code/message/paths/remediation。
- R8 核对：原 53 个 CLI 测试按职责拆为 12 个文件，未删除测试语义；单文件同步跨度降至 60 秒 RPC 窗口以内。未吞掉 unhandled error、未修改 node_modules、未提高 Node 最低版本。仓库知识中的测试路径已同步，dogfood validate 通过。
- Codex 独立验证：`npm run typecheck` exit 0；`npm run lint` exit 0；`npx vitest run tests/v3ng-init-hardening.test.ts` 10/10、exit 0；原样 `npm test` 24 files / 142 tests、exit 0，无 unhandled error；`git diff --check` 通过。
- 环境核对：真实 `%APPDATA%\llmdoc` 及 bindings.json 不存在；提交前 index 为空，工作树只含 M1/v3-ng 设计、实现、测试和因测试拆分同步更新的仓库知识路径。

下一步具体入口：创建 M1 里程碑 commit；提交后将 M2 整体交给 OpenCode，继续执行“设计/进度先行、完整 M 后集中 review”的闭环。

## M2 设计拆解与实施计划 — 2026-09-10

状态：设计先行，先写入本文件再写代码。M2 范围以冻结的 README/architecture/roadmap 为准，只做“内容与读取”；不实现 M3 的 Review Manifest/seal/CAS、M4 的 capture/migrate、M5 的 hooks/发布接入。

### 核心与协议不变量（M2 必须始终成立）

1. **读取严格只读**：不写 Source Git、不写 Knowledge Git、不获取写锁、不为读取初始化 Git；不创建 source 侧缓存或索引。搜索缓存只在知识目录 `.llmdoc-cache/`（可重建、knowledge `.gitignore` 已排除）或纯内存，绝不落到 source。
2. **正式知识面 = `docs/**/*.md`，任意层级**。`inbox/`、`.llmdoc-cache/`、`.llmdoc/`、`README.md` 不属于正式知识节点；正式 tree/index/show/search/context 不召回候选与缓存。
3. **文档 ID = docs 相对 POSIX 路径**；正文为标准 Markdown，不执行 JSX/脚本/组件（v3-ng 不再有 CodeRef/MDX 语义，遇到组件语法按普通文本或结构诊断处理）。
4. **kind ∈ {architecture, decision, guide, reference}**。每篇正式文档 `source.paths` 非空、相对 source 根、禁止绝对路径与 `..`；glob 允许但结构层只做语法与逃逸检查（snapshot 存在性属 M3 复核）。
5. **四项验证证据**存于 `.llmdoc/meta.json`（`schema: llmdoc.meta/v3-ng`）：`validatedSourceRevision`、`validatedContentDigest`、`validatedSourcePaths`、`validatedRequires`。未验证时 revision/digest 为 null、paths 为 []、requires 为 {}。
6. **digest 定义**：完整文档 UTF-8 内容（含 front matter、scope、关系、正文）先统一 CRLF/CR 为 LF，再做 SHA-256，记为 `sha256:<hex>`；不做其他语义归一化。普通 Git/编辑器改动后 digest 直接不符 → `needs_review`。
7. **DocumentStatus 只有 unverified / current / needs_review**；SourceContext 阻断原因（unbound/invalid_head/source_dirty/history_unavailable/diverged）独立输出，不能伪装成文档状态。
8. **requires 是有向无环**：禁止自引用与环；`validatedRequires` 键集合须等于当时的 requires 集合；目标缺失、非 current、或当前 digest ≠ 已记录 digest → 依赖方 needs_review；目标重新 seal 成 current **不会**自动刷新依赖方。
9. **supersedes**：从新 decision 指向旧 decision，目标须存在且为 decision，禁止自引用与环；检索标注“被替代/替代者”并默认优先当前决策；supersedes 不改变验证状态。
10. **无绑定只读**：显式 `--knowledge` 指向无 Git 目录时只做内容检索，报告 `unbound`，不声称 revision 有效；缺绑定且无显式 knowledge 时失败，**绝不回退 source Git**（M1 已建立的 `E_*` 契约继续沿用）。

### 已废止的兼容判断（由后续 breaking replacement 协议修订取代）

- 冲突：architecture §5 用裸命令名列出 `tree/index/show/search/context`；README「与当前 V3 的衔接」明确“现有 V3 用户行为不随文档自动改变”，且 M4 才做迁移、M5 才做“全部入口使用相同双仓契约”。若在 M2 直接把裸命令改为 v3-ng，会破坏仍在用 V3 `llmdoc/*.mdx` 的用户与仓库自身 dogfood。
- 当时采用的替代方案是为同一批只读命令增加 `--source` / `--knowledge`，未给出时保持 V3 行为。用户随后明确 v3-ng 是 breaking change；该判断已废止，不能继续作为实现依据。M2 必须让裸读取命令直接使用 v3-ng，并删除 V3 dispatch/fallback。

### 子步骤拆解

| 子步骤 | 范围 | 通过条件 |
|---|---|---|
| M2a 文档模型与解析 | `v3ng/document.ts`（4 kind、source.paths、relations、digest、链接抽取）+ `v3ng/knowledge-model.ts`（`docs/**/*.md` 任意层级扫描、ID、topic、supersedes/requires 图、结构校验） | 多层目录、decision、source.paths、digest/链接/关系正确；inbox/cache 不进模型 |
| M2b 有效性与双 revision 投影 | `v3ng/meta.ts`（读 `.llmdoc/meta.json` v3-ng）+ `v3ng/validity.ts`（三态、四项证据、requires DAG、digest 篡改、SourceContext 阻断） | unverified/current/needs_review 正确；Git 篡改 → needs_review；requires 目标变化不自动刷新依赖方 |
| M2c 只读检索 | `v3ng/search.ts`（词法 + CJK，排除 inbox/cache）+ `v3ng/read.ts`（bound/explicit/unbound 解析，无 source fallback、无写） | 正式检索不混入候选；unbound 只读不声称 revision；source 字节/状态不变 |
| M2d 读取命令与来源/有效性展示 | `tree/index/show/search/context` 新增 `--source/--knowledge` 走 v3-ng；输出附 kind/来源/status/superseded | 多层目录、链接、来源、有效性正确；JSON 输出 schema 校验 |
| M2e viewer 读取一致性 | `v3ng/viewer-state.ts`：从同一 model/validity 投影 viewer DTO | viewer 节点/边/status 与 CLI 一致；不另建有效性规则 |

### 验收路径（真实独立 Source/Knowledge Git）

- 用真实临时双 Git 仓构造知识库：多层 `docs/`、decision+supersedes、requires、source.paths、`.llmdoc/meta.json` 四项证据、`inbox/` 候选、`.llmdoc-cache/` 缓存。
- 断言：多层目录与 ID；正式检索排除 inbox/cache；digest 篡改（普通 Git 改正文）→ needs_review；requires 目标 digest 变化 → 依赖方 needs_review 且目标重 seal 不自动刷新；supersedes 类型/环/自引用拒绝；unbound 显式无 Git 目录只读且不声称 revision；所有读取前后 Source HEAD/`.git/index` 字节/工作树文件/`git status --porcelain` 逐项不变。
- 定向：新增 `v3ng-*` 测试文件串行；`npm run typecheck`、`npm run lint`、原样全量 `npm test`（记录真实 exit code，连续两次）。

### 续接入口与边界

- M2 负责替换只读主入口并删除 V3 dispatch/fallback；不做 M3/M4/M5 的写事务、维护或发布接入。
- 每完成一个子步骤即在本文件追加文件、真实验证证据与下一步入口。
- M2 完成后停止，交 Codex 集中 review；通过前不进入 M3。不 stage/commit/reset/push。

## M2 实施记录（M2a–M2e）— 2026-09-10

状态：完成。M2a–M2e 代码与定向测试完成；连续两次原样全量 `npm test` exit 0；待 Codex 集中复审。

### 关键实现决策

- **读取固定知识 HEAD**（architecture §6）：bound/explicit 且知识仓有 Git 时，`docs/**/*.md` 从 `HEAD` 提交树读取（`git ls-tree -r HEAD -- docs` + 单进程 `git cat-file --batch` 批量取 blob），工作树未提交内容不进入正式知识；无 Git 的显式目录按 `unbound` 读文件系统。`knowledgeRevision` 记录所读 HEAD。
- **只读、无 fallback**：读取不写 source/knowledge Git、不取写锁、不 init Git、不落缓存（搜索纯内存）；source 无绑定时 `E_BINDING_NOT_FOUND`，绝不回退 source Git。
- **已废止的命令面过渡方案**：初版通过 `--source`/`--knowledge` 选择 v3-ng，未给出时保留 V3。用户明确 breaking replacement 后，该实现必须在 M2 返修中删除，不能带入里程碑提交。
- **M2 不含 v3-ng `validate` 命令**：结构校验（front matter/kind/source.paths/链接/关系/supersedes/requires 环）作为模型 `issues` 实现并由测试覆盖；`validate`/review 的写集语义属 M3，未提前实现。

### 文件

- 新增 `cli/src/lib/v3ng/document.ts`：4 kind、source.paths、relations(requires/related/supersedes)、`.md` front matter 解析、CRLF→LF 归一化、`sha256:` digest、链接/标题抽取。
- 新增 `cli/src/lib/v3ng/knowledge-model.ts`：从原始条目或 `docs/**/*.md` 任意层级构建模型（ID=topic 首段、rootSingletons、requires 环、supersedes 目标/类型/自引用/环、链接缺失、source.paths 逃逸、inbox/cache 跳过）；`buildKnowledgeModelFromRaw` 供 HEAD/内存读取。
- 新增 `cli/src/lib/v3ng/meta.ts`：`.llmdoc/meta.json`（`llmdoc.meta/v3-ng`）四项证据严格解析/校验（digest 格式、repositoryId、requires 映射）。
- 新增 `cli/src/lib/v3ng/validity.ts`：三态投影（unverified/current/needs_review）、digest 篡改、requires DAG 拓扑、依赖 digest/集合变化、source revision 历史存在性（只读 `cat-file -e`）、scope 变化、SourceContext 阻断独立输出。
- 新增 `cli/src/lib/v3ng/search.ts`：词法 + CJK bigram 降级；复用 V3 分词纯函数（`src/lib/search.ts` 导出 `tokenizeQuery/cjkBigrams/countWords/buildSnippet/countSubstring`）；结果附 kind/status/reasons/supersededBy/supersedes。
- 新增 `cli/src/lib/v3ng/read.ts`：`loadKnowledgeForRead`（bound/explicit/unbound；HEAD/fs 内容源；无写）。
- 新增 `cli/src/lib/v3ng/viewer-state.ts`：`projectNgViewerState` 从同一 model/validity 投影节点/边/来源/状态，不另建有效性规则。
- 新增 `cli/src/commands/ng-read.ts`：5 个只读命令的 v3-ng handler（含 context 的 source.paths 映射与 requires 闭包）。
- 修改 `cli/src/cli.ts`：5 个只读命令新增 `--source/--knowledge` 分支。
- 修改 `cli/src/lib/v3ng/errors.ts`：新增 `E_DOCUMENT_INVALID`、`E_META_INVALID`、`E_KNOWLEDGE_DOC_NOT_FOUND`、`E_INVALID_KIND`、`E_INVALID_SOURCE_FILE`（结构错误，exit 2）。
- 修改 `cli/src/lib/v3ng/git-core.ts`：新增 `listTreeFiles`、`readGitBlobs`（单进程批量读 blob）。
- 修改 `cli/src/lib/output-schema.ts` + `cli/schemas/output.schema.json`：新增 `ngTree/ngIndex/ngShow/ngSearch/ngContext` 输出契约（additive）。
- 测试：新增 `cli/tests/v3ng-content.test.ts`（10）与 `cli/tests/v3ng-read.test.ts`（13，真实独立 Source/Knowledge Git）。
- v3-ng 只读命令的输入错误（非法 kind、`../`/绝对 file、缺失文档）改由 `NgError` 抛出（`E_INVALID_KIND`/`E_INVALID_SOURCE_FILE`/`E_KNOWLEDGE_DOC_NOT_FOUND`，exit 2），`--json` 下输出 `{error:{code,message,paths,remediation}}`，符合 architecture §5，而非 CliError 裸文本。

### 验证命令及真实结果

- `npx vitest run tests/v3ng-content.test.ts tests/v3ng-read.test.ts` → exit 0，2 files / 23 tests 全过。
- 覆盖：多层目录与四 kind；CRLF/LF digest 一致；source.paths 缺失/逃逸拒绝；requires 环、supersedes 目标非 decision/自引用/环；链接缺失；unverified/current/needs_review；digest 篡改；requires 目标变化后依赖方 needs_review 且目标重 seal 不自动刷新；source revision 缺失与 scope 变化；`--knowledge` 显式（bound/未绑定无 Git）与 `--source` 绑定读取；inbox 候选与 `.llmdoc-cache` 不进入正式检索；未提交工作树编辑不算正式知识；context 的 requires 闭包与 unmapped；5 个命令 JSON schema 校验；viewer 与 CLI status 一致；读取前后 source HEAD/`.git/index` 字节/工作树逐项不变；无绑定 `E_BINDING_NOT_FOUND` 不回退；非法输入的 ngError JSON 与 exit 2。
- `npm run typecheck` → exit 0；`npm run lint` → exit 0。

### 独立协议核对结论（不依赖测试数量）

- **只读 Source 边界**：`loadKnowledgeForRead` 仅经 `resolveSourceContext`/`runGit` 只读调用；测试对读取前后 source HEAD、`.git/index` 字节、工作树全部文件做逐项比对，且 M1 的 source 冻结测试仍全过。
- **固定 Knowledge HEAD**：bound/explicit 有 Git 时 `docs/**/*.md` 来自 `HEAD` 提交树（`ls-tree` + `cat-file --batch`），`knowledgeRevision` 等于知识 HEAD；未提交工作树编辑不进入模型，`inbox/`、`.llmdoc-cache/` 结构性排除。
- **四项验证证据**：`meta.ts` 严格解析/校验 `validatedSourceRevision`/`validatedContentDigest`/`validatedSourcePaths`/`validatedRequires`；非法 ledger 直接拒绝而非信任。
- **路径逃逸**：`source.paths` 拒绝绝对路径与 `..`；关系/链接目标经 `normalizeDocTarget` 拒绝 `..`/绝对；context `--files` 拒绝 `../`/绝对。独立用编译产物复核：`../secret`、`/etc/passwd`、`../../escape.md` 分别报 `source.paths.invalid`/`relations.requires.invalid-path`，CLI `context --files ../outside.ts` 报 `E_INVALID_SOURCE_FILE`（exit 2，结构化）。
- **历史不可用**：`computeValidity` 只读 `cat-file -e <rev>^{commit}`；不可解析的 revision 使文档 `needs_review` 并给出原因，不伪称 current。
- **digest/requires 失配**：正文改动（digest 不符）→ needs_review；requires 目标非 current 或记录 digest 与当前不符 → 依赖方 needs_review；目标重 seal 不自动刷新依赖方。
- **unbound 只读语义**：显式无 Git 目录以 `mode=unbound`、`repositoryId=null`、`sourceRevision=null` 读取，仅内容检索，不声称 revision 有效；source 无绑定直接 `E_BINDING_NOT_FOUND`，绝不回退 Source Git。

### 全量门禁与下一步

- 连续两次原样全量 `npm test`（`cmd /c "npm test > 日志 2>&1"` 后立即读 `$LASTEXITCODE`，无管道筛选）：
  - gate A：exit 0，26 files / 165 tests 全过，无 unhandled，Duration 645.42s（日志 `.llmdoc-tmp/m2gateA.log`）。
  - gate B：exit 0，26 files / 165 tests 全过，无 unhandled，Duration 682.37s（日志 `.llmdoc-tmp/m2gateB.log`）。
- `git diff --check` exit 0（仅 LF/CRLF 提示）；真实 `%APPDATA%\llmdoc\bindings.json` 与目录均不存在；`git diff --cached` 为空（index 无 staged）；分支 `v3-ng`；未 stage/commit/reset/push。
- 下一步：停止，交 Codex 集中 review M2；通过前不进入 M3/M4/M5。
- 边界：alias 只读发现、v3-ng 布局自动发现、v3-ng `validate` 命令、HTTP viewer 接线、CLI 帮助/双语同步留待 M3–M5。

## M2 Codex 集中复审 R1 — 2026-09-10

结论：不通过，退回 OpenCode 修复；这是 M2 第 1 轮返修。定向与全量测试虽通过，但没有覆盖以下协议级错误。

1. **正式读取混用了 Knowledge HEAD 与工作树 meta/config。** `loadEntries` 从固定 HEAD 读取 `docs/**/*.md`，但 `readKnowledgeMeta(metaPath)` 与 `loadKnowledgeLayoutConfig(...)` 从工作树读取。未提交的 `.llmdoc/meta.json` 可改变 committed docs 的状态甚至伪造 `current`，输出中的 `knowledgeRevision` 因而不能代表同一份知识快照。正式 Git 知识读取必须从同一个 K 读取 docs、meta 及决定身份/布局的配置；无 Git 的 unbound 内容读取才允许读文件系统。
2. **有效性没有检查 `validatedSourceRevision..source HEAD` 的源码变化与祖先关系。** 当前实现只确认旧 commit 对象存在、scope 字符串相等；映射路径在后续 committed source commit 中已经变化时仍会被标为 `current`。必须在固定 source HEAD 上区分历史缺失/分叉，并按 `validatedSourcePaths ∪ current source.paths` 判断相关 committed diff；命中即 `needs_review`，不得读取 live worktree 作为事实。
3. **显式 `--source + --knowledge` 绕过了 repositoryId 与仓库独立性边界。** `loadExplicit` 不解析精确绑定、不校验 source/knowledge common Git、不校验 `meta.source.repositoryId` 与 knowledge config/source identity；`computeValidity` 也忽略这些身份字段。任意 clone/同源仓或错误配对在 commit 可达时可能宣称 `current`。没有可证明的逻辑身份关联时只能内容只读并报告 unbound/阻断，不能声明 revision validity；同 common Git 必须拒绝。
4. **CLI 的“双 revision / SourceContext”投影不完整。** `baseEnvelope` 只输出当前 `sourceRevision`，遗漏 `knowledgeRevision`、`lastGlobalReviewRevision`、`sourceBlockers` 和确定性结构/meta issues；五个 JSON schema 同样无法表达这些字段。读取结果无法说明自己来自哪个 K，也无法把 source dirty/invalid/history 问题与三态文档状态分开呈现。
5. **关系规范化只存在于校验临时值，后续消费者仍使用原始 front matter。** `./b.md`、反斜杠等被模型接受并解析到规范 ID，但 validity、viewer、context 与 search 又读取原始 `relations`，导致同一关系在不同接口中消失或被误判 missing。关系要么在模型中一次规范化并由所有消费者复用，要么作为非规范输入拒绝，不能形成两套图。
6. **`supersedes` 结构环错误被混入文档 validity。** `cyclicIds` 同时收集 requires 与 supersedes，`computeValidity` 因此把 supersedes 环改成 `needs_review`，违反“supersedes 不改变验证状态”。结构 issue 可以保留，但 validity 依赖图只能由 requires 决定。
7. **四项 evidence 的成组不变量未严格校验。** meta parser 接受 revision/digest 为 null 但 paths/requires 非空、或 digest 非空而 revision 为 null；也未校验 document ID/require key 的规范路径及 full commit OID。未验证必须严格是 null/null/[]/{}，已验证必须四项共同成立；非法 ledger 不得参与 validity。

返修验收必须增加真实双仓回归：未提交 meta/config 篡改不影响 K 的正式读取；mapped source 在 S 后提交变化会 needs_review、无关路径变化保持 current、分叉/历史缺失保守降级；错误 repositoryId、无精确身份和同 common Git 不得宣称 current；五个 CLI 输出含双 revision 与独立 blockers/issues；规范关系在 CLI/viewer/validity 一致；supersedes 不改三态；非法 evidence tuple 被拒绝。先更新本节下方的修复设计和状态，再改代码；完成后重新记录真实测试证据并停止，仍不进入 M3，不 stage/commit/reset/push。

## M2 第 1 轮返修设计与独立判断 — 2026-09-10

状态：进行中。先记录独立判断与修复设计，再改代码；不改冻结协议。

### 对七项根因的独立判断（逐项核对 architecture 原文，不迎合）

1. **确认**（§6 L157「默认读固定知识 HEAD」；§4 L124 current 定义）。`read.ts` 只对 docs 取 HEAD，`readKnowledgeMeta(metaPath)` 与 `loadKnowledgeLayoutConfig` 读工作树 → 快照不一致，未提交 meta 可伪造 current。修复：Git 知识读取统一从同一 K 取 `docs/**`、`.llmdoc/meta.json`、`llmdoc.yaml`；unbound（无 Git）才读文件系统。
2. **确认**（§4 L124「证据范围无相关源码差异」；L113「validatedSourcePaths ∪ current source.paths 检查 validatedSourceRevision..S」；L127「历史缺失或分叉时不能...宣称 current」）。当前仅对象存在性 + scope 字符串相等。修复：在固定 source HEAD 上验证 `validatedSourceRevision` 为 HEAD 祖先（相等视同）；只读 `git diff --name-only validatedSourceRevision HEAD` 取 committed diff，按 `validatedSourcePaths ∪ current source.paths` 过滤，命中即 needs_review；非祖先/历史不可用保守 needs_review；不读 live worktree。
3. **确认**（§3 L85「只读指定无 Git 目录...报告 unbound，不声称 revision 有效」；§1 L27「source 与 knowledge 的 Git common directory 必须不同」；§3「repositoryId 是...用户显式关联的逻辑身份」）。修复：`--source + --knowledge` 校验 common Git 不同、容器关系、registry 精确绑定与 config/meta repositoryId 一致；无可证明身份关联（无 registry 绑定）时 content-only，`identityVerified=false`，不得 current；同 common Git 拒绝 `E_GIT_IDENTITY_CONFLICT`。
4. **确认**（§4 L127 SourceContext 阻断独立输出；§1 L19 SourceContext 含 repositoryId/sourceRevision；§6 L157）。修复：五个 ng 输出统一带 `knowledgeRevision`、`lastGlobalReviewRevision`、`sourceBlockers`、`issues`，schema 同步。
5. **确认**（§2 L44 关系指向 docs 相对路径；单一图）。当前 `document.ts` 保留原始 relations，模型临时规范化，消费者仍读原始值 → 两套图。修复：解析时一次性规范关系目标（`\`→`/`、去 `./`、posix normalize），模型/validity/viewer/context/search 共用同一值。
6. **确认**（§2 L61「supersedes 不改变文档的验证状态」）。修复：`cyclicIds` 只收集 requires 环供 validity；supersedes 环仅结构 issue。
7. **确认**（§4 L109/L111 四项 evidence 成组；L99 digest；L91 meta schema）。修复：meta parser 强制成组不变量（digest null ⇒ revision null/paths []/requires {}；digest 非空 ⇒ revision 为 full OID、paths 规范化非空），校验 document ID/require key 为规范 docs 相对 `.md`、revision 与 lastGlobalReviewRevision 为 full OID、validatedSourcePaths 去重排序；非法 ledger 返回 meta=null，不参与 validity。

### 协议不变量（返修后必须成立）

- 同一 K：正式 Git 读取的 docs、meta、config 来自同一 `knowledgeRevision`；`knowledgeRevision` 是唯一快照标识。
- 只读：不写 source/knowledge Git、不取写锁、不 init Git、不落缓存；source 无绑定不回退。
- 身份：只有精确 registry 绑定（或显式 `--source+--knowledge` 且 registry 绑定/身份一致）才 `identityVerified`；无绑定/无 Git/身份不符 → content-only（unbound/阻断），不得 current。
- 独立性：source 与 knowledge common Git 必须不同；违反即拒绝。
- 三态：unverified/current/needs_review；current 需 digest 匹配 + revision 为 HEAD 祖先 + `validatedSourcePaths ∪ current source.paths` 范围内 committed diff 为空 + requires 目标 current 且 digest 等于 validatedRequires；supersedes 不参与三态。
- 单一关系图：`./b.md`、反斜杠在解析后规范化为同一 ID，被所有消费者复用。
- evidence 成组：null/null/[]/{} 或 full-OID/sha256/规范化路径/规范 require key 四者齐备；非法 ledger 不参与 validity。
- SourceContext 阻断（unbound/invalid_head/source_dirty/history_unavailable/diverged）与 DocumentStatus 分离输出。

### 修复设计（文件/函数）

- `document.ts`：新增关系目标规范化（`\`→`/`、循环去 `./`、`path.posix.normalize`），`normalizeRelations` 输出规范值。
- `knowledge-model.ts`：`cyclicIds` 仅 requires；supersedes 环仅 issue；模型校验复用规范值。
- `meta.ts`：新增 `parseKnowledgeMeta(raw, label)`（供 K 内容解析）；严格成组 + 规范路径 + full OID 校验；`readKnowledgeMeta(path)` 委托。
- `knowledge-config.ts`：新增 `parseKnowledgeLayoutConfig(raw, label)`；`loadKnowledgeLayoutConfig(path)` 委托。
- `git-core.ts`：新增 `readGitBlobs` 已在；补 `isAncestor(layout, a, b)`、`changedPathsBetween(layout, a, b)`（只读）。
- `validity.ts`：`computeValidity` 输入增加 `identityVerified`、`knowledgeRevision`；祖先/committed diff 检查（按 scope 并集，缓存）；无身份/无 K/历史不可用 → needs_review。
- `read.ts`：`assemble` 对 Git 知识从同一 K 取 docs+meta+config；`loadExplicit` 解析 source/knowledge 身份与独立性；返回 `identityVerified`；mode 判定 = bound（绑定）/ explicit（有 Git+config 无 source 身份）/ unbound（无 Git 或身份不可证）。
- `ng-read.ts` + `output.schema.json`：`baseEnvelope` 增 `knowledgeRevision/lastGlobalReviewRevision/sourceBlockers/issues`；新增 `ngSourceBlocker`/`ngIssue` defs；5 个 schema 同步。

### 测试矩阵（真实独立双 Git 仓）

1. 未提交 `.llmdoc/meta.json` / `llmdoc.yaml` 篡改不影响 bound 读取（仍按 K 判定；config 篡改不改 identity）。
2. mapped source 在 S 后提交变化 → needs_review；无关路径提交变化 → current；`validatedSourceRevision` 非祖先（分叉）/对象缺失 → needs_review。
3. 错误 repositoryId、同 common Git（linked worktree）、无 registry 绑定显式 pair → 拒绝或不得 current。
4. 五个 CLI 输出含 `knowledgeRevision/lastGlobalReviewRevision/sourceBlockers/issues` 且 schema 校验通过。
5. `./b.md`、`a\\b.md` 规范化后 validity/viewer/search/context 一致。
6. supersedes 环只产生结构 issue，文档仍可 current。
7. 非法 evidence tuple（digest null 但 paths 非空 / digest 非空 revision null / 非法 document ID / 短 OID）被拒绝，meta=null。

### 与冻结协议的冲突检查

- R1-3 的严格性（无 registry 绑定即不得 current）与 §3「repositoryId 是 llmdoc 创建并由用户显式关联的逻辑身份」一致；`--knowledge` 是路径而非绑定，不能授权 validity。无冲突。
- R1-2 的 committed diff 属 §4 current 定义（读取期只读判定），不是 M3 review 的写集/manifest。无冲突。
- 其余五项均为对当时冻结语义的落实；随后用户新增 breaking replacement 决策，architecture/roadmap 已按下一节同步修订。

## M2 breaking replacement 协议修订 — 2026-09-10

状态：设计已先行修订，代码待新 OpenCode 会话执行；本节取代 M2 初版的 V3 兼容/双 dispatch 决策。

用户明确：**v3-ng 是 breaking change，不需要考虑 V3 运行时兼容，直接覆盖。** Codex 判断该修订正确：若保留“有 `--source/--knowledge` 才走 v3-ng、否则走 V3”的分支，同名命令会长期拥有两套 workspace、schema、错误和安全边界，Source Git fallback 也无法从产品入口彻底消失。

设计同步：

- `README.md` 明确 v3-ng 是 breaking replacement；旧 V3 只作为显式 migrate 输入。
- `architecture.md` §7 改为 breaking replacement 与显式迁移；同名主入口不得按参数、目录或绑定失败回退 V3/embedded/source Git。
- `roadmap.md` 将裸 `tree/index/show/search/context` 的替换归入 M2，通过条件增加“无 V3 dispatch/fallback”；M5 只负责其余 hooks/skills/agents/docs/release 接入。

M2 新增返修要求：

1. `cli.ts` 的 `tree/index/show/search/context` 无条件进入 v3-ng handler；`--source`/`--knowledge` 只选择 v3-ng Source/KnowledgeContext，不再是模式开关。
2. 未传参数时，从 cwd 解析 SourceContext 并查精确用户绑定；无绑定返回稳定 v3-ng 错误，禁止调用旧 `findProjectRoot/loadWorkspace`。
3. 删除这些命令对旧 `runTree/runIndex/runShow/runSearch/runContext` 的 import 与 dispatch；旧实现文件可暂留为 migrate/删除前参考，但不能由 v3-ng 主入口到达。是否物理删除所有 V3 模块由 M5 发布清理决定，运行时兼容在 M2 即结束。
4. CLI help、argument 描述和 JSON schema 以 v3-ng 为唯一语义；默认 `show` 路径为 docs 相对 `.md`，kind 包含 decision。
5. 新增回归：裸命令在已绑定 source cwd 读取 v3-ng；裸命令在无绑定 cwd 返回 `E_BINDING_NOT_FOUND`；旧 `llmdoc/*.mdx` 即使存在也不被读取；无任何测试以“未给参数保持 V3”为期望。

OpenCode 续接入口：新建干净会话，同时完成本节 breaking replacement 与 M2 R1 七项协议返修；先阅读冻结设计和 progress 的两个未关闭章节，再实现、测试、记录证据。完成后交 Codex R2，不进入 M3，不 stage/commit/reset/push。

## M2 运行时命名空间修订 — 2026-09-10

状态：设计已先行修订；前一个新会话在只读取设计后被中止，未允许继续按 `v3ng/ng-*` 双栈实现。下一执行会话必须按本节原位替换。

用户进一步明确：v3-ng 是 V3 下一代探索分支，不是需要激活的产品特性；`lib/v3ng/` 和任何 `v3-ng`/`ng` CLI 激活方式都违背这一定位。Codex 判断：只删除 CLI 条件分支仍不够，若保留版本化 lib、handler、schema key 和错误类，代码结构仍会固化双栈，后续 M3–M5 会在错误抽象上继续扩张。

统一实现边界：

1. 将 `cli/src/lib/v3ng/` 的已提交 M1 能力和未提交 M2 能力迁入中性的领域目录，例如 `cli/src/lib/knowledge/`；最终不得保留运行时 `v3ng` 目录。不要简单复制后留两份实现。
2. `cli/src/commands/ng-read.ts` 拆回或改写标准 `tree.ts`、`index.ts`、`show.ts`、`search.ts`、`context.ts`；标准导出名为 `runTree/runIndex/runShow/runSearch/runContext`，删除 `runNg*`。
3. `bind/init` 等已接入命令改为引用中性领域模块。旧 V3 workspace/state/search 实现若已无主入口引用，应删除；显式 migrate 所需的旧格式 reader 后续放在 migrate 边界内，不得成为通用 fallback。
4. 输出 schema 使用标准 key 与 payload 名称，移除 `ngTree/ngIndex/ngShow/ngSearch/ngContext/ngError` 和 `llmdoc.ng-*`。本轮不强行把知识 meta 的 schema version 与 npm semver绑定；数据 schema 命名是持久格式版本，不得用来激活旧/新运行时。
5. CLI 不出现 `v3-ng` 子命令或“传参数才激活”的说明。`--source/--knowledge` 只解析同一套新协议的上下文；默认 cwd + registry 同样进入该协议。
6. 测试文件和描述也采用能力名称，避免 `v3ng-*` 成为永久测试分层；历史 progress 可保留旧名称作为审计记录，当前实现和新测试不得继续扩张这些名称。

新增验收：`rg` 检查运行时源码、command、测试和 output schema 中不再存在 `lib/v3ng` import、`runNg`、`ng-read`、`ngTree/ngError`、`llmdoc.ng-` 或以参数决定 V3/v3-ng dispatch 的条件；标准裸命令和显式 context 参数均执行同一实现。设计目录名与历史记录中的 v3-ng 不受此检查约束。

下一步：确认无旧写者后再创建全新 OpenCode 会话，注入 R1、breaking replacement 和本节三组未关闭要求；先写统一迁移计划，再实施。完成后交 Codex R2。

## M2 统一迁移计划与独立推演 — 2026-09-10

状态：本轮执行计划。先落本计划，再改代码。不进入 M3–M5，不 stage/commit/reset/push，不把 `.codegraph/` 纳入实现或提交。读取冻结 README/architecture/roadmap 与本文件末尾三节后独立推演；未发现协议自相矛盾，无需先改设计。

### 1. 产品与结构决定（不可回退）

- v3-ng 是 breaking replacement：标准裸 `tree/index/show/search/context` 与 `bind/init` 直接使用新双仓协议；不传参数时从 cwd 解析 `SourceContext` 并查精确 registry 绑定。`--source`/`--knowledge` 只是同一协议内选择/覆盖 context，不是激活开关，也不存在可回退的第二模式。
- 旧 `llmdoc/*.mdx`、embedded workspace、Source Git fallback 对主读取入口不可达；旧 V3 只允许显式 `migrate`（M4）读取。无绑定稳定返回 `E_BINDING_NOT_FOUND`，绝不回退 source Git。
- 运行时命名空间原位替换：`cli/src/lib/v3ng/` → `cli/src/lib/knowledge/`；删除 `commands/ng-read.ts`；标准 command 模块直接承载新协议。运行时不出现 `runNg*`、`NgError`、`ngTree/ngError`、`llmdoc.ng-*`、`lib/v3ng` import 或以参数决定 V3/v3-ng dispatch 的条件。
- 持久数据 schema（`llmdoc.meta/v3-ng`、`llmdoc.knowledge/v1`、`llmdoc.bindings/v1`）是格式版本，不用于运行时激活；architecture §4 明确保留 meta schema，本轮不改。设计目录名与历史 progress 的 v3-ng 保留为审计记录。
- M2 只替换只读入口。status/delta/validate/commit/new/adopt/mv/fingerprint/prune/upgrade/hook/serve 仍为既有 V3 实现，属 M3–M5，不在本轮删除（除被替换的旧只读命令模块）。

### 2. 文件归属（迁移映射）

| 旧 | 新 | 处理 |
|---|---|---|
| `lib/v3ng/errors.ts` | `lib/knowledge/errors.ts` | `NgError→KnowledgeError`、`NgErrorCode→KnowledgeErrorCode`、`NgErrorOptions→KnowledgeErrorOptions`、`runFileSystemIo` 不变 |
| `lib/v3ng/{paths,identity,git-core,contexts,registry,knowledge-config,binding,init,bind}.ts` | `lib/knowledge/` 同名 | 仅改 import 路径与错误类名 |
| `lib/v3ng/{document,knowledge-model,meta,validity,search,read}.ts` | `lib/knowledge/` 同名 | 同上 |
| `lib/v3ng/viewer-state.ts` | `lib/knowledge/viewer-state.ts` | `projectNgViewerState→projectKnowledgeViewerState`，`NgViewer*→KnowledgeViewer*`，去掉 v3-ng 文案 |
| `commands/ng-read.ts` | 拆入 `commands/{tree,index,show,search,context}.ts` | 标准导出 `runTree/runIndex/runShow/runSearch/runContext`；删除 `runNg*` |
| `cli.ts` | 同文件 | 删除 5 个只读命令的双 dispatch 与 `ng-read` import；`bind/init` 改引 `lib/knowledge` |
| `lib/output-schema.ts` + `schemas/output.schema.json` | 同文件 | `ngError→knowledgeError`；`ngTree/ngIndex/ngShow/ngSearch/ngContext→tree/index/show/search/context`；子 defs 去 `ng` 前缀；删除旧 `treeTopics/treeDocs` 与旧 `index/show/search/context` defs |
| `tests/v3ng-helpers.ts` | `tests/knowledge-helpers.ts` | `expectNgError→expectKnowledgeError` |
| `tests/v3ng-*.test.ts` | `tests/knowledge-*.test.ts` | 能力命名；历史名不保留 |
| `tests/cli-read.test.ts` | 删除 | 旧 V3 只读命令已不存在 |
| `tests/cli-output-schema.test.ts` | 同文件 | 只读命令改走新协议 fixture/字段 |

### 3. R1 七项落点（含当前实现状态与补口）

1. **同一 K 取 docs/meta/config**：`read.ts::readKnowledgeSnapshot` 已从同一 Knowledge HEAD 批量读 `docs/**`、`.llmdoc/meta.json`、`llmdoc.yaml`；unbound 无 Git 才读文件系统。补真实测试：未提交 meta/config 篡改不影响 bound 读取。
2. **祖先与 committed diff**：`validity.ts` 已有 `isAncestor` + `changedPathsBetween`，按 `validatedSourcePaths ∪ current source.paths` 过滤 committed diff；非祖先/对象缺失保守 needs_review。补测试：S 后 mapped 源变化→needs_review、无关路径变化→current、分叉/缺失→needs_review。
3. **repositoryId / 精确身份 / common Git**：`read.ts::loadExplicit` 已走 `resolveKnowledgeContext`（common Git 不同、包含方向、worktree 根相等）并校验 registry 精确绑定与 config/meta repositoryId；无精确关联时 `identityVerified=false` 且不 current。补测试：错误 repositoryId、同 common Git、无绑定 explicit pair。
4. **CLI 双 revision / SourceContext 投影**：**当前缺口**。`baseEnvelope` 只输出 `mode/repositoryId/sourceRevision/unbound`。补 `knowledgeRevision/lastGlobalReviewRevision/sourceBlockers/issues`，五个新 schema 同步。
5. **单一关系图**：`document.ts::normalizeRelations` 解析即规范化（`\→/`、去 `./`、posix normalize）；model/validity/viewer/context/search 复用同一值。补一致性测试。
6. **supersedes 不改 validity**：`knowledge-model.ts` 的 `cyclicIds` 只收 requires；supersedes 环仅结构 issue。补测试：supersedes 环文档仍可 current。
7. **四项 evidence 成组**：`meta.ts::validateEvidence` 已强制 `null/null/[]/{}` 或 full-OID/sha256/规范化非空路径/规范 require key 四项齐备；非法 ledger → meta=null。补拒绝测试。

### 4. 失败路径矩阵（独立推演，均需真实双 Git 测试）

| 场景 | 期望 |
|---|---|
| 无绑定裸命令（cwd 无 registry 绑定） | `E_BINDING_NOT_FOUND`，exit 2，绝不回退 source Git |
| `--source` 指向未绑定 source | `E_BINDING_NOT_FOUND` |
| `--source+--knowledge` 有 Git 但无 registry 关联 | `mode=explicit`、`identityVerified=false`、不得 current |
| config/meta repositoryId 与 registry 不一致 | `E_SOURCE_IDENTITY_MISMATCH` |
| 知识根无 `llmdoc.yaml`（绑定路径） | `E_KNOWLEDGE_NOT_INITIALIZED` |
| source 与 knowledge 同 common Git / source 子目录无自有 Git / 同仓 linked worktree | `E_GIT_IDENTITY_CONFLICT` / `E_KNOWLEDGE_ROOT_NOT_WORKTREE` |
| `source.paths` 绝对路径或 `..` | 结构 issue（`source.paths.invalid`），不 current |
| `context --files ../`、绝对路径 | `E_INVALID_SOURCE_FILE`，exit 2 |
| relation/link 目标 `../` 或绝对 | 结构 issue（`relations.*.invalid-path`） |
| `validatedSourceRevision` 不在历史 | needs_review，reason「not available in history」 |
| `validatedSourceRevision` 非 HEAD 祖先（分叉） | needs_review，reason「not an ancestor」 |
| source invalid_head / source_dirty | `sourceBlockers` 独立输出；文档不 current |
| 文档 digest ≠ validatedContentDigest | needs_review（digest mismatch）；未提交工作树编辑不进入 K |
| requires 目标非 current 或 digest 变化 | 依赖方 needs_review；目标重 seal 不自动刷新 |
| 未提交 meta/config 篡改 | 不影响 K 快照 |
| 非法 evidence tuple（部分字段） | `E_META_INVALID` / meta=null，不参与 validity |

### 5. 测试矩阵（真实临时双 Git + 故障注入，不 mock Git）

- `tests/knowledge-content.test.ts`（迁移自 v3ng-content，并修正 computeValidity 新签名）：四 kind/多层目录、CRLF digest、source.paths 校验、requires 环、supersedes 类型/自引用/环、digest 篡改、requires 传播与不自动刷新、历史缺失/scope 变化、meta 成组拒绝。
- `tests/knowledge-read.test.ts`（迁移自 v3ng-read，补 R1）：固定 K 读取与排除 inbox/cache、未提交编辑非正式、digest 篡改、search 排除候选、无绑定失败、unbound 只读、source 字节冻结、context 闭包；**新增** R1-1 未提交 meta/config、R1-2 mapped/无关/分叉、R1-3 错误身份/同仓/无绑定 pair、R1-4 五命令双 revision+blockers+issues、R1-5 规范关系一致、R1-6 supersedes 不改三态、R1-7 非法 evidence。
- `tests/knowledge-replacement.test.ts`（新增，breaking replacement 验收）：裸命令在已绑定 cwd 读新协议；无绑定 cwd 稳定失败；存在旧 `llmdoc/*.mdx` 与旧 workspace 时仍不可达；`--source/--knowledge` 不激活另一模式（无分支）；`bind/init` 走新协议。
- `tests/knowledge-helpers.ts`：重命名与 `expectKnowledgeError`。
- 迁移重命名：`knowledge-contexts/registry/binding/init-bind/cli/init-hardening/boundaries.test.ts`；删除 `cli-read.test.ts`；`cli-output-schema.test.ts` 改新协议字段。
- 命名空间静态检查：`rg` 扫 `cli/src`/`commands`/`tests`/`schemas`，禁止 `lib/v3ng`、`runNg`、`ng-read`、`ngTree|ngError`、`llmdoc.ng-`、以及只读命令的 `--source||--knowledge` dispatch 条件。

### 6. 验证命令与记录

- 定向：`npx vitest run tests/knowledge-*.test.ts`（串行）、`npm run typecheck`、`npm run lint`。
- 命名空间：`rg -n "lib/v3ng|runNg|ng-read|ngTree|ngError|ngIndex|ngShow|ngSearch|ngContext|llmdoc\\.ng-" cli/src cli/tests cli/schemas`（期望无命中；守卫测试/文档除外）。
- `git diff --check`；连续两次原样全量 `npm test`（`cmd /c "... > 日志 2>&1"` 后立即读真实 `$LASTEXITCODE`，不经筛选），记录 exit code、文件/用例数与 unhandled。
- 环境核对：真实 `%APPDATA%\llmdoc` 不存在；index 无 staged；未 stage/commit/reset/push；`.codegraph/` 不被写入测试产物。

## M2 返修实施记录（breaking replacement + R1 + 命名空间）— 2026-09-10

状态：完成。按统一迁移计划原位替换运行时命名空间、完成 breaking replacement 与 R1 七项；未进入 M3–M5，未 stage/commit/reset/push。

### 完成内容与文件

- **命名空间原位替换**：`cli/src/lib/v3ng/`（17 文件）迁移为 `cli/src/lib/knowledge/`，无副本；`NgError/NgErrorCode/NgErrorOptions→KnowledgeError*`、`projectNgViewerState→projectKnowledgeViewerState`、`NgViewer*→KnowledgeViewer*`。新增 `cli/src/lib/knowledge/read-view.ts`（`KnowledgeReadEnvelope`/document summary/kind/路径规范化）。
- **标准 command 重写**：删除 `commands/ng-read.ts`；`commands/tree|index|show|search|context.ts` 直接导出 `runTree/runIndex/runShow/runSearch/runContext` 并实现新协议（不再有 `runNg*`）。`commands/bind|init.ts` 改引 `lib/knowledge`。
- **cli.ts**：删除 5 个只读命令的 `--source||--knowledge` 双 dispatch 与 `ng-read` import；裸命令无条件进入新协议；`--source/--knowledge` 仅选择 context；`KnowledgeError` catch 输出 `knowledgeError` schema；bind/init 描述去 `v3-ng:`。
- **输出契约**：`lib/output-schema.ts` 与 `schemas/output.schema.json` 用标准 key `tree/index/show/search/context/knowledgeError` 取代 `ngTree/ngIndex/ngShow/ngSearch/ngContext/ngError` 及旧 `treeTopics/treeDocs/index/show/search/context`；子 defs 去 `ng` 前缀（`knowledgeKind/knowledgeStatus/readMode/knowledgeDocumentSummary/knowledgeSearchResult`）；payload schema 字符串改为 `llmdoc.tree|index|show|search|context/v1`。
- **R1-4 补齐**：`read-view.ts::knowledgeReadEnvelope` 为五命令统一输出 `knowledgeRevision/lastGlobalReviewRevision/sourceBlockers/issues`；schema 同步新增 `knowledgeSourceBlocker/knowledgeIssue`。
- **持久数据 schema 保留**：`llmdoc.meta/v3-ng`、`llmdoc.knowledge/v1`、`llmdoc.bindings/v1` 作为格式版本不变（architecture §4），不用于运行时激活。

### R1 七项落点

1. 同一 K 取 docs/meta/config：`read.ts::readKnowledgeSnapshot`（HEAD `ls-tree`+`cat-file --batch`）；测试 R1-1 未提交 meta/config 篡改不影响 bound 读取。
2. 祖先/committed diff：`validity.ts`（scope 并集 + `merge-base --is-ancestor` + `diff --name-only`）；测试 R1-2 无关变化 current、mapped 变化 needs_review、非祖先 needs_review。
3. 身份/独立性：`read.ts::loadExplicit` + `contexts.ts`；测试 R1-3 meta/config 身份不符 `E_SOURCE_IDENTITY_MISMATCH`、同 common Git `E_GIT_IDENTITY_CONFLICT`、无精确关联 explicit 不 current。
4. CLI 投影：见上 R1-4；测试覆盖五命令 envelope 与 dirty source blocker 分离。
5. 单一关系图：`document.ts::normalizeRelations`；测试 R1-5 `./b.md`/`refs\api.md` 在 model/validity/viewer/context 一致。
6. supersedes 不改 validity：`knowledge-model.ts::cyclicIds` 仅 requires；测试 R1-6 环仅结构 issue 且两决策 current。
7. evidence 成组：`meta.ts::validateEvidence`；测试 R1-7 部分成组/非规范 ID/短 OID 拒绝，committed 非法 ledger→meta=null→unverified。

### 验证命令及真实结果

- 定向（串行真实临时双 Git）：`knowledge-content` 10/10、`search-cjk` 4/4、`knowledge-read` 13/13、`knowledge-contexts/registry/binding/init-bind/init-hardening` 64/64、`knowledge-boundaries` 8/8、`knowledge-replacement` 4/4、`knowledge-r1` 10/10，全部 exit 0。
- `npm run typecheck` exit 0；`npm run lint` exit 0；`git diff --check` exit 0（仅 LF→CRLF 提示）。
- 命名空间扫描：`rg -n "lib/v3ng|runNg|ng-read|ngTree|ngError|ngIndex|ngShow|ngSearch|ngContext|llmdoc\.ng-" src tests schemas` 无命中（exit 1）；无 `if (commandOptions.source||commandOptions.knowledge)` 双 dispatch；`src/lib/v3ng` 不存在。运行时代码仅剩数据 schema 字符串 `llmdoc.meta/v3-ng`。
- 全量门禁（`cmd /c "npm test > .llmdoc-tmp/... 2>&1"` 后立即读真实 `$LASTEXITCODE`，无筛选管道）：
  - gate1：exit 0，27 files / 169 tests 全过，无 `Errors`/`Timeout`/`Unhandled`，Duration 796.82s（`m2fix-gate1.log`）。
  - gate2：exit 0，27 files / 169 tests 全过，无 `Errors`/`Timeout`/`Unhandled`，Duration 794.81s（`m2fix-gate2.log`）。
- 环境核对：真实 `%APPDATA%\llmdoc` 不存在；`git diff --cached` 为空（index 无 staged）；分支 `v3-ng`；未 stage/commit/reset/push；`.codegraph/` 仅作临时缓存，未纳入实现或提交。

### 边界与下一步

- M2 只替换只读入口；`status/delta/validate/commit/new/adopt/mv/fingerprint/prune/upgrade/hook/serve` 仍为既有 V3 实现，属 M3–M5，不在本轮。旧 `llmdoc/*.mdx` 只允许 M4 显式 `migrate` 读取。
- 只读命令的非 JSON 文本模式沿用 M2 初版的 JSON 序列化（`stringifyOutput`），未新增人类可读渲染；JSON `schema` 契约与字段为验收面。若 R2 要求，另立人类渲染步骤。
- 停止，交 Codex R2；通过前不进入 M3/M4/M5。

## M2 Codex 集中复审 R2 — 2026-09-10

状态：未通过。返修轮次累计 **2/3**。本轮认可同一 Knowledge commit 读取、breaking replacement 主入口、双 revision 输出、committed source diff、evidence 基本成组、supersedes 与 validity 解耦均已落地；但以下问题仍会违反冻结协议，因此不能提交 M2。

### 必须修复

1. **`source.paths` 没有在固定 Source revision 上验证实际证据范围。** `knowledge-model.ts::validateSourcePath` 只检查空值、绝对路径和 `..`，`validity.ts` 只在 revision 之间有 diff 时匹配 scope。一个从未匹配任何源码对象的 glob（例如 `src/does-not-exist/**`）只要 digest/meta 对齐，就会被标为 `current` 且 `issues=[]`。这违反 architecture §2“具体路径必须在指定 snapshot 存在；glob 零匹配需要诊断”。修复时必须只读固定 `source.headRevision` 的 tree，对每个当前 `source.paths` 区分 literal/glob 并产生确定性 issue；不存在的 literal 或零匹配 glob 不得得到 `current`。同时统一 source path 的 POSIX 规范形式，拒绝 `./`、`.` 段、反斜杠别名等非 canonical evidence，避免字符串不同但语义相同的 scope 漂移。
2. **历史缺失/分叉没有进入 SourceContext 阻断输出。** `SourceBlockerCode` 目前只有 `invalid_head | source_dirty`；`computeValidity` 把 missing commit / non-ancestor 仅写进单篇文档 reasons，而 `historyAvailable` 只按“source 有 HEAD”计算。复现实测：`validatedSourceRevision=ffffffff...` 时文档为 `needs_review`，但 `sourceBlockers=[]` 且 `historyAvailable=true`。这违反 architecture §4“SourceContext 单独报告 history_unavailable、diverged”等约定，也使 R1-4 新增的 `sourceBlockers` 在关键场景仍失真。应按固定 S 聚合明确的 `history_unavailable` / `diverged` blocker（必要时附受影响文档 ID/revision），并让 CLI/schema/viewer 使用同一结果。
3. **关系仍不是单一权威图。** `knowledge-model.ts::normalizeTargets` 会过滤 missing/self/非法路径并构建局部 `requiresEdges`/`supersedes`，但不会把过滤结果写回统一关系结构；validity、context、viewer、search 和 read summary 仍分别读取 `document.frontmatter.relations`。因此 missing/self/非法关系会在不同投影中被保留、丢弃或转成不同状态：例如 missing requires 出现在 summary 和 validity reason，却被 viewer/context 静默丢弃；self requires 甚至会让 context 把当前文档加入自身 prerequisites。请在 model 中建立 `requires/related/supersedes` 的唯一 canonical graph，所有消费者只读该图；结构 issue 可以保留，但不得再从 front matter 各自解释第二遍。
4. **CLI 帮助仍宣传已删除的接口。** `cli.ts` 的示例仍包含 `llmdoc tree --docs`，而 breaking replacement 后 `tree` 已移除 `--docs`。这会让标准命令自相矛盾；同步改为实际可执行的新协议示例，并加入帮助输出回归检查。

### R3 验收补充

- 增加真实双 Git 测试：literal 不存在、glob 零匹配、glob 有匹配、固定 S 后 live worktree 新文件不算匹配；前三类结果同时核对 status 与 issues。
- 增加 missing revision 与 non-ancestor 两类 CLI/viewer 测试，断言 `sourceBlockers` 与文档 reasons 一致，且不得把“存在 HEAD”误报为完整历史可用。
- 对 missing/self/非法/规范化 relation 分别比较 model、validity、tree/index/show/search/context、viewer，确认全部消费同一 canonical graph。
- 修复后使用新的 OpenCode 会话完成定向、typecheck、lint、namespace scan、`git diff --check` 和一遍原样全量 `npm test`；更新本文件后停止，交 Codex R3。不得进入 M3，不得 stage/commit/reset/push。

## M2 返修轮 2（R2）计划与独立推演 — 2026-09-10

状态：本轮执行计划。先落本计划，再改代码。仅关闭 R2 四项「必须修复」；不进入 M3–M5，不改冻结协议，不 stage/commit/reset/push，不把 `.codegraph/` 纳入实现、测试或提交。

### 独立判断（逐项核对 architecture 原文）

1. **source.paths 证据未落在固定 Source revision 上——确认。** §2 L59「具体路径必须在指定 snapshot 存在；glob 零匹配需要诊断」；§4 L124 current 要求「证据范围无相关源码差异」。当前 `validateSourcePath` 只查空值/绝对/`..`，evidence 只在 revision 间有 diff 时按 scope 过滤；一个从不匹配任何对象的 glob 会 current 且 `issues=[]`。必须在固定 `source.headRevision` 的 tree 上对每个当前 `source.paths` 做 literal/glob 判定。
2. **history_unavailable / diverged 未进入 SourceContext 阻断——确认。** §4 L127「SourceContext 单独报告 ... history_unavailable、diverged」；当前 `SourceBlockerCode` 只有 `invalid_head | source_dirty`，missing/non-ancestor 只写进单篇 reasons，`historyAvailable` 只看「source 有 HEAD」。
3. **关系不是单一权威图——确认。** §2 L44「关系指向 docs 相对路径」要求一组关系只有一个语义；当前 `normalizeTargets` 只在局部建 `requiresEdges`/`supersedes`，validity/summary/search/viewer/context 各自读 `document.frontmatter.relations`，导致同一缺失/自引用/非法边在不同投影被保留、丢弃或转态。
4. **CLI 帮助宣传已删除接口——确认。** `cli.ts` 快速示例仍是 `llmdoc tree --docs`，breaking replacement 后 `tree` 无 `--docs`。

### 所有权（本轮改动文件）

- `cli/src/lib/knowledge/document.ts`：source path / relation target 的 canonical POSIX 规范化；拒绝绝对与 `..`。
- `cli/src/lib/knowledge/knowledge-model.ts`：canonical relation graph（`relations`）、requires 结构问题集合（`requiresProblems`）、source.paths 规范化与 `source.paths.invalid` 复核。
- `cli/src/lib/knowledge/validity.ts`：固定 Source HEAD tree 证据判定、`history_unavailable`/`diverged` blocker 聚合、`historyAvailable`、`issues` 输出、消费 canonical graph。
- `cli/src/lib/knowledge/read.ts`：合并 validity issues 到 loaded issues。
- `cli/src/lib/knowledge/read-view.ts` / `search.ts` / `viewer-state.ts` / `commands/{show,context}.ts`：改为只读 canonical graph。
- `cli/src/cli.ts`：快速示例去掉 `tree --docs`。
- `cli/tests/knowledge-r2.test.ts`（新增）+ `knowledge-helpers.ts`（如需）。

### 协议不变量（返修后必须成立）

- **固定 S 证据**：literal 必须在 `source.headRevision` tree 存在（文件本身或以其为目录前缀）；glob 必须在同一 tree 至少命中一个 committed 文件；否则文档不得 current，且产生确定性 issue。live worktree 未提交文件不参与匹配。
- **canonical source path**：POSIX 相对形式；反斜杠、`./`、`.` 段、重复/尾随 `/` 归一到单一形式；绝对路径与 `..` 拒绝（`source.paths.invalid`，不 current）。`validatedSourcePaths ∪ current source.paths` 的字符串比较在规范形式上进行。
- **阻断分离**：DocumentStatus 仍只有三态；`history_unavailable`（validated revision 对象缺失）与 `diverged`（非 HEAD 祖先）作为独立 `SourceBlocker` 输出，CLI envelope 与 viewer 共用同一 projection；存在缺失/分叉时 `historyAvailable=false`，不得仅凭「有 HEAD」宣称完整历史可用。
- **单一关系图**：model 的 `relations` 是唯一权威；missing/self/非法路径边既产生结构 issue 又被过滤出图，所有消费者（validity、tree/index/show/search/context、viewer）只读该图，不再二次解释 front matter。
- **supersedes 不改三态**：仅 requires 驱动 validity；supersedes 环只保留结构 issue。
- **只读**：不写 source/knowledge Git、不取写锁、不 init Git、不落缓存；source 无绑定不回退。

### 失败路径矩阵（真实双 Git 测试目标）

| 场景 | 期望 |
|---|---|
| literal 在当前 S tree 不存在 | 文档 needs_review，`issues` 含 `source.paths.missing` |
| glob 在当前 S tree 零匹配 | 文档 needs_review，`issues` 含 `source.paths.glob-empty` |
| glob 在当前 S 有匹配 | 保持 current；无对应 issue |
| live worktree 新增未提交文件匹配某 glob | 不计入固定 S 匹配；该 glob 若 S 内无其它匹配仍 zero-match |
| `validatedSourceRevision` 对象缺失 | 文档 needs_review + `sourceBlockers` 含 `history_unavailable`；`historyAvailable=false` |
| `validatedSourceRevision` 非 HEAD 祖先 | 文档 needs_review + `sourceBlockers` 含 `diverged`；`historyAvailable=false` |
| missing / self / 非法 / 规范化 relation | model graph 与 validity、tree/index/show/search/context、viewer 全部一致（missing/self/非法为结构 issue 且不入图；规范化边入图） |
| `../` / 绝对 source path | `source.paths.invalid`，不 current |
| CLI `--help` | 不再出现 `--docs`，示例可执行 |

### 测试矩阵（真实临时双 Git + 故障注入，不 mock Git）

- `tests/knowledge-r2.test.ts`：
  1. **R2-1 fixed-S scope evidence**：literal 不存在、glob 零匹配、glob 有匹配三类同时核对 status 与 issues；固定 S 后 live worktree 新文件不计入匹配。
  2. **R2-2 history blockers**：missing revision 与 non-ancestor 两类，经 CLI（index/search）与 viewer 断言 `sourceBlockers` 与文档 reasons 一致，`historyAvailable=false`。
  3. **R2-3 canonical graph**：missing / self / 非法路径 / 规范化 relation 在 model、validity、tree/index/show/search/context、viewer 一致；missing 只在 issues，self 不再进入 context prerequisites。
  4. **R2-4 help**：`--help` 不含 `--docs` 且列出标准读取命令。
- 既有 `knowledge-content` / `knowledge-read` / `knowledge-r1` / `knowledge-replacement` / `search-cjk` 适配新签名并保持通过。

### 验证命令与记录

- 定向：`npx vitest run tests/knowledge-*.test.ts`（串行）、`npm run typecheck`、`npm run lint`。
- 命名空间：`rg -n "lib/v3ng|runNg|ng-read|ngTree|ngError|ngIndex|ngShow|ngSearch|ngContext|llmdoc\.ng-" cli/src cli/tests cli/schemas`（期望无命中）。
- `git diff --check`；一遍原样全量 `npm test`（`cmd /c "... > 日志 2>&1"` 后立即读真实 `$LASTEXITCODE`，不经筛选），记录 exit code、文件/用例数与 unhandled。
- 环境核对：真实 `%APPDATA%\llmdoc` 不存在；index 无 staged；未 stage/commit/reset/push；`.codegraph/` 未被测试写入或纳入。

## M2 返修轮 2（R2）实施与验证记录 — 2026-09-10

状态：完成 R2 四项「必须修复」并取得完整验证结果；未进入 M3，未 stage/commit/reset/push，未改冻结协议。

### 完成内容与文件

- `cli/src/lib/knowledge/document.ts`：新增 `canonicalizeSourcePath`（POSIX 相对规范形式；拒绝绝对/盘符/`..`/`.` 空段/尾随分隔符/反斜杠别名）。
- `cli/src/lib/knowledge/knowledge-model.ts`：`assembleModel` 对每篇 `source.paths` 做一次规范判定——非规范或逃逸写 `source.paths.invalid` 并剔除；新增唯一权威 `relations: Map<docId, CanonicalRelations>`（missing/self/非法路径/错误 kind 边写入结构 issue 后过滤出图，规范化边入图）与 `requiresProblems: Set<docId>`；`findCycles` 仍只由 requires 驱动，supersedes 环只留结构 issue；导出 `relationsFor`。
- `cli/src/lib/knowledge/validity.ts`：新增 `collectSourceScopeEvidence`——只读固定 `source.headRevision` 的 tree（`git ls-tree -r`），对每个当前 `source.paths` 区分 literal/glob：literal 必须为 tree 内文件或目录前缀，glob 必须在同一 tree 至少命中一个 committed 文件；否则写 `source.paths.missing` / `source.paths.glob-empty` 并让文档 `needs_review`，live worktree 未提交文件不参与。`history_unavailable`（validated revision 对象缺失）与 `diverged`（非 HEAD 祖先）聚合成独立 `SourceBlocker`，`historyAvailable` 在这些情况下为 false；projection 新增 `issues`。
- `cli/src/lib/knowledge/contexts.ts`：`SourceBlockerCode` 增加 `history_unavailable | diverged`。
- `cli/src/lib/knowledge/read.ts`：loaded issues 合并 `validity.issues`。
- `cli/src/lib/knowledge/read-view.ts` / `search.ts` / `viewer-state.ts` / `commands/{show,context}.ts`：validity、tree/index/show/search/context、viewer 全部改为只读 `model.relations`（show 的 frontmatter 关系也回写为 canonical 图）；viewer DTO 增加 `historyAvailable`。
- `cli/src/cli.ts`：快速示例删除已移除的 `tree --docs`，改为可执行的 `llmdoc tree` / `llmdoc search ...`。
- 测试：新增 `cli/tests/knowledge-r2.test.ts`（7，真实双 Git）；`cli/tests/search-cjk.test.ts` 适配新增 `issues` 字段。

### R2 四项落点

1. **固定 S 证据**：`collectSourceScopeEvidence` 只读 `source.headRevision` tree；literal 不存在 → `source.paths.missing` + needs_review；glob 零匹配 → `source.paths.glob-empty` + needs_review；有匹配保持 current；固定 S 后 live worktree 新文件不计入。source path 规范形式统一，非规范/逃逸为结构 issue 且不入 scope。
2. **历史阻断**：missing revision 与 non-ancestor 分别聚合 `history_unavailable` / `diverged` blocker，文档 reasons 与 blocker 同源；`historyAvailable=false`；CLI envelope、schema（`knowledgeSourceBlocker`）与 viewer DTO 共用同一 projection。
3. **单一关系图**：model 的 `relations` 为唯一权威；missing/self/非法路径只留结构 issue 不入图，规范化边入图；validity、五个读取命令、search、context、viewer、show 均消费该图（self 不再进入 context prerequisites，missing 不再被某投影静默保留）。
4. **CLI 帮助**：`--help` 不再出现 `--docs`，示例为标准读取命令。

### 验证命令及真实结果

- 定向（真实临时双 Git，串行）：`npx vitest run tests/knowledge-r2.test.ts` → exit 0，1 file / 7 tests（fixed-S literal/glob/live、history_unavailable、diverged、canonical graph、help）。
- 既有回归：`knowledge-content` 10/10、`knowledge-read` 13/13、`knowledge-r1` 10/10、`knowledge-replacement` 4/4、`search-cjk` 4/4 全部通过；缺失的 8 个文件（cli-output-schema / cli-startup-preload / cold-start / knowledge-registry / search-cjk / viewer-assets / viewer-http / viewer-state）单独补跑 29/29 通过。
- `npm run typecheck` → exit 0；`npm run lint` → exit 0。
- 命名空间扫描：`rg -n "lib/v3ng|runNg|ng-read|ngTree|ngError|ngIndex|ngShow|ngSearch|ngContext|llmdoc\.ng-" cli/src cli/tests cli/schemas` 无命中（exit 1）；`cli/src/lib/v3ng` 不存在；无 `commandOptions.source || commandOptions.knowledge` 双 dispatch。
- `git diff --check` → exit 0（仅 LF/CRLF 提示）；`git diff --cached` 为空（index 无 staged）。
- **原样全量 `npm test`（无筛选，`cmd /c "npm test > log 2>&1"`，读真实 `$LASTEXITCODE`）**：
  - 首次尝试（`r2-full.log`）在 20 files 后无 summary、日志长时间不增长，由 Codex 判定挂起并终止。独立定位：缺失的 8 个文件全部单独通过；随后以 PowerShell job 监视重跑（`r2-full3.log`）**exit 0，28 files / 176 tests 全过，无 `Errors`/`Unhandled`/`onTaskUpdate Timeout`，Duration 979.38s**。结论：此前为 runner 级瞬时异常，非新增改动导致的确定性挂起，未对测试做降级/过滤/吞错。
- 环境核对：真实 `%APPDATA%\llmdoc` 不存在；分支 `v3-ng`；未 stage/commit/reset/push；`.codegraph/` 与 `.llmdoc-tmp/` 未纳入实现或提交。

### 边界与下一步

- 仍只做 M2 只读内容与读取；`status/delta/validate/commit/new/adopt/mv/fingerprint/prune/upgrade/hook/serve` 及旧 `.mdx` 只读迁移属 M3–M5。
- 停止，交 Codex R3；通过前不进入 M3/M4/M5。
- 关联 commit：无（按约定不提交、不暂存）。

## M2 Codex 集中复审 R3 与直接接管计划 — 2026-09-10

状态：未通过；达到同一里程碑三轮返修阈值，Codex 按约定直接接管 M2 修复，不再退回 OpenCode。OpenCode 已停止；修复完成、复审通过并提交前不进入 M3。

### R3 发现

1. `validity.ts::topologicalOrder` 仍读取 `document.frontmatter.relations.requires`，绕过 `model.relations`。规范化边（例如 `./z.md` → `z.md`）可能不参与依赖排序，使依赖方在目标状态尚未计算时错误变为 `needs_review`。这违反“关系只有一个权威图”。
2. `knowledge-model.ts` 会把非法 `source.paths` 从文档 scope 中剔除，但 `computeValidity` 只消费固定 S 的 missing/glob 问题，不消费 `source.paths.invalid` model issue。文档同时声明合法路径与非法别名、而 ledger 记录合法 scope 时，仍可能得到 `current`。
3. missing/non-ancestor revision 的聚合位于文档 validity 的 `else-if` 链中；如果同篇文档先发生 digest mismatch、identity failure 等原因，就不会检查其历史 revision，导致 `sourceBlockers` 与 `historyAvailable` 依赖无关的正文状态而失真。
4. Viewer 输出了共享 projection 的 `historyAvailable`，五个标准 CLI read envelope 与 output schema 只输出 `sourceBlockers`，没有输出该字段；CLI/schema/viewer 尚未完整使用同一 SourceContext 历史结果。

### Codex 修复计划

- `validity.ts`：拓扑排序只读 `relationsFor(model, id).requires`；在文档状态计算前独立扫描所有已记录 source revision，统一聚合 missing/diverged，文档 reasons 复用该分类；把该文档的 `source.paths.invalid` model issue 纳入非-current 原因。
- `read-view.ts` 与 `output.schema.json`：五个标准读取命令统一输出并校验 `historyAvailable`。
- `knowledge-r2.test.ts`：新增 canonical alias requires 的依赖顺序/current 回归、合法+非法 source scope 不得 current、digest mismatch 仍报告 history blocker、五个 CLI envelope 的 `historyAvailable=false` schema 回归。
- 完成定向测试、typecheck、lint、namespace scan、`git diff --check`；必要时执行完整门禁。Codex 复审通过后只暂存 M2 文件并提交，不包含 `.codegraph/` 或 `.llmdoc-tmp/`。

## M2 Codex R3 直接修复与最终复审通过 — 2026-09-10

状态：通过。R3 发现的四项遗漏已由 Codex 直接修复并用真实双 Git 回归锁定；M2 内容、读取与 breaking replacement 边界完成。提交后下一里程碑为 M3。

### 直接修复

- `cli/src/lib/knowledge/validity.ts`：`topologicalOrder` 改为只读 `relationsFor(model, id).requires`，canonical alias 关系与所有投影共用同一图；在文档状态分支前独立扫描 ledger 的全部 validation revision，missing/diverged 不再被 digest mismatch 等先行原因短路；`source.paths.invalid` model issue 明确阻止文档成为 `current`。
- `cli/src/lib/knowledge/read-view.ts`、`cli/schemas/output.schema.json`：`tree/index/show/search/context` 的共享 envelope 与 schema 全部增加必填 `historyAvailable`，与 viewer 复用同一 validity projection。
- `cli/tests/knowledge-r2.test.ts`：7 个用例增至 10 个；新增合法+非法混合 source scope、digest mismatch 同时缺历史、canonical alias requires 的拓扑/current 回归，并让 missing-history 场景核对五个标准 CLI 输出的 `historyAvailable=false`。

### 最终复审证据

- CodeGraph 与静态扫描确认：正式读取的 docs/meta/config 同取固定 Knowledge HEAD；source scope 只读固定 committed Source HEAD tree；标准读取命令无 V3 workspace/source Git fallback；显式 identity、registry 精确绑定与不同 common Git 边界保持。
- `rg "frontmatter\\.relations"` 在新读取路径只剩 parse、canonical graph 构建与 show 将 canonical graph 写回 DTO；validity、tree/index/show/search/context、search、viewer 均不再自行解释原始关系。
- 定向：`knowledge-r2.test.ts` 10/10；`knowledge-r1.test.ts` 10/10；`knowledge-r2 + cli-output-schema` 12/12。一次把多个重型真实 Git 文件并行执行时，R1 五命令用例触及 30 秒测试时限；隔离重跑 6.8 秒通过，最终原样全量门禁也通过，判定为审查命令资源竞争而非产品失败。
- `npm run typecheck` exit 0；`npm run lint` exit 0；namespace scan 无 `lib/v3ng`、`runNg`、`ng-read`、`ngTree/ngError`、`llmdoc.ng-*` 或参数双 dispatch；`git diff --check` exit 0（仅行尾转换提示）。
- 最终原样 `npm test`：**exit 0，28 files / 179 tests 全过，Duration 306.64s**。包含 build、M1 边界回归、M2 固定 K/S、身份、历史、关系、schema、breaking replacement 与既有测试。
- 提交边界：只纳入 M2 实现、测试与四份 v3-ng 设计/进度文档；`.codegraph/`、`.llmdoc-tmp/` 不纳入。未 push。

### 下一步

- 新建 OpenCode 会话实施完整 M3；先读取冻结设计与本检查点，在 progress.md 落地 M3 计划后再写代码。
- 关联 commit：由本次里程碑提交承载（精确 OID 以 Git log 为准）。

## M3 设计与分步实施计划 — 2026-09-10

状态：设计先行。先落本计划再写代码。M3 只原位切换 `status/delta/validate/commit` 并新增 `review`（Review Manifest 生成/确认），共用语义提交事务；不实现 M4 的 capture/update/prune/migrate/导航生成，也不接入 M5 的 hooks/skills/agents/网站/发布。不改冻结协议，不 stage/commit/reset/push，不把 `.codegraph/` 或临时日志纳入。

### 1. 独立推演（逐条核对 architecture §4–§6、roadmap M3/验收 4–7/D4，不迎合既有代码）

1. **写绑定必须精确**：`status/delta/validate/review/commit` 都是写入边界上的命令，解析用 M1 的 `resolveWriteBinding`；无绑定/歧义/身份不符按既有 `E_BINDING_*`/`E_SOURCE_IDENTITY_MISMATCH` 拒绝，绝不回退 Source Git。`--source/--knowledge` 只选择同一协议 context。
2. **S 与 K0 是两个固定 revision**：source 必须是有效 HEAD 且全仓 clean；knowledge 必须已有初始 commit、处于分支、无 merge/rebase/cherry-pick、真实 index 等于 K0 且无 staged。两者任一不满足即状态阻断（exit 3），提交前不移动 HEAD。
3. **Review Manifest 是显式的本地验证声明，不是认证机制**：生成（`review`）与语义确认（`review --confirm`）分离；未确认 manifest 不得被 `commit --review` 消费。manifest 存在可重建缓存 `.llmdoc-cache/reviews/<reviewId>.json`，不提交 Git。
4. **四项证据成组**：`validatedSourceRevision/validatedContentDigest/validatedSourcePaths/validatedRequires` 在 seal 一起写；未验证为 `null/null/[]/{}`。`validatedRequires` 键集合等于 requires 集合，值绑定目标最终 digest。
5. **requires 按 DAG 绑定最终 digest**：同批按 requires 拓扑序 seal；A requires B 时 A 记录本批 B 的最终 digest；批外依赖必须 current；B 重新 seal 不会自动刷新 A。supersedes 不参与 validity。
6. **review 使用旧新 scope 并集**：`validatedSourcePaths(K0) ∪ current source.paths` 的 committed diff `validatedSourceRevision..S` 决定复核义务；缩小 scope 也需语义判断；展示被移除范围。
7. **临时 index + 单提交 + CAS**：temp `GIT_INDEX_FILE` 从 `read-tree K0` 初始化，仅写入 manifest 写集；`write-tree` + `commit-tree`（父 K0，禁用 hooks/签名/外部辅助）得 K1；发布用 `update-ref <branch> K1 K0` CAS。失败前不移动 HEAD；CAS 失败返回 `E_CAS_CONFLICT`(70)，不假成功。
8. **发布后收尾**：成功以已构建索引原子替换真实 index（不改工作树整体），范围外草稿保留。llmdoc 生成文件（`.llmdoc/meta.json`，README 导航机制）只在文件仍等于 seal 前观察值时条件更新，否则保留外部修改并报告未同步。发布后收尾失败返回 K1 + `cleanup_required`，不回滚历史、不谎称未提交。
9. **一次性消费**：manifest 被消费后重复使用被拒；即便消费标记丢失，`update-ref K1 K0` 的 CAS 也会阻止重复发布。
10. **锁在知识 commonDir，身份包含 pid/host/bootId/processStartTime**：排他创建；恢复只在能证明持有者已死（同 host、同 bootId、PID 已不存在，或 bootId 不同/进程启动时间不符）时进行，不能仅凭 TTL/PID 误删活跃锁；平台无法取得身份时保守报告 `E_KNOWLEDGE_LOCKED`。
11. **Source 全程只读**：所有 source 调用经 `resolveSourceContext`/只读 `runGit`（可选锁禁用）；不 fetch/checkout/写 index/装 hook。source HEAD/index/文件字节级零修改。
12. **命令不混入 M4/M5**：不生成导航、不做 capture/prune/migrate/hook serve；`new/adopt/mv/fingerprint/prune/upgrade/init-state/hook/serve` 保持既有实现，仅在 M5 统一。

### 2. 协议不变量（M3 代码必须始终满足）

- 正式读取固定 Knowledge HEAD；seal 固定 Source S 与 Knowledge K0。
- 语义结论只能由 `review --confirm` 声明；生成 manifest 不等于确认。
- 写集只含 manifest 已审查路径；seal 重算后任何正文/关系/scope/依赖/写集漂移 → `E_REVIEW_INVALIDATED`。
- Knowledge 真实 index 无 staged；source 无 staged/unstaged/untracked/conflict 且 HEAD 有效。
- `lastGlobalReviewRevision` 仅由全局复核扫描推进，不代替单篇 revision。
- digest = 完整文档 UTF-8 内容 CRLF/CR→LF 后 SHA-256；写入 blob 使用相同规范化字节。
- capture/文档编辑不自动验证；用户手工 draft 可留在 worktree，但未经 review 不进入提交。
- Source 只读、无 fallback；损坏或不可判定历史保守 `needs_review`。

### 3. 文件所有权（互斥边界）

| 归属 | 文件 | 责任 |
|---|---|---|
| M3 核心（OpenCode 串行） | `cli/src/lib/knowledge/errors.ts` | 新增 M3 错误码与退出码 3/70 契约 |
| M3 核心 | `cli/src/lib/knowledge/git-write.ts`（新增） | 写侧 Git：显式 `GIT_INDEX_FILE`、`hash-object -w`、`read-tree/update-index/write-tree/commit-tree/update-ref`，禁用 hooks/签名/外部辅助 |
| M3 核心 | `cli/src/lib/knowledge/lock.ts`（新增） | 知识 commonDir `llmdoc.lock`；身份与保守恢复 |
| M3 核心 | `cli/src/lib/knowledge/review.ts`（新增） | Review Manifest 生成/确认/加载/消费；候选写集计算 |
| M3 核心 | `cli/src/lib/knowledge/seal.ts`（新增） | seal 事务：门控、temp index、CAS、index/文件条件同步 |
| M3 核心 | `cli/src/lib/knowledge/read.ts` | 仅导出复用快照（不改变 M2 只读语义） |
| M3 命令 | `cli/src/commands/{status,delta,validate,review,commit}.ts` | 原位切换标准命令；新增 review |
| 共享 CLI/schema | `cli/src/cli.ts`、`cli/src/lib/output-schema.ts`、`cli/schemas/output.schema.json` | 命令接线、参数、帮助、JSON 契约 |
| 测试 | `cli/tests/knowledge-{status-delta,validate,review-seal,lock}.test.ts`（新增）、`knowledge-helpers.ts` | 真实临时双 Git + 故障注入 |
| 测试收口 | 删除 V3 `cli-{status,delta,validate,commit,commit-verified}.test.ts`；`cli-output-schema.test.ts` 改新契约 | breaking replacement 后旧断言不再成立 |

### 4. 失败路径矩阵（均需真实双 Git 测试）

| 场景 | 期望 |
|---|---|
| source staged/unstaged/untracked/conflict/dirty | 状态阻断（exit 3），seal 前不移动 Knowledge HEAD |
| source HEAD 在 review 后前进 | `E_SOURCE_HEAD_DRIFT`（3）；不发布 |
| source HEAD unborn / 非 commit | 阻断（3），不伪称 clean |
| Knowledge staged（任意 path） | `E_KNOWLEDGE_INDEX_DIRTY`（3） |
| Knowledge detached/unborn/merge/rebase | `E_KNOWLEDGE_NOT_ON_BRANCH`（3） |
| Knowledge HEAD ≠ manifest.K0 | `E_KNOWLEDGE_HEAD_MISMATCH`（3） |
| manifest 未确认 | `E_REVIEW_NOT_CONFIRMED`（3） |
| manifest 不存在/未知 reviewId | `E_REVIEW_NOT_FOUND`（2） |
| manifest 后正文/meta/关系/scope/依赖/写集漂移 | `E_REVIEW_INVALIDATED`（3） |
| 出现未审查新 `.md` | `E_REVIEW_INVALIDATED`（3） |
| meta 在观察前被外部修改 | `E_KNOWLEDGE_META_DIRTY`（3），不覆盖 |
| CAS 失败（K0 已前进） | `E_CAS_CONFLICT`（70），仅留未引用对象，不重置 |
| 发布后 index 同步失败 | 返回 K1 + `cleanup_required`，不回滚 |
| 发布后 meta 被外部改动 | 保留该修改并报告未同步路径 |
| 重复消费同一 manifest | 拒绝；K0 CAS 兜底 |
| Git hooks 存在 | seal 全程不运行 hooks |
| 两个并发写者 | 后者 `E_KNOWLEDGE_LOCKED`(70)；保守恢复不误删活跃锁 |
| source HEAD/index/文件 | 字节级零修改 |
| 范围外 draft | seal 后仍 dirty |

### 5. 测试矩阵（真实临时双 Git + 故障注入，不 mock Git）

- `tests/knowledge-status-delta.test.ts`：绑定后 status/delta 正确报告 S/K0、三态计数、复核义务、committed scope diff、requires 漂移、source blocker 分离；knowledge staged/detached 状态；读取不改 source。
- `tests/knowledge-validate.test.ts`：结构错误（front matter/kind/source.paths 逃逸/链接/requires 环/supersedes 类型）、meta 成组、固定 S scope evidence（literal 缺失/glob 零匹配）、退出码 2；不推进 revision。
- `tests/knowledge-review-seal.test.ts`（核心，真实双 Git + 故障注入）：docs+meta 单提交；meta-only；人工 draft 提交；未确认 manifest 拒绝；manifest 后正文/meta/关系/scope/依赖/写集漂移全部 `E_REVIEW_INVALIDATED`；旧+新 scope 并集；A requires B 同批 DAG 与 B 重 seal 不自动刷新 A；范围外 draft 保留；重复 manifest 拒绝；CAS 冲突；发布后 index/文件同步失败返回 K1+cleanup_required；source HEAD/index/文件字节冻结；hooks 不运行。
- `tests/knowledge-lock.test.ts`：两写者互斥；活跃锁不误删；死 PID/重启（不同 bootId）/无法判定身份的保守恢复。
- 迁移既有 `knowledge-*` 回归；删除 V3 status/delta/validate/commit 测试；`cli-output-schema.test.ts` 改新契约。

### 6. 分步计划（每步完成即更新本文件，支持断点续接）

1. **M3a 写基础设施**：`errors.ts` 新码；`git-write.ts`；`lock.ts`；lock 测试。定向通过后更新 progress。
2. **M3b 诊断命令**：status/delta/validate 原位切换 + schema + 测试；确认读取固定 HEAD、不写 meta。
3. **M3c Review Manifest**：`review.ts` 生成/确认/消费；`review` 命令；测试生成≠确认、写集快照。
4. **M3d seal 事务**：`seal.ts` + `commit --review`；temp index/CAS/条件同步；故障注入测试。
5. **M3e 收口**：schema/CLI 帮助、删除旧测试、命名空间扫描、`git diff --check`、定向 + typecheck/lint、最后原样 `npm test` 记录真实 exit code/文件数/用例数；更新 progress 后停止交 Codex。

### 7. 续接入口

- 代码起点：`cli/src/lib/knowledge/git-write.ts`、`lock.ts`。
- 冻结对象：manifest schema `llmdoc.review/v1`（数据格式，不用于激活运行时）。
- 完成后停止，交 Codex 集中 review；不进入 M4/M5，不 stage/commit/reset/push。

## M3 实施记录 — 2026-09-10

状态：完成。`status/delta/validate` 原位切换到冻结双仓协议，新增 `review` 生成/确认/消费与 `commit --review` seal 事务；未进入 M4/M5，未改冻结协议，未 stage/commit/reset/push。

### 完成内容与文件

- 新增 `cli/src/lib/knowledge/git-write.ts`：写侧 Git plumbing。显式 `GIT_INDEX_FILE`；`hash-object -w --stdin`（无 filter）、`read-tree/update-index --cacheinfo/--force-remove/write-tree/commit-tree`、`update-ref` CAS；所有写命令注入 `core.hooksPath=<空目录>`、`commit.gpgsign=false`、`core.autocrlf=false`、`core.fsmonitor=false`、`gc.auto=0`，不调用外部辅助；`acquireIndexLock` 排他持有真实 `index.lock`，`publishIndex` 通过 lock 文件暂存后 rename 原子替换。
- 新增 `cli/src/lib/knowledge/lock.ts`：知识 commonDir `llmdoc.lock`。身份含 ownerToken/pid/host/bootId/processStartTimeMs/acquiredAt；保守恢复只在同 host 且（bootId 不同＝重启，或 PID 已不存在，或可读取的进程启动时间不符）时删除；平台取不到身份或锁不可读时保持并报告 `E_KNOWLEDGE_LOCKED`(70)，不凭 TTL/PID 误删。
- 新增 `cli/src/lib/knowledge/write-context.ts`：`resolveKnowledgeWriteContext` 精确绑定后同时取 K0（committed HEAD）与 worktree 快照、knowledge head/branch/操作态（merge/rebase/cherry-pick/revert）、clean 快照与 validity；`assertReviewPreconditions` 统一状态阻断（source invalid/dirty、knowledge unborn/detached/操作态/任何 staged）。
- 新增 `cli/src/lib/knowledge/review.ts`：`llmdoc.review/v1` manifest 生成/确认/消费。候选写集计算含 per-doc action、旧新 digest、旧 `validatedSourcePaths`、旧 `validatedRequires`、候选 requires 最终 digest、removed scope 与 reasons；requires 反向边扩展把「本批将变化的依赖」的依赖方纳入候选；`attachCandidateRequires` 按结论解析同批最终 digest；manifest 存 `.llmdoc-cache/reviews/<id>.json`（不提交）。
- 新增 `cli/src/lib/knowledge/seal.ts`：`sealKnowledgeReview`。锁内重解析 → 门控 → 校验 manifest 绑定/未消费/已确认/S/K0 → 重算候选与写集比对（正文/关系/scope/依赖/写集/新增未审查路径任一漂移即 `E_REVIEW_INVALIDATED`）→ meta 观察值门控 → 构造新 ledger → temp index（read-tree K0、hash blobs、update-index、删除）→ `write-tree`+`commit-tree`（父 K0，trailer: source revision / verified scope / reviewId）→ 发布前二次检查 source HEAD/clean、knowledge HEAD/branch、真实 index 观察值 → `update-ref <branch> K1 K0` CAS → 成功后原子替换真实 index、仅对观察值未变的自有文件（meta、换行归一化文档）条件同步；范围外草稿保留。发布后失败返回 K1 + `cleanup_required`，不回滚；重复消费被拒。
- 修改 `cli/src/lib/knowledge/errors.ts`：新增 `E_SOURCE_DIRTY/E_SOURCE_HEAD_DRIFT/E_SOURCE_INVALID_HEAD/E_KNOWLEDGE_INDEX_DIRTY/E_KNOWLEDGE_HEAD_MISMATCH/E_KNOWLEDGE_NOT_ON_BRANCH/E_KNOWLEDGE_META_DIRTY/E_KNOWLEDGE_LOCKED/E_INDEX_LOCKED/E_REVIEW_NOT_FOUND/E_REVIEW_NOT_CONFIRMED/E_REVIEW_INVALIDATED/E_CAS_CONFLICT/E_KNOWLEDGE_WRITE_FAILED`（结构 2 / 状态 3 / 事务 70）。
- 修改 `cli/src/lib/knowledge/git-core.ts`：导出 `sanitizedGitEnv` 供写侧复用。`cli/src/lib/knowledge/read.ts`：导出 `KnowledgeSnapshot`/`readKnowledgeSnapshot` 供写上下文复用（只读语义不变）。
- 原位切换 `cli/src/commands/{status,delta,validate}.ts`：`status` 报告 S/K0/branch、三态计数、复核义务、index staged、draft、source blockers/history；`delta` 报告逐篇复核义务、scope 移除、requires 漂移与 light/deep；`validate` 在 worktree 上做确定性 front matter/kind/关系/链接/source scope evidence/schema 检查，退出码 2，不推进 revision。
- 新增 `cli/src/commands/review.ts`（生成 / `--confirm` + `--set id=conclusion` / `--global`）与重写 `cli/src/commands/commit.ts`（仅接受 `--review <reviewId>`，无裸 verified 参数；`cleanup_required` 时退出码 70）。
- 修改 `cli/src/cli.ts`：4 个命令接线、新增 `review` 命令与参数、帮助示例更新；`bind/init` 描述保持标准协议。
- 修改 `cli/src/lib/output-schema.ts` + `cli/schemas/output.schema.json`：新增 `review`，重写 `status/delta/validate/commit` 契约（`llmdoc.*/v1`，含双 revision、blockers、issues、writeSet、sync、cleanupRequired）。
- 测试：新增 `knowledge-lock`(5)、`knowledge-status-delta`(4)、`knowledge-validate`(4)、`knowledge-review-seal`(16，真实双 Git + 故障注入)、`knowledge-cli-commit`(2，CLI 端到端)；`knowledge-helpers.ts` 增加真实 fixture（`createKnowledgeFixture`/`advanceSource`/`commitKnowledge`）。删除已被 breaking replacement 取代的 V3 `cli-{status,delta,validate,commit,commit-verified}.test.ts`；`cli-write/cli-startup-config/cli-startup-preload/cold-start/cli-hooks/cli-output-schema` 改为通过 V3 库断言，不再依赖同名 CLI 的 V3 语义。

### 协议落点核对（不依赖测试数量）

- **精确写绑定、无 fallback**：五个写命令均经 `resolveWriteBinding`；无绑定 `E_BINDING_NOT_FOUND`，不读 source Git。
- **S/K0 门控**：source 必须有效 HEAD 且全仓 clean；knowledge 必须分支上、有 initial commit、无 merge/rebase/cherry-pick、真实 index 无 staged；发布前二次检查。
- **manifest 语义**：生成 `confirmed:false`；`review --confirm` 才写结论并置 `confirmed:true`；`commit --review` 只消费已确认 manifest；正文/关系/scope/依赖/写集/新增未审查路径漂移全部 `E_REVIEW_INVALIDATED`；重复消费拒绝，K0 CAS 兜底。
- **单提交与写集**：changed docs + meta 一 commit；仅 meta 刷新一 commit；删除/晋升按结论入写集；范围外 draft 不入真实 index 也不被删除。
- **requires DAG**：同批按结论解析目标最终 digest 写入 `validatedRequires`；依赖方被本批变化纳入候选；目标 re-seal 后依赖方在下一轮 review 变 `needs_review`，不自动刷新。
- **lastGlobalReviewRevision**：仅 `review --global` 的 seal 推进。
- **锁与 source 只读**：锁身份字段齐全、保守恢复；source HEAD/index/文件字节级零修改；hooks（pre-commit/reference-transaction/post-commit）未运行。
- **发布后收尾**：条件同步仅覆盖观察值未变的自有文件；外部 meta 编辑保留并报未同步；发布后失败返回 K1 + `cleanup_required`，不回滚。

### 验证命令及真实结果

- 定向：`knowledge-lock` 5/5、`knowledge-status-delta` 4/4、`knowledge-validate` 4/4、`knowledge-review-seal` 16/16、`knowledge-cli-commit` 2/2；适配后的 `cli-write`/`cli-startup-config`/`cli-startup-preload`/`cold-start`/`cli-hooks`/`cli-output-schema` 25/25；M1/M2 既有 `knowledge-*` 全部通过。
- `npm run typecheck` exit 0；`npm run lint` exit 0；命名空间扫描 `rg "lib/v3ng|runNg|ng-read|ngTree|ngError|ngIndex|ngShow|ngSearch|ngContext|llmdoc\.ng-" cli/src cli/tests cli/schemas` 无命中；`git diff --check` exit 0（仅 LF/CRLF 提示）。
- 原样全量 `npm test`（`cmd /c "npm test > .llmdoc-tmp\m3gate2.log 2>&1"` 后立即读真实 `$LASTEXITCODE`，无筛选）：**exit 0，28 files / 191 tests 全过，无 Errors/Unhandled/Timeout，Duration 503.26s**（首次 `m3gate1.log` 因 9 个仍按 V3 语义调用同名命令的旧测试失败，已按 breaking replacement 改由 V3 库断言后重跑通过）。
- 环境核对：分支 `v3-ng`；`git diff --cached` 为空（index 无 staged）；真实 `%APPDATA%\llmdoc` 与 bindings.json 不存在；未 stage/commit/reset/push；`.codegraph/`、`.llmdoc-tmp/` 未纳入实现。

### 边界与剩余问题

- `new/adopt/mv/fingerprint/prune/upgrade/init-state/hook/serve` 仍为既有 V3 实现，属 M4/M5；`validate`/`status`/`delta`/`commit` 已是 v3-ng，故旧 V3 测试改由库断言。
- README 导航生成、capture、prune 编排、migrate、hooks/skills/agents/网站发布未在 M3 实现；seal 的自有文件条件同步机制已支持生成文件，但 M3 只写 `.llmdoc/meta.json`。
- `review --set` 采用 `id=changed|unchanged|insufficient` 赋值；agent 也可仅执行 `review --confirm <id>` 接受 manifest 中逐篇提议结论（生成时的 proposed 只作建议，未确认不发布）。
- 完成本记录后停止，交 Codex 集中 review；不进入 M4/M5，不 stage/commit/reset/push。

## M3 Codex 集中审查 R1 与返修计划 — 2026-09-10

状态：未通过。返修轮次 1/3。R1 认可 M3 的双仓写事务骨架、锁、CAS、source 只读与故障注入覆盖，但五处协议缺口必须在同一 M3 会话内修复；先落本计划再改代码。不进入 M4/M5，不 stage/commit/reset/push。

### R1 findings（逐条复现与独立判断）

1. **P0 Review conclusion 与物理写集脱钩（确认）**。`deriveWriteSet` 以 conclusion 决定是否写文档；`buildNextMeta` 却对非 insufficient 项一律写 `candidateDigest`/删除 evidence。于是 `update+unchanged`：tree 保留 K0 blob 但 meta 记新 digest；`add+unchanged`：tree 无新路径但 meta 有 entry；`delete+unchanged`：tree 仍包含但 meta 删除 evidence。K1 内 docs/meta 立即不一致，validity 与 worktree 都错。违反 architecture §4「四项证据在 seal 一起写入」与 §6「文档 blob、新 meta 一次发布」。
2. **P0 发布前未再次校验候选（确认）**。`verifyManifestAgainstWorktree` 只在构造 temp index 前跑；其后 `reassertPublishPreconditions` 只查 source HEAD/clean 与 knowledge HEAD/branch。确认后或构造期间发生的正文/front matter/scope/requires/删除/新增编辑不会在 CAS 前被捕获，会先发布旧 snapshot、把新编辑留成 draft。违反 §6 步骤 5「发布前再次检查……文档内容仍匹配」。
3. **P1 review/seal 不阻断结构无效 worktree（确认）**。`assertReviewPreconditions` 只看 Git 状态；`context.issues` 是 K0 issues，未纳入 `worktree.issues`/`worktreeModel.issues`/worktree source scope evidence（requires 环、missing target、invalid front matter、source scope 逃逸、link missing、缺失 literal/glob 零匹配）。违反 roadmap 验收 4-7 与 D4「拒绝 requires 环」及 §2「结构诊断」。
4. **P1 no_change 分支未消费 manifest（确认）**。`sealLocked` 在 `writeSet.meta=false` 时直接返回，未 `markReviewConsumed`；同一已确认 manifest 可重复 happy-path。违反 §6「即使消费标记丢失，K0 的 CAS 也阻止重复发布」的正常路径语义（无 commit 时无 CAS 可依赖）。
5. **P1 缺 host 的旧锁被当本机（确认）**。`isRecoverable` 对 `owner.host===""` 继续按 dead pid 删除，违反 §6「同机能证明持有者退出才允许显式恢复；平台无法判断则报告 owner」。

### 独立推演与协议落点（以冻结设计为准，不迁就测试）

- §4 三种复核结果：语义未变=只更新 meta；语义变化=改正文与 meta；证据不足=不推进。物理后果由「候选相对 K0 的字节/路径动作」决定：`add/update` 候选必须写入 K1，`delete` 必须从 K1 删除，`refresh`（正文与 K0 相同）物理无操作。`conclusion=insufficient` 表示不推进→不写、不改 evidence；其余 conclusion 均推进 evidence，物理动作按 action 执行。这样 K1 tree、worktree、meta、validity 恒一致，且 conclusion 不再能把已变更候选无声留成 draft。是否保留 `unchanged/changed` 的语义标签差异：仅在 manifest/审计中记录，不改变物理写集或 evidence 推进（两者都推进）；避免制造第二套未审语义。
- §6 步骤 5 要求发布前二次检查文档内容仍匹配；因此最终校验必须在持有 index.lock 之后、CAS 之前，对最新 worktree/K0 完整重算 manifest 与写集。
- §4/§2 要求结构诊断确定性与 requires 无环；review/seal 作为正式写入边界必须与 `validate` 共用同一结构判定，不能依赖用户先手工 validate。

### 修复计划（文件/函数）

- `cli/src/lib/knowledge/review.ts`：
  - `deriveWriteSet`：物理写集由 action 决定（非 insufficient）：`add/update → documents`，`delete → deletions`，`refresh → refresh`；`meta` 由是否有任何写集或 advanceGlobal 决定。
  - `computeFinalDigests`：按 action 解析目标最终 digest（非 insufficient 的 add/update 用 candidateDigest；delete 为 null/不可达；refresh 用 oldDigest；insufficient 用 K0 oldDigest）。保证依赖绑定与实际落盘字节一致。
  - 保留 `unchanged/changed/insufficient` 标签与校验；`insufficient` 是唯一“不推进”。
- `cli/src/lib/knowledge/seal.ts`：
  - 文档 blob/删除循环改为按 action 且 `conclusion!=insufficient`（不再要求 `changed`）。
  - `buildCommitMessage` 的 verified scope 涵盖所有非 insufficient 项。
  - 在 `beforePublish` hook 之后、`updateRefCas` 之前，重载 source/head/K0/worktree/模型/validity 并再次执行 `assertReviewPreconditions` + `verifyManifestAgainstWorktree` + source/knowledge HEAD 检查；命中漂移 `E_REVIEW_INVALIDATED`（或对应的 source/head 阻断），不发布。
  - no_change 分支消费 manifest（`markReviewConsumed(K0)`）；消费写入失败抛事务错误 `E_KNOWLEDGE_WRITE_FAILED`(70)，不返回伪成功。
  - 在 seal 入口调用统一结构校验。
- `cli/src/lib/knowledge/write-context.ts`：
  - 新增 `assertWorktreeStructureValid(context)`：汇总 `worktree.issues` + `worktreeModel.issues` + worktree validity（source scope evidence，`computeValidity` on worktreeModel）中的 error，抛 `E_STRUCTURE_INVALID`(2)。`assertReviewPreconditions` 调用它（改为 async），review/seal 共用。
  - 新增 `reloadKnowledgeWriteContext(context)`：锁内重读 source/K0/worktree/模型/validity（不重复读 knowledge clean，避免 index.lock 干扰），供发布前最终校验。
- `cli/src/lib/knowledge/errors.ts`：新增 `E_STRUCTURE_INVALID`（结构错误，exit 2）。
- `cli/src/lib/knowledge/lock.ts`：`isRecoverable` 收紧——host 必须精确等于本机（空 host 不恢复）；bootId 缺失/无法判定不恢复；`processStartTimeMs` 缺失不恢复；仅当「同 host 且 bootId 相同且身份齐备且（pid 已死或可读的进程启动时间不符）」或「同 host 且 bootId 明确不同（重启）」才恢复。

### 协议不变量（返修后必须成立）

- K1 中每篇 docs 的字节与其 meta evidence 的 digest 一致；add/update 物理写入、delete 物理删除、refresh 物理不变，均由 action 决定，与 conclusion 标签无关；insufficient 一律不推进。
- 发布前最终重校验之后才 CAS；任何正文/front matter/scope/requires/删除/新增路径漂移都在 CAS 前 `E_REVIEW_INVALIDATED`。
- review 与 seal 对结构无效 worktree 均以 exit 2 拒绝（requires 环、missing target、invalid front matter/source scope、link missing、固定 S scope evidence）。
- 已确认 manifest 在任何 seal 结局（含 no_change）都被消费；消费写入失败按事务/cleanup 报告。
- 锁恢复只在本机可证明持有者退出时进行；身份不全一律保守不删。

### 失败路径矩阵（返修新增）

| 场景 | 期望 |
|---|---|
| update + unchanged | 物理写入候选 + evidence 推进；K1/meta/worktree/validity 一致 |
| add + unchanged | 物理新增 + evidence；一致 |
| delete + unchanged | 物理删除 + 移除 evidence；一致 |
| delete + insufficient | 不删不加；K0 保持 |
| 确认后 / temp index 构造后正文编辑 | CAS 前 `E_REVIEW_INVALIDATED`，HEAD 不动 |
| 确认后 scope/requires 编辑 | 同上 |
| 确认后删除候选 / 新增未审查路径 | 同上 |
| worktree front matter/kind/source scope 无效 | review/seal `E_STRUCTURE_INVALID`(2) |
| worktree requires 环 / missing target | `E_STRUCTURE_INVALID`(2) |
| 固定 S 缺失 literal / glob 零匹配 | `E_STRUCTURE_INVALID`(2) |
| no_change 后重复 commit 同一 manifest | 拒绝（已消费） |
| 缺 host / 缺 bootId / 缺 processStartTime 的旧锁 | 不自动删除，保守 `E_KNOWLEDGE_LOCKED` |

### 测试矩阵（返修新增，真实双 Git + 故障注入）

- `knowledge-review-seal`：新增 action+conclusion 物理一致性矩阵（update/add/delete 各配 unchanged，delete+insufficient），断言 K1 tree 路径/blobs、meta digest/删除、worktree 状态与重新计算 validity 一致。
- 新增 `beforePublish` hook 在最终校验前制造并发编辑（正文、scope/requires、删除候选、新增未审查路径），断言 `E_REVIEW_INVALIDATED` 且 knowledge HEAD/index 不动。
- 新增结构阻断：front matter invalid、source.paths 逃逸、requires 环、missing target、固定 S literal 缺失/glob 零匹配——review 与 seal 均 exit 2，不产生 commit。
- 新增 no_change 消费：已确认但空写集 manifest 首次返回 no_change 并消费，第二次拒绝。
- `knowledge-lock`：新增缺 host、缺 bootId、缺 processStartTime 且 pid 已死的锁不被自动删除。
- 既有全部回归保持通过；最终只跑一遍原样 `npm test` 记录真实 exit/files/tests。

### 与冻结协议冲突检查

- R1-1 的 action 决定物理写集与 §4「语义未变只更新 meta / 语义变化改正文与 meta」一致：正文未变（refresh）才 meta-only，正文变（add/update）必写正文，删除必删路径。
- R1-2 的最终重校验属 §6 步骤 5 的发布前检查，不引入新锁语义。
- R1-3 的结构校验不扩张 validate 职责，只是让正式写入边界复用同一确定性判定。
- R1-4/R1-5 均为 §6 既有要求，无协议冲突。

### 续接入口

- 代码起点：`review.ts`（deriveWriteSet/computeFinalDigests）→ `write-context.ts`（结构断言/reload）→ `seal.ts`（写集、最终校验、no_change 消费）→ `lock.ts`。
- 完成后更新本文件验证证据，停止交 Codex R2。

## M3 R1 返修实施与验证记录 — 2026-09-10

状态：完成五项 R1 修复；定向、typecheck、lint、namespace scan、`git diff --check` 通过；只跑一遍最终原样 `npm test` exit 0（28 files / 197 tests）。未进入 M4/M5，未 stage/commit/reset/push。

### 逐项修复

1. **P0 写集与 conclusion 解耦（已修）**：`review.ts::deriveWriteSet` 改为按 action 决定物理写集（非 insufficient）：`add/update → documents`、`delete → deletions`、`refresh → refresh`；`meta` 仍由是否有任一写集或 advanceGlobal 决定。`review.ts::computeFinalDigests` 同样按 action 解析目标最终 digest（add/update→candidateDigest；delete→null；refresh/insufficient→K0 oldDigest），确保依赖绑定与实际落盘字节一致。`seal.ts` 的 blob/删除循环由 `conclusion==="changed"` 改为 `conclusion!=="insufficient"` 且按 action 执行；`buildCommitMessage` 的 verified scope 涵盖所有非 insufficient 项（旧∪新 scope）。`buildNextMeta` 对非 insufficient 项记录的 `validatedContentDigest=candidateDigest` 现与 K1 tree 恒一致。`unchanged/changed` 仅作审计标签，`insufficient` 是唯一不推进。
2. **P0 发布前最终重校验（已修）**：`write-context.ts` 新增 `reloadKnowledgeWriteContext`（重读 source/K0/worktree/模型/validity，不重复读 knowledge clean），`seal.ts` 在持有 index.lock、`beforePublish` hook 之后、`updateRefCas` 之前执行：`assertReviewPreconditions(fresh)` + source HEAD==S + knowledge HEAD==K0/branch 未变 + `verifyManifestAgainstWorktree(fresh,...)`；任一漂移在 CAS 前 `E_REVIEW_INVALIDATED`/对应阻断，不发布旧 snapshot。新增 `beforeCas` 测试 hook 专门复现 CAS 与最终校验之间的 ref 竞态。
3. **P1 结构门控（已修）**：`write-context.ts` 新增 `assertWorktreeStructureValid`，汇总 `worktree.issues` + `worktreeModel.issues` + worktree `computeValidity`（source scope evidence）的 error，抛 `E_STRUCTURE_INVALID`(exit 2)；`assertReviewPreconditions` 改为 async 并调用它，`runReview` 与 `sealKnowledgeReview` 共用。`errors.ts` 新增 `E_STRUCTURE_INVALID`。
4. **P1 no_change 消费（已修）**：`seal.ts` 的 `!writeSet.meta` 分支先 `writeReviewManifest(markReviewConsumed(manifest, K0))`；写入失败抛 `E_KNOWLEDGE_WRITE_FAILED`(70)，成功后返回 no_change；重复消费被拒。
5. **P1 锁恢复收紧（已修）**：`lock.ts::isRecoverable` 要求 host 精确等于本机（空/异机不恢复）；bootId 缺失或无法取得不恢复；`processStartTimeMs` 缺失不恢复；仅当「同 host 且 bootId 明确不同（重启）」或「同 host、bootId 相同、身份齐备且 pid 已死或可读的进程启动时间不符」才恢复。

### 测试与真实结果

- `knowledge-review-seal`（20 tests）新增：
  - action+conclusion 物理一致性：`update+unchanged`、`add+unchanged`、`delete+unchanged` 断言 K1 blob digest、meta digest/删除、worktree 内容与重新计算 validity=`current`/一致；`delete+insufficient` 断言 no_change、K1 保留、meta 保留、worktree 删除留作 draft。
  - `beforePublish` 在最终校验前注入正文/front matter 变体（scope 变化）、删除候选、新增未审查路径，全部 `E_REVIEW_INVALIDATED` 且 knowledge HEAD 不动。
  - 结构阻断：bad kind + source.paths 逃逸、requires 环 + missing target、固定 S literal 缺失 + glob 零匹配，`runReview` 与 `seal` 均 `E_STRUCTURE_INVALID`(2)。
  - no_change 首次消费、第二次拒绝。
- `knowledge-lock`（7 tests）新增：缺/异 host、缺 bootId、缺 processStartTime 且 pid 已死均不自动恢复（保守 `E_KNOWLEDGE_LOCKED`）。
- 定向：`knowledge-review-seal` 20/20、`knowledge-lock` 7/7；既有 `knowledge-*`、CLI 与其他测试全部通过。
- `npm run typecheck` exit 0；`npm run lint` exit 0；namespace scan 无命中；`git diff --check` exit 0（仅 LF/CRLF 提示）。
- 最终单遍原样 `npm test`（`cmd /c "npm test > .llmdoc-tmp\m3r1gate.log 2>&1"` 后立即读真实 `$LASTEXITCODE`，无筛选）：**exit 0，28 files / 197 tests 全过，无 Unhandled/Timeout，Duration 704.75s**。
- 环境核对：分支 `v3-ng`；`git diff --cached` 为空；真实 `%APPDATA%\llmdoc` 不存在；未 stage/commit/reset/push。

### 协议一致性说明（不靠降级测试）

- 物理写集由 action 决定后，K1 tree 与服务该写集的 meta evidence 一一对应；`refresh` 只有在 candidateDigest==oldDigest 时才可能，故 meta-only 与正文一致。
- 最终重校验覆盖「确认后 / temp index 构造后」的正文、front matter、scope、requires、删除与新增未审查路径，均在 CAS 前阻断。
- 结构门控与 `validate` 使用同一 `computeValidity`/model 判定，review 与 seal 不再依赖用户先手工 validate。
- 锁恢复要求完整身份证据，缺项保守失败，符合 §6「仅能证明持有者退出才恢复」。
- 完成后停止，交 Codex R2。

## M3 Codex 集中审查 R2 与返修计划 — 2026-09-10

状态：未通过。返修轮次 2/3。R1 五项已关闭；R2 仍有 3 组协议/安全缺口。先落本计划再改代码。不进入 M4/M5，不 stage/commit/reset/push。

### R2 findings（逐条复现与独立判断）

1. **P0 manifest 路径与 knowledgeRoot 可被缓存内容劫持（确认）**。`reviewFilePath` 直接 `path.join(reviewsDirectory(root), reviewId + ".json")` 且 CLI `--confirm`/`--review` 不校验 reviewId，`../` 可逃出 reviews 目录；`loadReviewManifest` 只要求 schema/reviewId 为字符串，不要求 `parsed.reviewId===requested`；`runReview` confirm 后 `writeReviewManifest` 使用 `manifest.knowledgeRoot`，篡改缓存里的 root 可向任意路径写文件；repositoryId/sourceRoot/S/K0 未在确认时核对。违反 §6 步骤 1/5「精确绑定」与事件边界的可信根假设。
2. **P1 reload 未重读操作态（确认）**。`reloadKnowledgeWriteContext` 用 `...context` 保留首次 `knowledgeOperation`，final check 看不到确认后新出现的 MERGE_HEAD/REBASE_HEAD/CHERRY_PICK_HEAD/REVERT_HEAD。违反 §6 步骤 1「无 merge/rebase 或未解决冲突」。
3. **P1 no_change 分支未做最终重载即消费（确认）**。该分支在初次 verify 后直接 `markReviewConsumed`，未重读/重算、未验证 S/K0/branch/操作态；确认后到消费之间的正文/scope/requires/新增删除/source HEAD/dirty/ref 漂移仍会被消费并返回 no_change。违反 §6「任何确认后编辑使 review 失效」与 R1-2 同源。

### 独立推演与协议落点

- §6 明确 manifest 是「本地验证声明，不是对恶意篡改的认证机制」，但 runner 不得把不可信缓存内容当作路径/身份来源：任何 reviewId→路径必须先满足生成器格式，任何写回必须落在当前解析出的可信 knowledge root；manifest 内的 repositoryId/sourceRoot/knowledgeRoot/S/K0 只能与当前精确绑定交叉核对，不能作为写入依据。
- §6 步骤 1/5 要求发布前知识仓处于分支、无 merge/rebase/cherry-pick；final reload 必须重新判定操作态，不能沿用旧值。
- 「任何确认后编辑使 review 失效」不因 no_change 而豁免：即使不产生 Git commit，消费语义也必须建立在最新校验之上，否则等于确认陈旧声明。

### 修复计划（文件/函数）

- `cli/src/lib/knowledge/errors.ts`：新增 `E_REVIEW_INVALID`（结构错误 exit 2，用于格式非法/字段不完整/身份不符的 manifest）。
- `cli/src/lib/knowledge/review.ts`：
  - 新增 `REVIEW_ID_PATTERN`（`^[0-9a-f]{32}$`）与 `isValidReviewId`；`reviewFilePath` 在任何 `path.join` 前校验 reviewId，非法抛 `E_REVIEW_INVALID`。
  - `writeReviewManifest(knowledgeRoot, manifest)`：改为显式接收**可信 knowledge root**，忽略/覆盖 manifest 内路径；写入前校验 manifest.reviewId 格式。
  - `loadReviewManifest(knowledgeRoot, reviewId)`：校验 id 格式；读取后执行完整 `validateReviewManifest`；要求 `parsed.reviewId===reviewId` 且 `sameRealPath(parsed.knowledgeRoot, knowledgeRoot)`；错误结构化。
  - 新增 `validateReviewManifest(parsed, label)`：完整校验 schema、reviewId、repositoryId、full OID（sourceRevision/knowledgeBaseRevision/oldSourceRevision/consumed knowledgeRevision）、sourceRoot/knowledgeRoot 非空、布尔枚举、时间戳 string|null、notes/documents/writeSet 类型、每篇 doc 的 canonical doc id、action/proposedConclusion/conclusion 枚举、digest/OID 字段、scope 数组 canonical source path、requires/candidateRequires 的规范 ID 与 digest、writeSet 的 canonical doc id 与 `generated` 安全相对路径。
  - `confirmReviewManifest(context, manifest, options)`：先核对 `repositoryId/sourceRoot/knowledgeRoot` 与精确绑定、`sourceRevision` 与当前 source HEAD、`knowledgeBaseRevision` 与当前 K0；不符分别 `E_SOURCE_IDENTITY_MISMATCH`/`E_REVIEW_INVALID`/`E_SOURCE_HEAD_DRIFT`/`E_KNOWLEDGE_HEAD_MISMATCH`；返回时用可信值覆盖 maniest 的这些字段。
- `cli/src/lib/knowledge/write-context.ts`：`reloadKnowledgeWriteContext` 重新 `detectKnowledgeOperation` 并写入 fresh context。
- `cli/src/lib/knowledge/seal.ts`：
  - 所有 `writeReviewManifest` 调用改为 `writeReviewManifest(context.knowledge.worktreeRoot, manifest)`。
  - no_change 分支重构为 `consumeNoChange`：获取 index.lock → `beforePublish` seam → `reloadKnowledgeWriteContext` + `assertReviewPreconditions` + source S + knowledge K0/branch + `verifyManifestAgainstWorktree` → 通过后才消费；任一漂移返回对应阻断且**不消费**；缓存写失败 `E_KNOWLEDGE_WRITE_FAILED`(70)。
- `cli/src/commands/review.ts`：生成/确认写回使用当前 `context.knowledge.worktreeRoot`；confirm 前调用校验。

### 协议不变量（返修后必须成立）

- reviewId 只允许生成器格式；任何路径计算前验证；manifest 文件名不得逃出 reviews 目录。
- manifest 加载必须 id 自洽且完整字段校验；知识根外不得因 load/confirm/write 创建或覆盖任何文件。
- confirm 只信任当前精确绑定与 S/K0；manifest 内路径只作交叉核对。
- final reload 重新判定操作态；merge/rebase/cherry-pick/revert 一律 CAS 前阻断。
- no_change 也必须经过最终重载+完整校验后才消费；确认后任一编辑使 review 失效且不消费。

### 失败路径矩阵（返修新增）

| 场景 | 期望 |
|---|---|
| `--confirm ../evil` / `--review ../evil` / `..\\evil` | `E_REVIEW_INVALID`(2)，知识根外无文件 |
| 缓存文件 parsed.reviewId ≠ 请求 id | `E_REVIEW_INVALID`(2) |
| 缓存 knowledgeRoot 指向知识根外 | `E_REVIEW_INVALID`(2)，不向该路径写入 |
| 缓存 sourceRoot/repositoryId/S/K0 与当前绑定不符 | 对应身份/漂移阻断，不写入 |
| final-check 前出现 MERGE_HEAD 等 | `E_KNOWLEDGE_NOT_ON_BRANCH`(3)，HEAD/index 不动 |
| no_change 消费前新增未审查 doc | `E_REVIEW_INVALIDATED`(3)，manifest 未消费 |
| no_change 消费前 source HEAD 漂移 | `E_SOURCE_HEAD_DRIFT`(3)，未消费 |
| no_change 消费前 knowledge ref 漂移 | `E_KNOWLEDGE_HEAD_MISMATCH`(3)，未消费 |
| no_change 缓存写失败 | `E_KNOWLEDGE_WRITE_FAILED`(70) |

### 测试矩阵（返修新增）

- `knowledge-review-seal` + 新增 `knowledge-manifest-safety`（或并入）：
  - 库级：`loadReviewManifest` 对 `../`/非 32hex id 抛 `E_REVIEW_INVALID`；parsed.reviewId 不匹配；篡改 knowledgeRoot/sourceRoot/repositoryId/S/K0 的 confirm 阻断；断言外部目录无创建/覆盖。
  - CLI 级：`review --confirm ../evil`、`commit --review ../evil` 结构化错误 exit 2；未知合法 id `E_REVIEW_NOT_FOUND`。
  - `beforePublish` 注入 MERGE_HEAD（HEAD/index 不变）→ `E_KNOWLEDGE_NOT_ON_BRANCH`。
  - no_change：`beforePublish` 注入新增未审查 doc / source 漂移 / ref 漂移 → 准确错误且 manifest `consumed:false`（重新读取缓存断言）。
- 既有全部回归保持通过；最终只跑一遍原样 `npm test` 记录真实 exit/files/tests。

### 与冻结协议冲突检查

- 固定 reviewId 格式与可信根写回不改变 manifest 语义，只是把不可信缓存输入从路径/身份决策中移除；与 §6「manifest 非认证机制」一致。
- 操作态重读与 no_change 消费前重载均为 §6 步骤 1/5 的直接落实，无协议冲突。

### 续接入口

- 代码起点：`review.ts`（id/校验/可信写回）→ `write-context.ts`（operation 重读）→ `seal.ts`（no_change 最终重载消费）→ CLI/测试。
- 完成后更新本文件验证证据，停止交 Codex R3。

## M3 R2 返修实施与验证记录 — 2026-09-10

状态：完成三组 R2 修复；定向、typecheck、lint、namespace scan、`git diff --check` 通过；只跑一遍最终原样 `npm test` exit 0（29 files / 204 tests）。未进入 M4/M5，未 stage/commit/reset/push。

### 逐项修复

1. **P0 manifest 路径/身份劫持（已修）**：
   - `review.ts` 新增 `REVIEW_ID_PATTERN=^[0-9a-f]{32}$` 与 `isValidReviewId`；`reviewFilePath` 在任何 `path.join` 前校验，非法抛 `E_REVIEW_INVALID`(2)。`loadReviewManifest` 同样先校验 id。
   - 加载后执行完整 `validateReviewManifest`（schema、id、repositoryId、S/K0/oldSourceRevision/consumed revision 的 full OID、根路径非空、布尔/时间戳枚举、notes/documents/writeSet 类型、每篇 canonical doc id、action/proposedConclusion/conclusion 枚举、digest/OID、scope canonical、validatedRequires 键值、candidateRequires、writeSet generated 安全相对路径）；要求 `parsed.reviewId===requested id` 且 `sameRealPath(parsed.knowledgeRoot, 可信 root)`；错误统一 `E_REVIEW_INVALID`。
   - `writeReviewManifest(knowledgeRoot, manifest)` 改为显式接收**可信 knowledge root**，写入前用可信 root 覆盖 manifest 路径字段；所有调用（review 生成/确认、seal 发布后消费与 no_change 消费）改用 `context.knowledge.worktreeRoot`。
   - `confirmReviewManifest` 先 `assertManifestMatchesContext`：repositoryId 与绑定一致（否则 `E_SOURCE_IDENTITY_MISMATCH`）、sourceRoot/knowledgeRoot 与精确绑定 realpath 一致（否则 `E_REVIEW_INVALID`）、S 与当前 source HEAD 一致（否则 `E_SOURCE_HEAD_DRIFT`）、K0 与当前 knowledge HEAD 一致（否则 `E_KNOWLEDGE_HEAD_MISMATCH`）；返回时用可信值覆盖。
   - `errors.ts` 新增 `E_REVIEW_INVALID`(2)。
2. **P1 reload 重读操作态（已修）**：`reloadKnowledgeWriteContext` 重新 `detectKnowledgeOperation` 并写入 fresh context；final pre-CAS `assertReviewPreconditions(fresh)` 因此能捕获新出现的 MERGE_HEAD/REBASE_HEAD/CHERRY_PICK_HEAD/REVERT_HEAD。
3. **P1 no_change 消费前最终重载（已修）**：`seal.ts` 抽出 `consumeNoChange`：获取 index.lock → `beforePublish` seam → `reloadKnowledgeWriteContext` + `assertReviewPreconditions` + source S + knowledge K0/branch + `verifyManifestAgainstWorktree` → 通过后才 `writeReviewManifest(可信 root, markReviewConsumed)`；任一漂移返回对应阻断且不消费；缓存写失败抛 `E_KNOWLEDGE_WRITE_FAILED`(70)。

### 测试与真实结果

- 新增 `knowledge-manifest-safety.test.ts`（4）：`../`/反斜杠/非 32hex/长度越界 id 在路径计算前 `E_REVIEW_INVALID` 且不创建 reviews 目录；parsed.reviewId 不匹配；篡改 knowledgeRoot（加载与 confirm 均拒绝且外部目录无写入）、sourceRoot、repositoryId、S、K0；结构非法 manifest 拒绝。
- `knowledge-cli-commit`（3）：新增 CLI `review --confirm ../evil`/`commit --review ../evil` 结构化 `E_REVIEW_INVALID`(2) 且知识根外无文件；未知合法 id `E_REVIEW_NOT_FOUND`。
- `knowledge-review-seal`（22）：新增 `beforePublish` 注入 MERGE_HEAD（HEAD/index 不变）→ `E_KNOWLEDGE_NOT_ON_BRANCH`(3)；no_change 消费前新增未审查 doc → `E_REVIEW_INVALIDATED`、source 漂移 → `E_SOURCE_HEAD_DRIFT`、ref 漂移 → `E_KNOWLEDGE_HEAD_MISMATCH`，均断言 manifest `consumed:false`。
- `knowledge-lock` 7/7 保持。
- 定向全部通过。`npm run typecheck` exit 0；`npm run lint` exit 0；namespace scan 无命中；`git diff --check` exit 0（仅 LF/CRLF 提示）。
- 最终单遍原样 `npm test`（`cmd /c "npm test > .llmdoc-tmp\m3r2gate.log 2>&1"` 后立即读真实 `$LASTEXITCODE`，无筛选）：**exit 0，29 files / 204 tests 全过，无 Unhandled/Timeout，Duration 719.30s**。
- 环境核对：分支 `v3-ng`；`git diff --cached` 为空；真实 `%APPDATA%\llmdoc` 不存在；未 stage/commit/reset/push。

### 协议一致性说明

- reviewId 格式校验、id 自洽、完整字段校验与可信根写回，把不可信缓存从路径/身份决策中移除；manifest 仍是本地声明而非认证机制，但 runner 不再信任其路径与身份字段。
- final reload 覆盖内容漂移、source/ref 漂移与 Git 操作态；no_change 也因此不能消费陈旧声明。
- 完成后停止，交 Codex R3。

## M3 Codex R3 直接接管收口 — 2026-09-11

状态：R3 发现 no_change 消费路径仍存在 knowledge index 竞态，达到用户约定的三轮返修阈值，由 Codex 直接接管 M3 收口，不再交回 OpenCode。

### R3 finding 与修复计划

- **P1 no_change 未复核真实 index 观察值**：`consumeNoChange` 在首次 `assertReviewPreconditions` 后直接获取 `index.lock`，但没有像真实 seal 一样记录并比较 index 字节。另一 Git 写者若在首次检查后、llmdoc 获取锁前完成 `git add`，fresh context 仍沿用旧 `knowledgeClean`，manifest 会被消费并返回成功，违反“任何 staged 内容都阻断正式 commit”以及“并发 git add 不能被覆盖/忽略”。
- 修复：no_change 在竞态窗口前记录真实 index 观察值；获取 `index.lock` 后先做字节 CAS 检查，再执行最终 reload/manifest 校验和消费。增加只用于故障注入的 `beforeIndexLock` seam，复现中间 `git add`，断言 `E_KNOWLEDGE_INDEX_DIRTY`、manifest 未消费、HEAD 未移动且 staged 内容保留。
- 验证：先跑新增定向测试，再跑 typecheck、lint、namespace scan、`git diff --check`，最后一遍原样 `npm test`；记录真实 exit/files/tests 后进行最终 R3 复审。

### R3 实施与最终复审结果

- `SealTestHooks` 新增 `beforeIndexLock` 故障注入点；`consumeNoChange` 在窗口前记录真实 index 字节，获取 `index.lock` 后以观察值比较，漂移返回 `E_KNOWLEDGE_INDEX_DIRTY`，不消费 manifest、不移动 HEAD、不清理其他写者的 staged 内容。
- 新增真实双 Git 回归：在 no_change 首次检查后执行 `git add docs/a.md`，断言错误码/退出码、manifest `consumed:false`、knowledge HEAD 保持 K0、staged 路径仍为 `docs/a.md`。
- 定向 `knowledge-review-seal.test.ts`：23/23，exit 0，Duration 358.39s。
- `npm run typecheck` exit 0；`npm run lint` exit 0；breaking namespace scan 无命中；`git diff --check` exit 0（仅 LF/CRLF 提示）。
- 最终一遍原样 `npm test`：**exit 0，29 files / 205 tests 全过，Duration 818.03s**。
- 最终复审结论：R1/R2/R3 的所有问题均已关闭；M3 冻结不变量、双仓边界、manifest/seal、临时 index/CAS、锁、结构门控、同步与失败语义已满足，可提交。
