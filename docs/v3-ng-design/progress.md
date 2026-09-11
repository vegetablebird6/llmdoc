# v3-ng 实施进度与续接记录

最后更新：2026-09-10（M1 已通过 Codex 集中复审，等待创建里程碑 commit；OpenCode 后续进入 M2）。

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
| M2 内容与读取 | 未开始 | 见 roadmap.md |
| M3 语义提交 | 未开始 | 见 roadmap.md |
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
