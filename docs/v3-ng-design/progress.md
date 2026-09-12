# v3-ng 实施进度与续接记录

最后更新：2026-09-11（M1–M5 已完成并通过 Codex review；提交身份已统一为 `vegetable6 <xukun6cai@gmail.com>`；完成 ponytail 过度设计审查，尚未应用精简项）。

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
| M4 最小维护闭环 | 完成并通过 Codex review | commit `4b1e50e`；见「M4 设计与分步实施计划」「M4a/M4b」「M4c/M4d」「M4e/M4f」「M4g 收口」「M4 Codex 集中审查 R1 与返修计划」「M4 R1 返修实施与验证记录」 |
| M5 接入与发布 | 完成并通过 Codex review | 见「M5 Codex 最终 review 与收口证据」；31 files / 282 tests 完整集成套件通过 |

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

## M4 设计与分步实施计划 — 2026-09-11

状态：设计先行。先落本计划再写代码。M4 只实现 capture、update/prune 编排、README 导航生成、显式 migrate；不进入 M5（hooks/skills/agents/网站/发布），不改冻结协议，不 stage/commit/reset/push，不把 `.codegraph/`、`.llmdoc-tmp/`、日志纳入。

### 1. 独立推演（逐条核对 architecture §2/§5/§6/§7、roadmap M4/验收 8–9、D4，不迎合既有代码）

1. **capture 是“写集不同的 seal”，不是第二套写实现**（§6）。它必须复用知识锁、真实 index 无 staged 门控、临时 index、`write-tree/commit-tree/update-ref` CAS、发布后 index/自有文件条件同步；区别仅在：写集只有 `inbox/**`、不带 verification/source trailer、不写/不推进 `.llmdoc/meta.json`、不要求 source clean、不消费 manifest。若复制一套 `git add`/`commit` 就是协议破坏。
2. **capture 的写集边界**（§2/§6）：捕获提交后 K1 只新增 `inbox/<id>`；`docs/**`、`.llmdoc/meta.json`、`README.md`、source 均零写；正式 `tree/index/show/search/context` 结构性排除 inbox。
3. **capture 仍受写事务门控**：精确绑定、独立 Knowledge Git、知识分支存在、无 merge/rebase/cherry-pick、真实知识 index 无任何 staged、范围外 staged 一律拒绝；source worktree 可以 dirty/unborn（不要求 clean）。并发 `git add` 在 index 观察与 `index.lock` 之间发生时不得被覆盖。
4. **候选是未验证的一等数据**（§2）：`capture` 落 `inbox/` 候选（内容 + 来源说明 + 创建时间 + 可选观察 source revision）。候选不得进入正式召回，也不得被当作验证正文。
5. **update/prune 只做编排，不自动 current**（§5/§6）：普通 Markdown 编辑只会让 digest 失配 → `needs_review`；编排命令可以产生候选、应用显式人工/agent 结论、生成未确认 Review Manifest，但发布永远只能经 `commit --review` 的 seal。promote/reject 的物理结果由 seal 的单一写集承载。
6. **promote 原子性**（§2/§6）：晋升 = `docs/<id>` 新增/更新 + 入链关系修正 + `.llmdoc/meta.json` 四项证据 + `inbox/<candidate>` 移除，必须同一 K1。因此 Review Manifest 写集需要新增“候选移除”维度；seal 在临时 index 中删除对应 `inbox/` 路径。不存在“先删候选再单独提交正文”的中间态。
7. **prune 保守**（§5/§6）：只有低价值/重复/过期且**证据充分**的知识才进入删除候选；证据不足一律 `insufficient` 保留。删除必须顺带修复所有入链（requires/related/supersedes 与正文链接），否则结构门控会令 seal 失败；写集与失效判定完全复用 seal。
8. **README 导航是机器管理区，不是知识节点**（§2）：只替换 `<!-- llmdoc:navigation:start -->` 与 `end` 之间字节，机器区外（human-managed）原样保留；导航不参与 digest/验证/检索，不扩大 reviewed scope；生成随相关 seal 同 commit 发布，删除/重命名/多层目录/decision+supersedes 后仍确定、稳定排序。
9. **migrate 是唯一 V3 读入口**（§7）：只有显式 `migrate --dry-run` / `migrate` 读取旧 `llmdoc/*.mdx`、CodeRef、`code.paths`、旧 `llmdoc/meta.json`、`llmdoc.config.json`；运行时其它入口不得兼容读取。dry-run 零修改旧仓、source、目标；migrate 建立**新的**外置独立 Knowledge Git 与 migration baseline，不抽取/重写旧仓历史。
10. **迁移不伪造 current/verified**（§7）：旧 `validatedRevision` 可仅作来源说明；新 meta 一律 `null/null/[]/{}`，经新 review 后才 seal。`code.paths`→`source.paths`，`.mdx`→`.md`，CodeRef→文字证据/链接，无法无损或无 `source.paths` 的文档保守列出并由人工复核，不静默生成非法正式文档。
11. **失败不留半绑定**（§3/§7）：migrate 先建仓、复制、初始 commit、目标结构校验全通过后才写用户 registry；失败清理仅本次创建的构件，绝不改旧仓、旧绑定或 source。目标已存在草稿时保守拒绝，不覆盖。
12. **分层**：orchestration（capture/update/prune/migrate/navigation 命令与计划计算）与 transaction（锁/CAS/临时 index/条件同步）分离，CLI JSON schema 复用既有 `knowledgeError` 错误模型。

### 2. 协议不变量（M4 代码必须始终满足）

- 正式知识面仍严格 = committed `docs/**/*.md`；inbox/cache/README 不进正式检索与验证。
- capture 成功：K1 = K0 + 仅 inbox 候选，commit 无 `llmdoc-source-revision` / verified scope / review id trailer，meta 与 global review 不变；index 同步；docs/范围外草稿保持 dirty。
- promote/reject：候选移除与 docs/meta/relations 同一 K1；写集只含已确认 manifest；任意漂移 `E_REVIEW_INVALIDATED`。
- README：机器区外字节不变；导航不进 digest/检索/验证；与相关 seal 同 commit 或保持原样。
- migrate：旧仓/source/目标（dry-run）零修改；migration baseline 是新独立历史；旧 evidence 不迁移为 current。
- 所有写事务：精确绑定、独立 common Git、知识分支、无操作态、真实 index 无 staged、范围外 staged 阻断、CAS 发布、发布后失败报 K1 + `cleanup_required`。
- Source Git 全程只读；无写入 fallback。

### 3. 模块/文件责任边界（单写者串行区）

| 归属 | 文件 | 责任 |
|---|---|---|
| 事务底座（新增） | `cli/src/lib/knowledge/transaction.ts` | 从 seal 抽出可复用的“构建临时 index → commit-tree → 发布前重载/校验 → index.lock/CAS → 原子 index + 条件文件同步 → cleanup_required”实施；seal 与 capture 唯一共用 |
| capture（新增） | `cli/src/lib/knowledge/capture.ts` | 候选格式/ID/写入；inbox-only 写集；capture 专属门控与 verifyFresh；无 trailer/meta |
| 候选模型（新增） | `cli/src/lib/knowledge/inbox.ts` | 从 K0/worktree 读取 `inbox/**` 候选、规范化 ID、移除集合 |
| 导航（新增） | `cli/src/lib/knowledge/navigation.ts` | 机器区标记、`renderNavigation(model)`、`replaceNavigationRegion`、README 目标字节与稳定性 |
| 变更编排（新增） | `cli/src/lib/knowledge/update.ts`、`cli/src/lib/knowledge/prune.ts` | 候选/收敛候选计算、显式 promote/reject/remove 的 worktree 变换、生成未确认 manifest；不提交 |
| 迁移（新增） | `cli/src/lib/knowledge/legacy.ts`、`cli/src/lib/knowledge/migrate.ts` | 旧格式只读解析与转换计划；dry-run 报告；新独立知识仓/基线/绑定 |
| Manifest/seal（改） | `review.ts`、`seal.ts` | 写集新增候选移除；seal 删除 `inbox/` 路径、写 README 机器区；复用 transaction |
| 命令（改/新增） | `commands/{capture,update,prune,migrate}.ts`、`commands/upgrade.ts`（改为不再读 V3 的弃用指引）、`cli.ts` | 标准命令接线、帮助 |
| 契约 | `lib/output-schema.ts`、`schemas/output.schema.json` | 新增 `capture/update/prune/migrate`，改写 `prune`/`upgrade`，扩展 `commit/review` writeSet |
| 测试（新增） | `tests/knowledge-{capture,update-prune,navigation,migrate}.test.ts` | 真实临时双 Git + 故障注入 |

### 4. 失败路径矩阵（均需真实双 Git 测试）

| 场景 | 期望 |
|---|---|
| capture 无精确绑定 / 知识非独立 Git / 非分支 / merge 中 | 对应 `E_BINDING_*` / `E_KNOWLEDGE_*` / `E_KNOWLEDGE_NOT_ON_BRANCH`，零写 |
| capture 知识 index 有 staged（含范围外） | `E_KNOWLEDGE_INDEX_DIRTY`(3)，候选不写、staged 保留 |
| capture 与并发 `git add` 竞争 | 观察值不符 → `E_KNOWLEDGE_INDEX_DIRTY`，不覆盖他者 staged |
| capture 存在 docs 草稿 | 只提交 inbox；docs 草稿 dirty；index 同步 K1 |
| capture 发布后 index 同步失败 | 返回已发布 K1 + `cleanup_required`(70)，不回滚 |
| capture 后 meta/README 被外部修改 | 保留修改并报告未同步，不覆盖 |
| 普通编辑未 review 直接 commit | 无 manifest → `E_REVIEW_NOT_FOUND`；digest 失配→`needs_review` |
| promote 后候选未删 / 删了候选没改文档 | manifest 写集与实际不一致 → `E_REVIEW_INVALIDATED` |
| promote 正文+meta+关系+候选移除 | 同一 K1，重算 validity 与 meta 一致 |
| reject 候选 | 仅候选移除的 K1，meta 不变 |
| prune 请求删除 insufficient 候选 | 保守拒绝/保留，不产生 commit |
| prune 删除文档但遗留入链 | 结构门控 `E_STRUCTURE_INVALID`；prune 负责修正所有入链 |
| README 机器区外人工编辑 | 保留 human 区字节；导航只替换机器区 |
| 确认后 README 外部改动 | 保留并报告未同步（`cleanup_required`），不覆盖 |
| 删除/重命名文档 | 同 seal 的导航不含被删文档、稳定排序 |
| migrate dry-run | 旧仓/source/目标字节零变化；列出全部映射/冲突/降级 |
| migrate 扩展名碰撞 / 目标已有草稿 / 无 source.paths | 保守列出或不迁移该项；不伪 current |
| migrate 成功 | 新外置独立 Git、migration baseline、候选证据 `null/null/[]/{}`、绑定写入 |
| migrate 后重跑 | 目标草稿不被覆盖；已完成后返回 already-migrated；失败无半绑定 |
| migrate 失败（复制/校验/绑定前） | 旧仓/source 不变，自建目标清理，registry 不变 |
| 旧 `.mdx` 出现在主读取入口 | 主入口不读取；只有 migrate 读取 |

### 5. 测试矩阵（真实临时双 Git + 故障注入，不 mock Git）

- `tests/knowledge-capture.test.ts`：inbox-only K1、无 trailer/meta/global 变化、正式检索排除候选、source 字节冻结；docs 草稿保留；staged 阻断；`beforeIndexLock` 并发 `git add` 不被覆盖；发布后 index 同步失败（fault injection）报 cleanup_required；外部 meta/README 改动保留并报告；无绑定/非分支/非独立 Git 拒绝。
- `tests/knowledge-update-prune.test.ts`：update 报告候选；promote（docs+meta+relations+候选移除）单 K1 原子；reject 单 K1；普通编辑不自动 current；prune 报告证据与 eligible；`--remove` 删除文档并修复入链（requires/related/正文链接），seal 后无结构错误；insufficient 保守保留。
- `tests/knowledge-navigation.test.ts`：确定性渲染与稳定排序（多层、decision/supersedes）；机器区替换保留 human 字节；随 seal 同 commit；删除/重命名后导航正确；导航不进 search；外部 README 改动保留+报告。
- `tests/knowledge-migrate.test.ts`：dry-run 零修改且完整映射/冲突/降级；`.mdx`→`.md`、`code.paths`→`source.paths`、CodeRef 转换、relations/链接重写；新独立 Git/migration baseline/null evidence；扩展名碰撞/目标草稿/无 scope 保守；重跑不覆盖；失败无半绑定；旧仓历史与 source 字节不变。
- CLI schema 覆盖：四个新命令 `--json` 经 `output.schema.json` 校验；`knowledgeError` 复用；namespace scan 无 `lib/v3ng`/`runNg`/`ng*`/`llmdoc.ng-`。
- 既有 M1–M3 全部回归保持通过；最终只跑一遍原样 `npm test` 记录真实 exit/files/tests/duration。

### 6. 分步实施顺序（每步完成即回写本文件，支持断点续接）

1. **M4a 事务分层**：新增 `transaction.ts`，seal 改为复用；回归 M3 `knowledge-review-seal`/`knowledge-cli-commit`/`knowledge-lock` 必须原样通过。
2. **M4b capture**：`capture.ts` + `inbox.ts` + `capture` 命令 + schema + `knowledge-capture.test.ts`。
3. **M4c promote/reject**：`review.ts`/`seal.ts` 写集新增候选移除；`update.ts` + `update` 命令 + schema + promot/reject 测试。
4. **M4d 导航**：`navigation.ts` + seal 集成（机器区、条件写、报告）+ `knowledge-navigation.test.ts`。
5. **M4e prune**：v3-ng prune 报告与 `--remove` 入链修复 + schema + 测试；`upgrade` 改为弃用指引（不再读 V3）。
6. **M4f migrate**：`legacy.ts` + `migrate.ts` + 命令 + schema + `knowledge-migrate.test.ts`。
7. **M4g 收口**：schema/CLI 帮助、namespace scan、`git diff --check`、定向 + typecheck/lint，最后一遍原样 `npm test`；更新 progress 为“M4 实现完成，等待 Codex 集中审查”。

### 7. 续接入口

- 代码起点：`cli/src/lib/knowledge/transaction.ts`；先保证 M3 回归不变再向上叠能力。
- 冻结对象：候选文件格式、`ReviewWriteSet` 新增候选移除字段、README 机器区标记常量（均为数据格式，不用于运行时激活旧实现）。
- 完成后停止，交 Codex 集中 review；不进入 M5，不 stage/commit/reset/push。

## M4a/M4b 实施记录 — 2026-09-11

状态：M4a 事务分层与 M4b capture 完成；M3 seal 回归原样通过；capture 定向通过。未进入 M5，未 stage/commit/reset/push。

### M4a 事务分层

- 新增 `cli/src/lib/knowledge/transaction.ts`：`publishKnowledgeCommit` 统一承载“临时 index 从 K0 read-tree → buildIndex → write-tree/commit-tree → preLockCheck → index 观察/`beforeIndexLock` → index.lock → index 字节 CAS → `beforePublish` → reload+verifyFresh → `beforeCas` → `update-ref` CAS → 原子 index 发布 → `afterPublish`/条件自有文件同步 → cleanup_required”唯一写入通道；导出 `conditionalWrite`/`indexStillMatches`/`readIndexObservation`。
- `cli/src/lib/knowledge/seal.ts` 改为复用该通道：删除内联临时 index/CAS/条件同步实现，保留 manifest 语义、meta 观察门控、`verifyFresh`（结构门控 + S/K0/branch + manifest 漂移）、`consumeNoChange`（含 R3 index 竞态复核）。seal 结果新增 `removedCandidates`。
- 验证：`npx vitest run tests/knowledge-review-seal.test.ts` → exit 0，23/23（含 CAS 竞态、发布后 cleanup_required、no_change index 竞态），证明 M3 语义未被重构破坏。

### M4b capture

- 新增 `cli/src/lib/knowledge/inbox.ts`：候选 ID 规范（`inbox/<id>.md`）、候选解析、K0/worktree 候选枚举、`computeCandidateRemovals`。候选不进入 `docs/**` 模型。
- 新增 `cli/src/lib/knowledge/capture.ts`：复用事务通道，写集仅 `inbox/<candidate>`，无 verification/source trailer、不写 meta/README；`assertCapturePreconditions` 只要求知识分支/无操作态/index 无 staged，不要求 source clean；发布后条件写候选文件。
- `write-context.ts`：`KnowledgeWriteContext` 增加 `k0InboxIds`；`review.ts` 的 `ReviewWriteSet` 增加 `candidates`，`deriveWriteSet` 按 K0 与 worktree inbox 差集计算；`seal.ts` 在临时 index 删除 `inbox/<candidate>`。
- CLI：`capture` 命令（`--title/--note/--from/--body/--source-revision/--source/--knowledge`）；`output-schema` 新增 `capture`、共用 `syncResult`；`commit/review` schema 增加 `removedCandidates`/`candidates`。
- 新增 `cli/tests/knowledge-capture.test.ts`（9，真实双 Git）：inbox-only K1、无 trailer、meta/global 不变、正式读取排除候选、source 字节冻结；docs 草稿保留；任意 staged 阻断；`beforeIndexLock` 并发 `git add` 不被覆盖；发布后 cleanup_required；外部 meta/README 草稿保留；无绑定拒绝；source dirty 仍可 capture。
- 验证：`npx vitest run tests/knowledge-capture.test.ts` → exit 0，9/9；`npm run typecheck` exit 0。

剩余问题：README 导航、update/prune 编排、migrate、upgrade 去 V3 读取、CLI 帮助与最终全量门禁。
下一步入口：M4c `update.ts` promote/reject（复用 Review Manifest 候选移除）+ schema + 测试。

## M4c/M4d 实施记录 — 2026-09-11

状态：update promote/reject 原子编排与 README 导航生成完成；定向通过。未进入 M5，未 stage/commit/reset/push。

### M4c update（promote/reject）

- `review.ts`：`ReviewWriteSet` 增加 `candidates`；`deriveWriteSet` 按 K0 inbox 与 worktree inbox 差集计算移除；`confirmReviewManifest` 修正为传入 context（否则 confirmed manifest 丢失候选移除与导航写集）。`write-context.ts` 增加 `k0InboxIds`。
- `seal.ts`：临时 index 删除 `inbox/<candidate>`；seal 结果增加 `removedCandidates`。
- 新增 `cli/src/lib/knowledge/update.ts` + `commands/update.ts` + CLI `update`：显式 `--promote <candidate> --to/--kind/--description/--source-path/--requires/--related/--supersedes`（写 canonical doc 并删除候选）、`--reject <candidate...>`（仅删除候选）、`--prepare`（从当前 worktree 形成未确认 manifest）；绝不提交、绝不置 current。
- schema：新增 `update`、`syncResult`；`commit` 增加 `removedCandidates`，`review.writeSet` 增加 `candidates`。
- 新增 `tests/knowledge-update-prune.test.ts`（update 部分 5）：报告候选；promote 后 docs+meta+relations+候选移除单 K1 且重算 `current`；reject 候选只产生候选移除提交且 meta 字节不变；普通编辑只是候选且不自动 current；非法 promote 拒绝（`E_INVALID_KIND`/`E_DOCUMENT_INVALID`）。
- 修复过程中发现并修正：promotion 未删除候选；`confirmReviewManifest` 未传 context 造成 confirmed manifest 写集漂移；调试插桩已全部移除。

### M4d README 导航

- 新增 `cli/src/lib/knowledge/navigation.ts`：`NAVIGATION_START/END` 标记、确定性的 `renderNavigation`（topic 分组、稳定排序、kind、decision/supersedes 标注）、`readNavigationRegion`、`replaceNavigationRegion`（机器区外字节逐字保留）、`navigationChanged`、`renderNavigationReadme`。
- `review.ts::deriveWriteSet`：仅在文档集合/路径发生变化（add/update/delete/candidate 移除）时把 `README.md` 加入 generated（纯 meta-only/全局复核不伪造 README 提交）。
- `seal.ts`：README 与 meta 一样先写入临时 index（否则导航不会进入 K1），发布后按 seal 前观察值条件写 worktree；外部改动保留并报 `cleanup_required`。
- `update.ts` 输出真实 `navigationChanged`。
- 新增 `tests/knowledge-navigation.test.ts`（7，真实双 Git）：确定性渲染（多层、supersedes）、机器区替换保留 human 字节、无标记时追加、随 seal 同 commit、删除后导航正确、外部 README 改动保留且 `cleanup_required`、正式检索不返回导航文本。

剩余问题：prune、migrate、upgrade 去 V3 读取、CLI 帮助与最终全量门禁。
下一步入口：M4e prune（v3-ng 收敛报告 + `--remove` 入链修复）与 `upgrade` 弃用指引。

## M4e/M4f 实施记录 — 2026-09-11

状态：v3-ng prune、upgrade 弃用、显式 migrate 完成；定向通过。未进入 M5，未 stage/commit/reset/push。

### M4e prune 与 upgrade

- 新增 `cli/src/lib/knowledge/prune.ts` + 重写 `commands/prune.ts` + CLI `prune`（`--report` 默认只读；`--remove <id...>` 显式删除；`--global`）。报告基于 K0 模型与 validity：仅“精确重复（同 topic/kind/description）或已被 supersede”的文档 `eligible`，仅 fragment 的候选保留 `eligible:false`（insufficient 保守保留）。`--remove` 校验 eligible，删除 docs 并重写所有入链（requires/related/supersedes）与正文链接，然后形成未确认 Review Manifest；发布仍走 `commit --review`。
- `errors.ts` 新增 `E_PRUNE_INSUFFICIENT`(2)。
- `upgrade` 改为弃用指引：不再读取任何 V3 `.mdx`/CodeRef/code.paths/meta/config，仅输出 `migrate --dry-run` 用法。
- schema：重写 `prune`（`llmdoc.prune/v1` + `pruneCandidate`）与 `upgrade`（deprecated）。
- 测试：`knowledge-update-prune.test.ts` 增加 prune 3 例（重复/碎片报告、删除并入链修复后 `current`、insufficient 拒绝）；`cli-misc.test.ts` 首例改为“无绑定 prune 失败闭锁 + upgrade 弃用”。

### M4f migrate

- 新增 `cli/src/lib/knowledge/legacy.ts`：唯一 V3 只读解析器（`llmdoc/**/*.mdx`、`llmdoc/meta.json`、`llmdoc.config.json`、CodeRef、`code.paths`）。产出逐文件计划：kind/description/source.paths 校验、CodeRef→文字证据、`.mdx`→`.md` 链接与关系重写、目标 ID 规范化、case-insensitive 目标碰撞检测、无 scope/非法 kind/解析失败保守 skip 并附 warning；仅被迁移文档之间的关系保留。
- 新增 `cli/src/lib/knowledge/migrate.ts` + `commands/migrate.ts` + CLI `migrate`（`--source/--legacy/--knowledge/--dry-run/--nested`）。dry-run 零写；真实迁移在 registry 锁内检查旧绑定冲突、目标可用性，`git init` 新独立仓、写 skeleton 与转换文档、`write-tree/commit-tree/update-ref` 建 migration baseline（不抽取/不改旧历史）、结构校验通过后才写绑定；失败清理自建构件、绝不改旧仓/旧绑定/source。新 meta 一律 `null/null/[]/{}`，旧 validatedRevision 仅作报告来源说明。重跑在已绑定时返回 `already_migrated` 且不覆盖目标草稿。
- 抽取 `renderKnowledgeDocumentContent` 到 `document.ts`，`update.ts` 与 `legacy.ts` 共用。
- schema：新增 `migrate`（`llmdoc.migrate/v1` + `migrateDocument` + `legacyIssue`）。
- 测试：新增 `knowledge-migrate.test.ts`（6，真实临时 Source/Knowledge Git）：dry-run 零修改且完整映射/降级；成功迁移（`.mdx`→`.md`、CodeRef 转换、链接/关系重写、null evidence、新独立 Git、写绑定、正式读取为 v3-ng）；重跑不覆盖草稿；非空目标拒绝且无半绑定；目标不可创建时无半绑定；case-insensitive 碰撞检测。
- 新增 `knowledge-maintenance-cli.test.ts`（1）：capture/update/prune/migrate/upgrade 的 `--json` payload 经运行时 schema 校验。

验证：`knowledge-capture` 9/9、`knowledge-update-prune`（含 prune）8/8、`knowledge-navigation` 7/7、`knowledge-migrate` 6/6、`knowledge-maintenance-cli` 1/1 全部 exit 0；`npm run typecheck` exit 0；`npm run lint` exit 0。

剩余问题：Final 全量门禁与 namespace scan、progress 收口。
下一步入口：M4g 收口（schema/帮助已同步；namespace scan、`git diff --check`、定向 knowledge 套件、最终一遍原样 `npm test`）。

## M4g 收口与最终验证 — 2026-09-11

状态：**M4 实现完成，等待 Codex 集中审查。** 未进入 M5，未 stage/commit/reset/push。

### 实际 diff（29 files：14 改 / 15 新增；+4221 / -726）

- 新增：`cli/src/lib/knowledge/{transaction,inbox,capture,update,prune,navigation,legacy,migrate}.ts`、`cli/src/commands/{capture,update,migrate}.ts`、`cli/tests/{knowledge-capture,knowledge-update-prune,knowledge-navigation,knowledge-migrate,knowledge-maintenance-cli}.test.ts`。
- 修改：`cli/src/lib/knowledge/{seal,review,write-context,document,errors}.ts`、`cli/src/commands/{prune,upgrade}.ts`、`cli/src/cli.ts`、`cli/src/lib/output-schema.ts`、`cli/schemas/output.schema.json`、`cli/tests/{cli-misc,knowledge-review-seal}.test.ts`、`docs/v3-ng-design/progress.md`。
- `seal.ts` 从内联写事务收敛为复用 `transaction.ts`；`review.ts` 写集新增候选移除与 README 导航；`document.ts` 抽取 `renderKnowledgeDocumentContent`。
- 无 `lib/v3ng`/`runNg`/`ng-*`/`llmdoc.ng-*`；无 V3 runtime dispatch/fallback；旧 V3 读取仅存在于显式 `migrate`（`legacy.ts`）；`upgrade` 改为不读 V3 的弃用指引。

### 验证证据（真实临时双 Git + 故障注入）

- 定向 knowledge 套件（`npx vitest run knowledge-`）：exit 0，**23 files / 195 tests**，Duration 1236.91s（含 knowledge-review-seal 23、capture 9、update/prune 8、navigation 7、migrate 6、maintenance-cli 1 及 M1–M3 全部回归）。
- `npx vitest run tests/cli-misc.test.ts tests/cli-output-schema.test.ts`：exit 0，2 files / 6 tests（prune 无绑定失败闭锁、upgrade 弃用、公开 JSON schema）。
- `npm run typecheck` exit 0；`npm run lint` exit 0。
- 破坏性 namespace scan：`rg -n "lib/v3ng|runNg|ng-read|ngTree|ngError|ngIndex|ngShow|ngSearch|ngContext|llmdoc\.ng-" cli/src cli/tests cli/schemas` → 无命中（exit 1）。
- `git diff --check` exit 0（仅 LF/CRLF 提示）。
- **最终一遍原样全量 `npm test`**（`cmd /c "npm test > .llmdoc-tmp\m4full.log 2>&1"` 后立即读真实 `$LASTEXITCODE`，无筛选管道）：**exit 0，34 files / 236 tests 全过，无 Unhandled/Timeout，Duration 1407.43s**。
- 环境核对：分支 `v3-ng`；`git diff --cached` 为空（index 无 staged）；真实 `%APPDATA%\llmdoc` 与 bindings.json 不存在；未 stage/commit/reset/push；`.codegraph/`、`.llmdoc-tmp/` 未纳入实现。

### 需求 A–D 落点与限制

- A capture：inbox-only 写事务（同锁/临时 index/CAS/条件同步），无 trailer、不推进 meta/global，source 可 dirty；staged 与并发 `git add` 阻断；docs 草稿保留；发布后失败报 K1+`cleanup_required`。
- B update/prune：只形成候选/未确认 manifest；promote 的 docs+meta+relations+候选移除单 K1；prune 仅删有充分证据（精确重复/supersede），fragment 保守保留，删除修复全部入链；复用 seal 的 S/K0、digest/scope/requires、manifest 失效。
- C README 导航：只替换机器标记区、保留 human 字节；不进检索/验证；在文档集合/路径变化时随 seal 同 commit；删除/多层/decision+supersedes 正确；外部改动保留并报 `cleanup_required`。
- D migrate：唯一 V3 读入口，dry-run 零写；新外置独立 Git + migration baseline，不抽取历史；证据保守为 `null/null/[]/{}`；碰撞/无 scope/目标草稿保守；绑定仅在目标校验通过后写入；失败无半绑定。
- 明确边界（按里程碑划分，M5 处理）：`new/adopt/mv/fingerprint/init-state` 仍为既有实现在 M5 统一；HTTP viewer/hooks/skills/agent prompts/双语文档/示例未在本轮改动；`upgrade` 仅保留弃用指引。
- 已知张力与判断：导航仅在文档集合/路径变化时随 seal 生成（纯 meta-only/全局复核不伪造 README 提交），以保持 M3 的 `no_change` 与 meta-only 语义；首次文档变更前的空导航区视为待重建，不视为协议违规。

下一步：停止，交 Codex 集中 review M4；通过前不进入 M5，不 stage/commit/reset/push。

## M4 Codex 集中审查 R1 与返修计划 — 2026-09-11

状态：设计先行，先落本计划再改代码。Codex 集中审查未通过，R1 共 16 项（14 个 P1/P2 + 1 个方向阻断 + 1 个测试真实性）必须在本 M4 内关闭；不进入 M5，不改冻结协议，不 stage/commit/reset/push，不触碰仓库外文件。共同边界：所有 `prepare` 只能生成可审查草稿而不能毁数据；所有发布后同步必须区分 K1 已发布与本地草稿未同步；migration 是从不可信旧输入到新协议的单次导入事务，不能把解析成功当语义无损；breaking replacement 以可执行入口为准，不以注释或未来 M5 承诺为准。

### 1. 逐项独立根因判断（核对 architecture/roadmap 原文，不迎合既有测试）

1. **P1 prune 毁草稿（确认）**：`prune.ts::buildPruneReport` 用 `context.k0Model` 判定 eligible，`applyPruneRemoval` 却对 worktree `fs.rmSync`；K0 重复/被 supersede 的文档若有未提交重写仍会被删。删除资格必须基于当前内容，且目标字节相对 K0 有漂移即拒绝。
2. **P1 update 消费未提交草稿（确认）**：`update.ts::validateRequests` 只 `fs.existsSync`，`applyPromotions/applyRejections` 直接 `rmSync`；`summarizeCandidates` 已标 `committed=false` 却未阻断。只有 K0 committed candidate 可 promote/reject；未提交草稿可列出但决策明确阻断。
3. **P1 migrate 失败清理不完整（确认）**：`cleanupTarget` 只删 `.git`、根文件、`.gitkeep`，遗留 `docs/**/*.md`、`.llmdoc/meta.json`，半成品无法重试；且清理失败被静默吞掉。自建 target 失败须安全删除整根；预存在空目录须精确清除本次全部产物；清理失败结构化报告残留路径。
4. **P1 legacy 悬空引用（确认）**：`legacy.ts` 的关系/链接重写基于 `legacyIds`（全部旧文件），而非最终 converted target set；指向 skipped/collision 文档的关系/链接被改写成指向未迁移的 `.md`，触发结构错误使全迁移失败。必须基于最终可迁移集合二次解析/重写；无法保真的引用 warning 并移除/保守处理且明确报告，不伪造无损。
5. **P1 无损门槛不足（确认）**：`convertLegacyBody` 只处理自闭合 `<CodeRef .../>`；未知 JSX/MDX 组件、非自闭合/无法解析 CodeRef 等残留却标 `converted`。检测残留 MDX/JSX 与不可表达语法，保守 `skipped` + warning。
6. **P1 target/legacyRoot 未隔离（确认）**：`migrateKnowledge` 只查 source 包含关系，未禁止 `target==legacyRoot`、`target` 位于 `legacyRoot` 内、`legacyRoot` 位于 `target` 内。必须 junction/realpath 感知地在任何写入前阻断，保证旧知识树绝不被 mkdir/git init/清理触碰；dry-run 仍可报告。
7. **P1 README marker 注入（确认）**：`escapeNavigationText` 未处理 `NAVIGATION_START/END`，`readNavigationRegion` 用首次 `indexOf`；标题/description 注入 marker 会让下一次重建截断/重复 human 内容。对保留 marker 与破坏 Markdown 的字符做稳定转义/编码，补两次生成回归并断言 human 字节不变。
8. **P1 conditionalWrite TOCTOU（确认）**：`transaction.ts::conditionalWrite` 先 compare/read 再 `renameSync`；并发编辑可在比较后被覆盖，`observation=null` 也会覆盖刚创建的同名文件。absent→create 至少用 `wx` 原子创建；existing replacement 需可验证互斥/CAS（独占 sidecar 锁 + 复检），无法保证则保守失败，绝不覆盖他人字节；补可控 seam 复现 compare 后竞态。
9. **P1 seal 候选发布后同步缺失（确认）**：`seal.ts` 只在 temp index 删除 `writeSet.candidates`，未把候选路径纳入 post-publish condition/delete sync；候选在 final verify 后/CAS 前被重建时 K1 删除但 worktree 留 untracked draft，`cleanupRequired=false`。候选删除必须有带观察值的条件删除计划；并发新草稿保留并报 `cleanup_required`/unsynced；正常路径 worktree clean。
10. **P1 inbox readdir 误判（确认）**：`inbox.ts::listWorktreeInboxIds` 捕获全部 readdir 异常返回 `[]`；权限/瞬态 I/O 被当空目录，可能误判 committed candidates 全被删除。只有 `ENOENT` 可视为空，其余 `E_FILESYSTEM_IO(70)` 阻断。
11. **P2 README 人工区 pre-CAS 漂移（确认）**：`seal.ts` 以 seal 前 README 观察值构造 K1 并发布，人工区在观察后/CAS 前变化时先发布陈旧 human 字节、事后才报 cleanup。README（及所有带观察值的生成文件）须纳入 final pre-CAS 校验，漂移在发布前 invalidated，HEAD/index 不动、人工修改保留。
12. **P2 migration baseline 空导航（确认）**：`writeMigratedSkeleton` 写空 marker 区，导航要等下一次 seal。迁移写完 docs 后必须用新模型渲染真实导航，并在同一个 migration baseline commit 提交。
13. **P2 migration plan TOCTOU（确认）**：`planLegacyMigration` 在 registry 锁外读取 legacy，锁内直接写。锁内重做完整计划，并记录每个 legacy 输入字节 digest，在发布/绑定前复核；任一变化阻断且不绑定、不遗留目标。
14. **P2 already_migrated 判定过弱（确认）**：`isInitializedKnowledgeRoot` 只看 `.git`/config/meta 存在。必须验证有效 HEAD、分支/操作态、repositoryId、完整 Knowledge model/meta/structure，并确认绑定目标精确匹配；损坏目标不得返回成功。
15. **方向阻断 breaking replacement 未成立（确认）**：`cli.ts` 仍暴露 `fingerprint/init-state/new/adopt/mv` 与 deprecated `upgrade`，`hook/serve` 仍走旧 V3 workspace，均直接读写旧 `.mdx`/meta。必须从主 CLI、静态 imports、output schema 和公开测试中移除所有旧 V3 runtime command/dispatch/compatibility surface；`new/mv` 暂无 v3-ng 实现则先移除入口，后续按新协议实现，绝不回落旧实现。hook/skills/viewer 新接入留 M5，旧 V3 runtime 入口现在即不可达。
16. **测试真实性（确认）**：`knowledge-update-prune.test.ts` 的「普通编辑不自动 current」用例断言了 `current`（读 K0）来规避 worktree 草稿状态问题。最终必须明确断言：正文或 front matter 普通编辑后 worktree 状态为 `needs_review`，`update --prepare` 不提交、不自动写验证 evidence，且不得删除该断言或接受 `current`。

### 2. 修复不变量（返修后必须恒成立）

- **prepare 不毁数据**：prune/update 只改 worktree 草稿并形成未确认 manifest；删除资格基于当前内容，目标相对 K0 有漂移一律拒绝；未提交候选不可 promote/reject。
- **发布后同步区分已发布/未同步**：K1 发布后，候选删除与生成文件写入都带 seal 前观察值条件执行；观察值漂移保留外部字节并报 `cleanup_required`/unsynced；final pre-CAS 能发现的漂移在发布前 `E_REVIEW_INVALIDATED`。
- **migration 是单次导入事务**：不可信旧输入只读；最终可迁移集合二次解析；无损不可保真即 skip/warning；target 与 legacyRoot 严格隔离；失败清理完整或结构化报告残留；baseline 自带真实导航；锁内重做计划并对 legacy digest 复核；already_migrated 必须完整校验。
- **breaking replacement 以可执行入口为准**：主 CLI 无任何旧 V3 runtime command/dispatch/静态 import；output schema 无旧 V3 契约；公开测试不依赖旧 V3 入口；旧 `.mdx`/meta 只能由 `migrate` 读取。
- **测试真实性**：普通编辑 → worktree `needs_review`；`update --prepare` 不 commit、不写 evidence；断言不可被弱化。

### 3. 失败路径矩阵（新增，均需真实双 Git + 故障注入）

| 场景 | 期望 |
|---|---|
| prune 目标相对 K0 有未提交重写 | 拒绝删除；HEAD/index/草稿字节均保留 |
| prune 正常 eligible 且目标 clean | 删除并入链修复，seal 后结构有效 |
| update promote/reject 未提交候选 | 明确阻断（E_CANDIDATE_UNCOMMITTED, 2）；草稿保留、HEAD 不动 |
| update promote/reject K0 committed candidate | 正常；docs+meta+relations+候选移除单 K1 |
| migrate 自建 target 中途验证失败 | 整根安全删除，registry/source/旧仓不变，可重试成功 |
| migrate 预存在空目录中途失败 | 精确清除本次全部产物，目录保留，可重试 |
| migrate 清理本身失败 | 结构化错误携带残留 paths，不声称无残留 |
| legacy 关系/链接指向 skipped/collision | 二次解析后移除并 warning；不产生悬空引用 |
| legacy 含未知 JSX/MDX 或不可解析 CodeRef | skipped + warning；不标 converted |
| target==legacyRoot / 互相包含 | 写前阻断；dry-run 仅报告；旧树零触碰 |
| README 标题/description 含 marker | 稳定转义；两次生成 human 字节不变、region 唯一 |
| conditionalWrite observation=null 且文件已存在 | 返回 false，字节保留（wx） |
| conditionalWrite compare 后并发写 | seam 复检发现，返回 false，他人字节保留 |
| seal 候选在 final verify 后重建 | K1 无候选；worktree 保留新草稿；cleanupRequired=true |
| seal README 人工区 pre-CAS 漂移 | E_REVIEW_INVALIDATED；HEAD/index 不动；人工修改保留 |
| inbox 目录读失败（非 ENOENT） | E_FILESYSTEM_IO(70)；不误判空 |
| migration baseline | README 含真实导航，与 docs 同 commit |
| legacy 在锁内计划后被外部改动 | digest 复核失败，阻断、不绑定、清理目标 |
| already_migrated 目标损坏 | 不返回成功；结构化错误 |
| 普通 Markdown 编辑 | worktree needs_review；update --prepare 不 commit、不写 evidence |
| 旧 V3 命令（new/mv/adopt/fingerprint/init-state/upgrade/hook/serve） | 主 CLI 不可达；无静态 import/schema/公开测试 |

### 4. 测试矩阵（新增/改写，真实临时双 Git + 故障注入）

- `knowledge-update-prune.test.ts`：prune 目标漂移拒绝并保留 HEAD/index/草稿；未提交候选 promote/reject 阻断；改写普通编辑用例为 worktree `needs_review` + 不提交 + 不写 evidence。
- `knowledge-migrate.test.ts`：清理完整性与重试（验证/registry 写失败注入）；target/legacyRoot 重叠阻断（含 junction，平台支持时）；legacy 悬空关系/链接移除；未知 JSX/MDX/非自闭合 CodeRef skip；baseline 导航；legacy digest 复核；already_migrated 损坏目标。
- `knowledge-navigation.test.ts`：marker 注入转义与两次生成稳定；README pre-CAS 漂移 invalidated（原 external 用例改写）。
- `knowledge-capture.test.ts`：conditionalWrite 竞态 seam；inbox 读失败 E_FILESYSTEM_IO。
- `knowledge-review-seal.test.ts`：候选 final-verify 后重建 → cleanup_required 且草稿保留。
- 移除旧 V3 公开测试：`cli-write/cli-hooks/cli-startup-config/cli-startup-preload/cold-start/viewer-http/viewer-state/viewer-assets`；改写 `cli-misc/cli-output-schema/knowledge-maintenance-cli` 去掉 upgrade/hook/viewer/fingerprint/new/mv。
- 既有 M1–M4 回归保持通过；最终一遍原样 `npm test` 记录真实 exit/files/tests/duration。

### 5. 分步实施顺序（每步完成即回写本文件）

1. **R1-a 数据安全**：#1 prune 漂移拒绝、#2 未提交候选阻断、#10 inbox readdir 分类。
2. **R1-b 事务同步**：#8 conditionalWrite wx/锁 CAS、#9 候选条件删除、#11 生成文件 pre-CAS 校验、#7 导航转义。
3. **R1-c migration**：#3 清理完整、#4 二次解析、#5 无损门槛、#6 路径隔离、#12 baseline 导航、#13 锁内计划+digest、#14 already_migrated 校验。
4. **R1-d breaking replacement**：#15 移除旧 V3 runtime 命令/静态 imports/schema/公开测试。
5. **R1-e 测试真实性**：#16 worktree needs_review 断言。
6. **R1-f 收口**：定向测试 → typecheck/lint → 严格 legacy runtime namespace/CLI surface scan → `git diff --check` → 一遍原样 `npm test`；清理 `.llmdoc-tmp` 调试文件；回写实际结果与关闭证据，标记「M4 R1 返修完成，等待 Codex R2」。

### 6. 续接入口

- 代码起点：`prune.ts`/`update.ts`/`inbox.ts` → `transaction.ts`/`seal.ts`/`navigation.ts` → `legacy.ts`/`migrate.ts` → `cli.ts`/`output-schema.ts`/schema.json → 测试。
- 每步完成立即在本节下方追加「R1-x 实施与验证记录」，含变更文件、真实命令输出、剩余问题与下一步。
- 完成后停止，交 Codex R2；不进入 M5，不 stage/commit/reset/push。

## M4 R1 返修实施与验证记录 — 2026-09-11

状态：**M4 R1 返修完成，等待 Codex R2。** 16 项 findings 全部关闭并取得真实回归证据；最终一遍原样全量 `npm test` exit 0（26 files / 220 tests，Duration 1961.77s，无 Errors/Unhandled/Timeout）。未进入 M5，未 stage/commit/reset/push。

### R1-a 数据安全（#1/#2/#10）

- `prune.ts`：`buildPruneReport` 改用 `context.worktreeModel`（资格基于当前内容）；`applyPruneRemoval` 改 async，逐个目标读取 K0 blob 并与 worktree 字节比较，漂移即 `E_PRUNE_INSUFFICIENT`(2)，不 rm。
- `update.ts`：`validateRequests` 改 async，只有 K0 committed candidate 且 worktree 字节等于 K0 blob 才允许 promote/reject；未提交或已改草稿抛 `E_CANDIDATE_UNCOMMITTED`(2)。
- `inbox.ts`：`listWorktreeInboxIds` 仅 `ENOENT` 视为空；其余 readdir 失败抛 `E_FILESYSTEM_IO`(70)。
- `errors.ts`：新增 `E_CANDIDATE_UNCOMMITTED`、`E_MIGRATION_TARGET_OVERLAP`、`E_LEGACY_CHANGED`。

### R1-b 事务同步（#7/#8/#9/#11）

- `transaction.ts`：`conditionalWrite` 在 `observation=null` 时用 `wx` 原子创建（拒绝覆盖并发新文件）；已有文件用 sidecar 独占锁 + compare/复检的 CAS，失败保守返回 false；新增 `ConditionalWriteHooks.afterCompare` seam 与 `conditionalDelete`；`GeneratedFilePlan` 新增 `remove`，post-publish 对候选做条件删除并报 unsynced/`cleanup_required`。
- `seal.ts`：把 `manifest.writeSet.candidates` 加入 generated 删除计划（带 seal 前观察值）；`verifyFresh` 增加 `assertGeneratedFilesUnchanged`，README/meta/候选在确认后漂移即发布前 `E_REVIEW_INVALIDATED`。
- `navigation.ts`：`escapeNavigationText` 稳定转义 `& < > [ ]`，标题/description 无法再注入 `NAVIGATION_START/END`。

### R1-c migration（#3/#4/#5/#6/#12/#13/#14）

- `legacy.ts`：两阶段计划——先扫描（kind/description/sourcePaths + CodeRef 转换 + 不可表达语法检测），再基于最终 converted 集合解析关系与正文链接；指向 skipped/collision 的关系/链接被移除并 warning（`legacy.relation.target-skipped`/`legacy.link.target-skipped`）；未知 JSX/MDX、非自闭合/无法解析 CodeRef 保守 `skipped`（`legacy.conversion.unsupported`）；`LegacyPlan` 新增 `legacyDigests`。
- `migrate.ts`：真实迁移在 registry 锁内重做完整 plan；新增 `assertMigrationRootsIsolated`（target==legacy、互相包含，realpath/junction 感知，写前阻断，dry-run 仍报告）；`writeMigratedSkeleton` 在 baseline commit 内用新模型渲染真实导航；`assertLegacyInputsUnchanged` 在验证/绑定前复核所有 legacy 输入 digest；`cleanupTarget` 对自建 target 删整根、预存在空目录精确清除全部本次产物并返回残留；残留非空时结构化 `E_FILESYSTEM_IO`(70) 报告；`isInitializedKnowledgeRoot` 校验 committed HEAD/分支/操作态/repositoryId/meta/结构，损坏目标抛 `E_KNOWLEDGE_NOT_INITIALIZED`；新增 `MigrateTestHooks`（`beforeTargetValidate`/`beforeRegistryWrite`）故障注入。

### R1-d breaking replacement（#15）

- 删除旧 V3 runtime 命令模块：`commands/{new,adopt,mv,fingerprint,init-state,upgrade,hook,serve}.ts`。
- `cli.ts`：移除上述静态 imports 与全部 command 注册；help 快速参考去掉 deprecated upgrade 与 hook/serve；`runCli` 去掉未用的 stdin 形参。
- `bin/llmdoc.ts`：不再读取 hook stdin。
- `output-schema.ts` + `schemas/output.schema.json`：删除 `fingerprint/upgrade/new/adopt/mv/hook/initState` 契约。
- 删除旧 V3 公开测试：`cli-write/cli-hooks/cli-startup-config/cli-startup-preload/cold-start/viewer-http/viewer-state/viewer-assets/helpers.ts`；改写 `cli-misc/cli-output-schema/knowledge-maintenance-cli`。

### R1-e 测试真实性（#16）

- `knowledge-update-prune.test.ts`：普通正文/front matter 编辑后断言 worktree 投影 `needs_review`（新增 `worktreeValidityFor`），`update --prepare` 不 commit、meta 字节不变、不写 evidence；新增未提交候选 promote/reject 阻断与 prune 漂移拒绝用例。

### R1 定向验证（真实临时双 Git + 故障注入）

- `knowledge-navigation` 8/8、`knowledge-capture` 11/11、`knowledge-update-prune` 10/10（含新增漂移/未提交候选/worktree needs_review）。
- `knowledge-migrate` 16/16（含 baseline 导航、JSX/CodeRef skip、悬空引用、路径重叠、junction/symlink 到达 legacy 的阻断、清理重试、registry 失败、legacy digest、损坏目标）。
- `knowledge-review-seal` 24/24（含候选 final-verify 后重建 cleanup_required）。
- `knowledge-cli-commit` 3/3、`knowledge-maintenance-cli` 1/1、`cli-misc` 3/3、`cli-output-schema` 2/2。
- `knowledge-read` 13/13、`knowledge-r1` 10/10、`knowledge-r2` 10/10、`knowledge-status-delta` 4/4、`knowledge-validate` 4/4。
- `npm run typecheck` exit 0；`npm run lint` exit 0；`git diff --check` exit 0（仅 LF/CRLF 提示）。
- namespace/CLI surface scan：`lib/v3ng|runNg|ng-read|ngTree|ngError|...`、旧命令模块/`runNew|runMove|...`、旧 `.command("new"|...)` 全部无命中。
- 全量门禁首跑 exit 1：仅 2 个失败，均为 `knowledge-cli-commit` 首用例超 30s 超时并级联（连带 `E_REVIEW_INVALID` 假失败）；已把该文件与 `knowledge-maintenance-cli`/`knowledge-update-prune` 的 per-file testTimeout 提升到 90s（调度参数，未改断言/未吞错），隔离复跑 3/3 + 1/1 通过。

### 最终全量门禁与关闭证据

- 最终一遍原样 `npm test`（`cmd /c "npm test > .llmdoc-tmp\m4r1full3.log 2>&1"` 后立即读真实 `$LASTEXITCODE`，无筛选管道）：**exit 0，26 files / 220 tests 全过，无 Errors/Unhandled/Timeout，Duration 1961.77s**。首跑 exit 1 仅两个超时级联，已用 per-file testTimeout 修复后隔离与全量均通过；随后新增 #6 junction 回归再跑一次仍 exit 0。
- `npm run typecheck` exit 0；`npm run lint` exit 0；`git diff --check` exit 0（仅 LF/CRLF 提示）。
- namespace/CLI surface scan 全部无命中：`lib/v3ng|runNg|ng-read|ngTree|ngError|ngIndex|ngShow|ngSearch|ngContext|llmdoc.ng-`、旧命令模块/`runNew|runMove|runFingerprint|runHook|runAdopt|runInitState|runUpgrade|runServe`、旧 `.command("new"|"adopt"|"mv"|"fingerprint"|"init-state"|"upgrade"|"hook"|"serve")`。
- 环境核对：分支 `v3-ng`；`git diff --cached` 为空（index 无 staged）；真实 `%APPDATA%\llmdoc` 不存在；调试日志目录 `.llmdoc-tmp` 已删除；未 stage/commit/reset/push。
- 逐项关闭证据：1 漂移拒绝 + 草稿保留；2 未提交候选 promote/reject 阻断；3 自建/预存在目标清理、重试、registry 失败注入；4 悬空关系/链接移除并 warning；5 JSX/MDX/非自闭合 CodeRef 保守 skip；6 target/legacyRoot 重叠写前阻断；7 marker 转义两次生成稳定；8 `wx` 创建 + compare/复检 seam；9 候选重建 cleanup_required 且草稿保留；10 非 ENOENT 读失败 E_FILESYSTEM_IO；11 README pre-CAS invalidated；12 baseline 真实导航；13 锁内重做 plan + legacy digest 复核；14 损坏目标不返回 already_migrated；15 旧 V3 runtime 命令/静态 imports/schema/公开测试全移除；16 普通编辑 worktree needs_review 且 prepare 不提交/不写 evidence。

### 剩余问题与下一步

- 停止，交 Codex R2；通过前不进入 M5。
- 旧 V3 lib 模块（workspace/state/config/viewer-* 等）已无主 CLI 引用，物理删除留 M5 统一清理；主入口、静态 imports、schema 与公开测试已无旧 V3 runtime surface。
- 关联 commit：无（按约定不提交、不暂存）。

## M4 Codex 集中审查 R2 与返修计划 — 2026-09-11

状态：设计先行，先落本计划再改代码。Codex R2 共 11 项（A1–A4、B1–B4、C1–C3）必须在本 M4 内关闭；不进入 M5，不改冻结 architecture/roadmap，不 stage/commit/reset/push，不触碰仓库外文件。共同边界：migration 是从不可信旧输入到新协议的单次导入事务，输入集合、目标提交树与目标所有权必须在写绑定前被完整复核；update/prune 的 prepare 只能在完整结构校验通过后一次性改写 worktree，任何失败都不得留下部分变更；事务 helper 的失败清理必须精确到本次创建的临时资源，并保持冻结协议声明的 cooperating-writer 边界（不宣称锁住不遵守协议的任意外部编辑器）。

### 1. 逐项独立根因判断（核对 architecture §1/§3/§4/§5/§6/§7，不迎合既有测试）

- **A1 [P1] legacy 输入最终校验不完整（确认）**：`migrate.ts` 仅在 `beforeTargetValidate` 前调用一次 `assertLegacyInputsUnchanged`；`beforeRegistryWrite` seam 在其后仍可改旧输入并被绑定。且 `plan.legacyDigests` 只覆盖计划时刻存在的文件，新增 `.mdx` 或计划时刻不存在的 `meta.json`/`llmdoc.config.json` 不在集合内，无法发现新增/删除。破坏的不变量：绑定必须只针对“计划时所见且此后未变的完整 legacy 输入集合”。修复：抽出唯一枚举函数 `collectLegacyInputDigests(sourceRoot, legacyRoot)`，计划与校验共用；校验比较**路径集合 + 每个 digest**，任何新增/删除/修改都 `E_LEGACY_CHANGED`；在验证阶段与 `beforeRegistryWrite` 之后（写 binding 紧前）各调用一次。
- **A2 [P1] 新 target 绑定前验证不完整（确认）**：`assertMigratedTargetValid` 只看 worktree `docs`/`meta` 可解析，不校验 committed HEAD、分支、Git 操作态、`llmdoc.yaml` 的精确 repositoryId、`meta.source.repositoryId`，也不校验 HEAD tree 中 config/meta/docs/README 是否等于预期 baseline。破坏的不变量：绑定只能指向一个“committed 内容 = 本次生成的 migration baseline”且 HEAD/分支/身份精确匹配的健康知识仓。修复：`writeMigratedSkeleton` 返回 `expected: Map<repoPath, Buffer>`；新 `assertMigratedTargetValid(knowledge, repositoryId, expected)` 校验 worktree 布局、有效 HEAD、非 detached 且分支为 `main`、无操作态、`llmdoc.yaml` repositoryId 精确匹配、committed snapshot 的 config/meta repositoryId 匹配且无结构错误、HEAD tree 文件集合与字节完全等于 expected、worktree 全 clean（无 staged/unstaged/untracked/conflict）。
- **A3 [P1] target 可用性 TOCTOU 与清理误删并发内容（确认）**：`assertTargetAvailable` 空目录检查与 `git init`/`writeMigratedSkeleton` 之间无所有权；`cleanupTarget` 在预存在空目录分支用 `listFilesRecursive` 递归删 `docs/**`，在自建分支整根递归删除，可能删掉并发进入的外部字节。破坏的不变量：清理只能删除本次生成且字节仍匹配观察值的路径；外部字节必须保留并结构化报告 residual。修复：空目录检查后立即用 `wx` 建立 target 所有权锁（`<target>.llmdoc-migrate.lock`，失败 `E_MIGRATION_TARGET_LOCKED`）并**复检**仍为空；新增 `beforeTargetInit` 故障注入 seam；skeleton 写完后、`git add` 前用 `assertTargetContentsOwned` 校验 target 内容 ⊆ 本次预期集合（排除本次 `.git`），出现外部路径即 `E_MIGRATION_TARGET_DIRTY`；`git add` 改为显式添加预期路径而非 `.`；`cleanupTarget(targetRoot, createdTarget, expected, lockPath)` 只删本次生成且字节匹配的路径，外部/漂移路径列入 residual，空目录自底向上删除，自建且已空才删根，锁在 finally 释放。
- **A4 [P1] MDX 无损门槛不足（确认）**：`convertCodeRefs` 用 `/<CodeRef\b([\s\S]*?)\/>/` 只认自闭合且只取 `path`/`symbol`，额外属性、动态属性、非自闭合形式可能被部分转换或残留；`detectUnconvertibleSyntax` 只查残留 CodeRef、大写组件、import/export，未识别 MDX expression `{...}` 与 fragment `<>...</>`。破坏的不变量：解析成功不等于语义无损；不可完整表达的语法必须保守 `skipped`。修复：CodeRef 仅在“自闭合 + 属性恰为静态字符串 `path`（可选 `symbol`）”时转换，属性含 `{}`、额外属性、非自闭合一律不转换；先剥离 fenced code block 与 inline code 再检测残留 CodeRef、大写 JSX 组件、import/export、fragment、未转义 MDX expression，任一命中即 `skipped` + `legacy.conversion.unsupported`。
- **B1 [P1] prune exact duplicate 比较过弱（确认）**：`findExactDuplicates` 只用 `topic/kind/description` 组键；同描述但正文、source.paths、relations 不同会被判重复。破坏的不变量：只有能证明语义相同的规范化内容才 eligible。修复：改为结构化内容键 `{topic, kind, description, sorted source.paths, sorted requires/related/supersedes, normalized body}`；仅完全一致才成组。
- **B2 [P1] update promotion 覆盖既有文档/未提交草稿（确认）**：`applyPromotions` 用 `fs.writeFileSync(to)` 直接覆盖。破坏的不变量：promotion 默认 fail closed，目标存在即拒绝；冻结协议没有显式 replace 操作。修复：`validateRequests` 在写前检查目标 id 在 worktree 或 K0 中已存在（或磁盘存在）即抛 `E_DOCUMENT_EXISTS`(2)；`applyPromotions` 用 `wx` 原子创建，绝不覆盖。
- **B3 [P1] update 校验前写 docs/删候选，失败留部分变更（确认）**：`updateLocked` 先 `applyPromotions/applyRejections` 再 `assertReviewPreconditions`/`buildReviewManifest`；relation 缺失、supersedes 类型/环、正文悬空链接、整体结构错误等都会在已改 worktree 之后才暴露。破坏的不变量：任意验证失败时 worktree/candidate/HEAD/index 字节完全不变。修复：`validateRequests` 先在内存用“当前 worktree 文档 − 被提升目标 + 提升后文档”构造 projected `KnowledgeModel` 并拒绝任何 error（覆盖 source.paths 规范、relations 存在性/类型/自引用/环、正文链接、整体模型）；全部通过后才 `applyMutations` 一次性写入（promotion `wx`，rejection 先备份字节再删）；apply 内部与 apply 之后的 `resolveKnowledgeWriteContext`/`assertReviewPreconditions`/`buildReviewManifest`/`writeReviewManifest` 任一步失败都调用 rollback 精确还原（删除新建文档、恢复被删候选）。prune 复用同一 validate-then-apply + rollback 形态。
- **B4 [P2] prune 可删除整个等价组（确认）**：重复组所有成员都被标 eligible，`--remove` 可全删。破坏的不变量：等价组至少保留一个副本。修复：稳定选 `id` 字典序最小的成员为 canonical survivor，报告中标 `eligible:false` + 保留理由，其余成员 eligible；`pruneLocked` 增加守卫，若一次请求覆盖某重复组全部成员则 `E_PRUNE_INSUFFICIENT`(2) 拒绝。
- **C1 [P2] conditionalWrite rename 失败遗留临时文件（确认）**：temp 写成功后 `renameSync` 抛错时 catch 返回 false，finally 只删 sidecar lock，`.llmdoc-sync-*` 残留。破坏的不变量：finally 只清理本次调用创建的临时资源。修复：用局部 `tempPath` 变量记录，成功后置 null，finally 删除仍存在的 temp；新增 `ConditionalWriteHooks.beforeRename` seam 做真实 rename 失败注入。
- **C2 [P2] conditionalWrite 最后指令窗口（确认，保持边界）**：冻结 architecture §6 明确“条件文件更新尽量使用短持锁区与原子替换，不能宣称能锁住不遵守协议的任意编辑器”。不扩大为通用 CAS；保留 cooperating-writer 边界，测试与该边界一致（不新增“锁住任意外部编辑器”的断言）。
- **C3 [P2] conditionalDelete 非空 observation 分支 read→rm 竞态（确认）**：非空分支 compare 后 `rmSync` 之间有窗口；而产品实际只删除 observation 为空的候选（`computeRemovedCandidates` 已保证候选在 seal 计划时不在 worktree）。修复：把 helper 收窄为“仅 observation===null 时成功，且当前仍不存在才成功；存在则保留并 unsynced”；`observation!==null` 一律返回 false（不删除）。seal 的候选删除计划保持 observation=null 语义。

### 2. 修复不变量（返修后必须恒成立）

- **migration 单次导入事务**：legacy 输入集合与每个字节 digest 在计划、验证、写 binding 紧前三次一致；任何新增/删除/修改都不绑定。
- **目标绑定前置条件**：只绑定“committed HEAD 有效、分支/操作态正常、repositoryId（config 与 meta.source）精确匹配、HEAD tree 与本次 baseline 逐字节一致、worktree clean”的目标。
- **目标所有权与清理**：空目录检查后立即独占加锁并复检；只清理本次生成且观察值匹配的路径；外部字节保留并以 residual paths 结构化报告，绝不递归扫掉 `docs`。
- **MDX 无损**：只有协议允许且完整表达的静态 CodeRef 才转换；额外/动态/非自闭合 CodeRef、MDX expression、fragment、未知组件一律 skip+warning。
- **prepare 不毁数据**：prune/update 先完成全部结构校验（projected model），再一次性应用；任意失败回滚到 HEAD/index/candidate/worktree 原字节。
- **promotion fail closed**：目标路径已存在（worktree 或 K0）即拒绝，绝不隐式覆盖。
- **等价组保留副本**：重复组稳定 canonical survivor，仅其余 eligible；整组删除被拒绝。
- **事务清理精确**：conditionalWrite 只清本次 temp 与 sidecar lock；conditionalDelete 只支持 observation=null 候选删除；保持 cooperating-writer 边界。
- Source Git 全程只读；Knowledge Git 是唯一持久写边界。

### 3. 失败路径矩阵（均需真实双 Git + 故障注入）

| 场景 | 期望 |
|---|---|
| `beforeRegistryWrite` 修改既有 legacy 文件 | `E_LEGACY_CHANGED`；不绑定；自建 target 清理 |
| `beforeRegistryWrite` 新增 legacy `.mdx`/`meta.json`/`config` | 路径集合变化 → `E_LEGACY_CHANGED`；不绑定 |
| `beforeRegistryWrite` 删除 legacy 文件 | 路径集合变化 → `E_LEGACY_CHANGED`；不绑定 |
| `beforeTargetValidate` 删除/篡改 worktree config/meta | 不写 binding；结构化错误；target 清理 |
| `beforeTargetValidate` 改变 HEAD（提交额外内容） | HEAD tree ≠ baseline → 不写 binding |
| `beforeTargetValidate` 改变 worktree | worktree clean 校验失败 → 不写 binding |
| 空目录检查后并发进入外部字节 | `E_MIGRATION_TARGET_DIRTY`；外部字节保留；residual 结构化报告；不绑定 |
| legacy 含额外属性/动态/非自闭合 CodeRef | `skipped` + `legacy.conversion.unsupported`；不标 converted |
| legacy 含 MDX expression / fragment | `skipped` + warning |
| 同描述不同正文/证据/关系的两文档 | 不判 exact duplicate；不 eligible |
| promotion 目标已存在（正式文档或 human draft） | `E_DOCUMENT_EXISTS`(2)；既有字节保留；HEAD/index 不动 |
| promotion requires 缺失/类型错/环、正文悬空链接 | `E_STRUCTURE_INVALID`(2)；candidate 保留；无 docs 写入；HEAD/index 不动 |
| promotion apply 中途 I/O 失败 | rollback：删除已写文档、恢复候选；HEAD/index 不动 |
| `--remove` 覆盖整个重复组 | `E_PRUNE_INSUFFICIENT`(2)；至少保留 canonical survivor |
| conditionalWrite rename 失败 | 返回 false；无 `.llmdoc-sync-*` 残留；sidecar lock 释放 |
| conditionalDelete observation=null 且文件存在 | 返回 false；文件保留；unsynced/cleanupRequired |
| conditionalDelete observation≠null | 返回 false；绝不删除 |

### 4. 测试矩阵（新增/改写，真实临时双 Git + 故障注入）

- `knowledge-migrate.test.ts`：`beforeRegistryWrite` 改/增/删 legacy 输入；`beforeTargetValidate` 篡改 config/meta/HEAD/worktree；`beforeTargetInit` 并发外部字节 → 保留 + residual；额外/动态/非自闭合 CodeRef、MDX expression/fragment skip。
- `knowledge-update-prune.test.ts`：同描述不同正文/关系不重复；promotion 目标已存在拒绝且字节保留；promotion relation 错误 → candidate 保留、无 docs 写入、HEAD/index 不变；`afterApply` 注入失败 → rollback；重复组 canonical survivor + 整组删除拒绝；既有 prune 用例按 survivor 语义调整。
- `knowledge-capture.test.ts`：conditionalWrite `beforeRename` 失败无 temp 残留；conditionalDelete 收窄语义（observation=null 存在→false 保留；observation≠null→false 不删）。
- 既有 M1–M4 回归保持通过；最终一遍原样 `npm test` 记录真实 exit/files/tests/duration。

### 5. 分步实施顺序（每步完成即回写本文件，支持断点续接）

1. **R2-a migration 收口**：A1 legacy 全量枚举复核、A2 committed target 校验、A3 所有权锁 + 精确清理、A4 MDX 门槛；新增/改写 migrate 测试。
2. **R2-b update/prune 数据安全**：B1 内容键、B2 fail-closed、B3 validate-then-apply + rollback、B4 canonical survivor；改写 update/prune 测试。
3. **R2-c 事务收口**：C1 temp 清理 + `beforeRename`、C3 conditionalDelete 收窄；补 capture/transaction 测试。
4. **R2-d 收口**：定向 knowledge 套件 → typecheck/lint → `git diff --check` → 一遍原样 `npm test`；清理调试产物；回写实际结果，标记「M4 R2 返修完成，等待 Codex R3」。

### 6. 续接入口

- 代码起点：`legacy.ts`/`migrate.ts` → `prune.ts`/`update.ts` → `transaction.ts` → 测试。
- 每步完成立即在本节下方追加「R2-x 实施与验证记录」，含变更文件、真实命令输出、剩余问题与下一步。
- 完成后停止，交 Codex R3；不进入 M5，不 stage/commit/reset/push。

## M4 R2 返修实施与验证记录 — 2026-09-11

状态：**M4 R2 返修实现完成，等待 Codex R3。** 未进入 M5，未 stage/commit/reset/push。

### R2-a migration 收口（A1/A2/A3/A4）

- `legacy.ts`：新增导出 `collectLegacyInputDigests(sourceRoot, legacyRoot)`，一次枚举全部 `.mdx` + 可选 `meta.json`/`llmdoc.config.json` 并逐字节 sha256；`planLegacyMigration` 改用它。`convertCodeRefs` 重写为只转换“自闭合 + 属性恰为静态字符串 `path`（可选 `symbol`）”；新增 `parseStaticCodeRefAttributes`（拒绝 `{}`、额外属性、裸 token）。`detectUnconvertibleSyntax` 先 `stripCodeRegions`（剥离 fenced code 与 inline code）再检测残留 CodeRef、大写 JSX、import/export、fragment `<>`、未转义 MDX expression `{...}`。
- `migrate.ts`：`assertLegacyInputsUnchanged` 改为重新枚举并与 `plan.legacyDigests` 比较**路径集合 + 每个 digest**（新增/删除/修改一律 `E_LEGACY_CHANGED`），并在 `beforeRegistryWrite` 之后、写 binding 紧前再调用一次。`writeMigratedSkeleton` 返回 `expected: Map<repoPath, Buffer>`；`assertMigratedTargetValid` 改为校验 committed target：worktree 布局、有效 HEAD、非 detached 且分支 `main`、无 Git 操作态、worktree `llmdoc.yaml` repositoryId 精确匹配、committed config/meta repositoryId 匹配、committed model 无结构错误、HEAD tree 与 expected 逐路径逐字节一致、worktree 全 clean。`git add` 改为显式添加 expected 路径。新增 `acquireTargetOwnership`/`releaseTargetOwnership`（`<target>.llmdoc-migrate.lock`，`wx`，冲突 `E_MIGRATION_TARGET_LOCKED`）、`beforeTargetInit` seam、`assertTargetContentsOwned`（外部路径 `E_MIGRATION_TARGET_DIRTY`）；`cleanupTarget` 重写为只删本次生成且字节匹配的路径、`.git` 与空目录，外部/漂移路径保留为 residual，自建 target 仅在清空后删除。
- `errors.ts`：新增 `E_DOCUMENT_EXISTS`、`E_MIGRATION_TARGET_LOCKED`、`E_MIGRATION_TARGET_DIRTY`。
- 验证：`knowledge-migrate.test.ts` 25/25（含 `beforeRegistryWrite` 改/增/删 legacy、`beforeTargetValidate` 删 config/篡改 meta/额外 worktree 文件/移动 HEAD、`beforeTargetInit` 并发外部字节保留 + residual、额外/动态/非自闭合 CodeRef 与 MDX expression/fragment skip）。

### R2-b update/prune 数据安全（B1/B2/B3/B4）

- `prune.ts`：`findExactDuplicates` 改为 `findDuplicateGroups` + `exactDuplicateKey`（topic/kind/description + 规范化正文 + 排序后的 source.paths 与 requires/related/supersedes），同描述不同内容不再判重复。稳定取字典序最小成员为 canonical survivor，报告中标 `eligible:false` 并给出保留理由，仅其余成员 eligible；`pruneLocked` 增加“一次 remove 覆盖整组即 `E_PRUNE_INSUFFICIENT`”守卫。`applyPruneRemoval` 返回 `{ repaired, rollback }`，删除前备份字节，后续 `resolveKnowledgeWriteContext`/`assertReviewPreconditions`/`buildReviewManifest` 失败即回滚。
- `update.ts`：`validateRequests` 新增目标存在 fail-closed（worktree/K0/磁盘任一存在即 `E_DOCUMENT_EXISTS`(2)）与重复目标检查；新增 `validateProjectedStructure`，在内存构造“worktree − 被提升目标 + 提升后文档”的 projected `KnowledgeModel`，任何 source scope/relations/类型/环/正文链接 error 即 `E_STRUCTURE_INVALID`(2)，发生在写 worktree 之前。`applyPromotions`/`applyRejections` 合并为 `applyMutations`：promotion 用 `wx` 创建并消费候选，rejection 先备份再删；返回 rollback，apply 中途或 apply 之后（fresh reload/preconditions/manifest）任一步失败都精确还原。新增 `UpdateTestHooks.afterApply` 故障注入。
- 验证：`knowledge-update-prune.test.ts` 15/15（同描述不同正文不重复；整组删除拒绝；目标已存在拒绝且字节保留；relation 错误 `E_STRUCTURE_INVALID` 且 candidate/HEAD/index/meta 不变；`afterApply` 注入失败 rollback；既有 prune/update 用例按 survivor 语义调整后仍通过）。

### R2-c 事务收口（C1/C3，C2 保持边界）

- `transaction.ts`：`conditionalWrite` 用局部 `tempPath` 记录本次临时文件，rename 成功置 null，finally 只清理由本次调用创建的 temp 与 sidecar lock；新增 `ConditionalWriteHooks.beforeRename` 故障注入。`conditionalDelete` 收窄为仅支持 `observation===null`：当前仍不存在才成功；存在则返回 false 保留并 unsynced；`observation!==null` 一律返回 false 绝不删除（保持 architecture §6 cooperating-writer 边界，未扩大为通用 CAS）。
- 验证：`knowledge-capture.test.ts` 13/13（新增 rename 失败无 `.llmdoc-sync-*` 残留；conditionalDelete 收窄语义）。

### R2 定向验证（真实临时双 Git + 故障注入）

- `knowledge-migrate` 25/25；`knowledge-update-prune` 15/15；`knowledge-capture` 13/13；均 exit 0。
- `npm run typecheck` exit 0；`npm run lint` exit 0；`git diff --check` exit 0（仅 LF/CRLF 提示）。
- **最终一遍原样全量 `npm test`**（`cmd /c "npm test > <temp>\m4r2full.log 2>&1"` 后立即读真实 `$LASTEXITCODE`，无筛选管道）：**exit 0，26 files / 236 tests 全过，无 FAIL/Unhandled/Timeout，Duration 2167.35s**。较 R1 的 220 tests 增加 16 个 R2 回归（migrate +9、update/prune +5、capture +2）。
- 环境核对：分支 `v3-ng`；`git diff --cached` 为空（index 无 staged）；无 `.llmdoc-tmp` 调试产物；临时全量日志置于仓库外并已删除；未 stage/commit/reset/push。

### 逐项关闭证据

- A1：`beforeRegistryWrite` 改既有文件/新增 `.mdx`/删除文件均 `E_LEGACY_CHANGED`、不绑定、自建 target 清理；校验比较完整路径集合 + digest。
- A2：`beforeTargetValidate` 删 worktree config（清理目标）/篡改 meta（保留 drifted 字节 + residual）/额外 worktree 文件/移动 HEAD 均不绑定；committed HEAD/branch/操作态/config/meta/tree/clean 全部校验。
- A3：`beforeTargetInit` 并发外部字节保留、`E_FILESYSTEM_IO` 结构化报告 residual、不绑定；所有权锁 + 复检；清理只删本次生成且字节匹配路径。
- A4：额外/动态/非自闭合 CodeRef 与 MDX expression/fragment 全部 skipped + `legacy.conversion.unsupported`。
- B1：同描述不同正文/关系不判 exact duplicate。
- B2：promotion 目标已存在 `E_DOCUMENT_EXISTS`(2)，既有字节保留、候选保留、HEAD 不动。
- B3：relation 错误在写前 `E_STRUCTURE_INVALID`(2)，candidate/HEAD/index/meta 字节不变；`afterApply` 注入失败 rollback 精确还原。
- B4：重复组稳定 canonical survivor，整组删除 `E_PRUNE_INSUFFICIENT`(2)。
- C1：rename 失败无 `.llmdoc-sync-*` 残留。
- C2：保持 cooperating-writer 边界，未扩大为通用 CAS。
- C3：`conditionalDelete` 仅支持 observation=null；存在即保留 unsynced；非空 observation 绝不删除。

### 剩余问题与下一步

- 停止，交 Codex R3；通过前不进入 M5，不 stage/commit/reset/push。
- 关联 commit：无（按约定不提交、不暂存）。

## M4 Codex R3 直接接管收口 — 2026-09-11

状态：R3 并行审查代理因账户用量限制未产出结论，Codex 按约定直接完成最终审查与修复；先记录设计，再改代码。

### R3 finding 与协议判断

- **P1 migration 绑定前目标仍可漂移**：`beforeRegistryWrite` 之后只重枚举 legacy 输入，未再次调用 `assertMigratedTargetValid`。因此目标 HEAD、`llmdoc.yaml`、meta、docs 或 README 可在首次验证后、registry binding 写入前发生变化，最终仍绑定到不再等于 migration baseline 的知识仓。这违反“绑定只能指向已验证 committed target”的事务边界。
- 修复：在 `beforeRegistryWrite` seam 返回后、`insertBinding` 紧前，依次执行完整 legacy 集合/digest 复核与完整 committed target 复核；任何一方漂移均不写 binding，并按既有精确 cleanup 规则保留外部字节、报告 residual。
- 测试：新增 `beforeRegistryWrite` 修改 target HEAD/内容的真实双 Git 故障注入，断言不绑定、外部字节保留、错误明确；随后运行 migration 定向测试、typecheck、lint、`git diff --check` 和最终全量测试。

### R3 实施顺序

1. 增加 binding 紧前的 target final verification。
2. 增加首次验证后 target 漂移的回归测试。
3. 完成门禁并回写真实证据；通过后 stage 精确 M4 diff 并提交。

### R3 实施与最终验收

- `migrate.ts`：在 `beforeRegistryWrite` 返回后、`insertBinding` 紧前同时重做完整 legacy 输入集合/digest 与 committed target 验证；目标 HEAD、分支、操作态、config/meta 身份、baseline tree 字节或 worktree clean 任一漂移均不会获得 binding。
- `knowledge-migrate.test.ts`：新增首次 target 验证后在 `beforeRegistryWrite` 创建并提交外部文件的故障注入；结果不写 registry binding，外部提交字节被精确 cleanup 保留并报告。
- 定向新用例：1/1，exit 0；完整 `knowledge-migrate.test.ts`：26/26，exit 0，Duration 180.34s。
- `npm run typecheck` exit 0；`npm run lint` exit 0。
- 最终原样 `npm test`：**exit 0，26 files / 237 tests 全过，Duration 2410.84s**。
- R3 结论：M4 通过集中审查，可以提交；后续 M5 必须使用新的 OpenCode 会话。

## M5 接入与发布实施计划 — 2026-09-11

状态：设计先行。先落本计划再写代码。M5 是 breaking replacement 的最后收口：hooks、skills、agents、CLI help/schema、viewer、双语文档/示例全部切到同一双仓协议；在所有调用方迁移后删除剩余旧 V3 runtime。不修改冻结 README/architecture/roadmap，不改版本号、不发布 npm、不 push、不创建 release，不 stage/commit/reset。M1–M4 已提交，身份校正后的 M4 commit 为 `4b1e50e`。

### 0. 独立推演（以冻结 README 八条硬边界、architecture §5/§6/§7、roadmap M5 为准，不迎合既有代码）

1. v3-ng 是 breaking replacement：标准 CLI、hooks、skills、agents、viewer 直接使用双仓协议；不存在 `v3-ng`/`ng` 前缀激活方式，不建立 `lib/v3ng`，不保留 V3 runtime dispatch/fallback。旧 `.mdx`/CodeRef/旧 meta/config 只能由显式 `migrate` 读取。
2. Source Git 永远只读；Knowledge Git 是唯一持久写边界。正式 update/review/seal 只接受有效 HEAD 且全仓 clean 的 committed source snapshot。hook 是 fail-open 只读诊断，绝不写 source/knowledge。
3. 正式知识是 reference data，不是可执行 rules/skills；文档内容不得被提升为 Agent 指令权限。技能说明必须区分“语义判断（人或 Agent 负责）”与“确定性 CLI（结构/范围/提交检查）”。
4. 无绑定时 hooks/agents/viewer 只提供 v3-ng 诊断，不能偷偷 `init`，不能回退 embedded/source Git。
5. M5 完成后才讨论版本号；本任务不修改 `package.json`/plugin version。

### 1. 当前旧接入面清单（M5 必须处理）

运行时（`cli/src`）：
- `commands/hook.ts`、`commands/serve.ts` 已在 M4 R1 删除；`hooks/hooks.json` 仍指向 `llmdoc hook session-start|stop|compact`，当前不可达 → M5 以新协议重建 `hook` 与 `serve`。
- 旧 V3 lib 仍物理存在且已无主入口引用：`lib/workspace.ts`、`lib/state.ts`、`lib/config.ts`、`lib/viewer-state.ts`、`lib/viewer-http.ts`、`lib/repository-health.ts`、`lib/rewrite.ts`、`lib/doc-shape.ts`、`lib/schema.ts`；`cli/templates/doc.mdx` 为 V3 模板；`cli/assets/viewer*.js|html` 消费旧 `/api/state` DTO。
- `lib/markdown.ts`（`resolveDocLink`）、`lib/search.ts`（`matchesCodePathPattern`/分词）、`lib/pagination.ts`、`lib/errors.ts`（`CliError`）、`lib/output-schema.ts`、`lib/package-root.ts`、`lib/constants.ts`、`types.ts` 仍被新协议引用，保留。
- `lib/knowledge/legacy.ts` 是唯一旧格式读取器，必须只被 `migrate.ts` 引用。
- `cli/src/cli.ts` help 文案与示例、`lib/output-schema.ts` + `schemas/output.schema.json` 需要与当前命令面完全一致（无 `new/adopt/mv/fingerprint/init-state/upgrade/hook/serve` 旧契约；`hook`/`serve` 以新协议重新加入）。
- `cli/tests` 仍存在旧 V3 语义测试：`cli-misc.test.ts` 等对 `prune`/`upgrade`/viewer 的引用需改到新协议；M4 R1 已删大部分，M5 再核查无死引用。

接入面（非 `cli/src`）：
- `skills/*/SKILL.md` 与 `.agents/skills/*/SKILL.md`：全部 V3 语义（`.mdx`、`code.paths`、`meta.json`、`new/adopt/mv/fingerprint/init-state`、`commit --verified/--all`、`upgrade`、`.llmdoc-tmp/reflections`）；`scripts/check-codex-surface.mjs` 强制两处正文一致。
- `agents/{investigator,recorder,reflector}.md` 与 `.codex/agents/*.toml`：V3 文档模型、`code.paths`、`.mdx`、V3 ledger 命令。
- `docs/agent-integration.md`：V3 命令与 `llmdoc/` 边界。
- `README.md` / `README.zh-CN.md`：V3 `.mdx`/`llmdoc/`/preload/`upgrade`/`mv` 说明。
- `website/src/pages/{,zh/}docs/{cli,concepts,workflows,getting-started}/index.astro`、`website/src/components/{HomePage,SiteHeader}.astro`、`website/public/llms.txt`：V3 命令与概念。
- `hooks/hooks.json` 描述、`scripts/check-prompt-budget.mjs`（hook token 预算）、`scripts/check-codex-surface.mjs`（skill/agent 正文与 hooks 命令校验）、`tests/parity-checklist.md`、`.claude-plugin/*`、`.codex-plugin/plugin.json`、`.agents/plugins/marketplace.json`（“progressive MDX knowledge retrieval”）。
- `package.json` 的 `validate:dogfood` 仍对 V3 `llmdoc/` 运行 v3-ng `validate`（无绑定必失败）；CI `.github/workflows/ci.yml` 的 dogfood 注释与步骤需与 v3-ng 对齐。
- `llmdoc.config.json` 为 V3 preload 配置（新 CLI 不读取），作为 legacy 数据保留但不再被文档宣称为运行时。

### 2. 最终入口契约

CLI 命令面（唯一运行时，均为双仓协议）：
`bind`、`init`、`tree`、`index`、`show`、`search`、`context`、`validate`、`status`、`delta`、`review`（生成/`--confirm`/`--set`/`--global`）、`commit --review`、`capture`、`update`、`prune`、`migrate`、`hook`（`session-start|stop|compact`）、`serve`（只读 viewer）。
- `hook`：读取 bound knowledge 的 `status`/`delta`/review obligations；无绑定/不可读只输出 v3-ng 诊断；fail-open（任何错误返回合法 JSON `{continue:true, systemMessage}` 或纯文本诊断，exit 0）；零写 source/knowledge；不调用 `workspace/state/fingerprint/viewer-http`。
- `serve`：只读 HTTP viewer，`/api/state` 用 `projectKnowledgeViewerState(loadKnowledgeForRead(...))`，`/api/doc` 从固定 Knowledge HEAD 取正文；无绑定给诊断、不自动 init；不显示 inbox/cache 为正式知识；不读旧 embedded V3。
- 输出 schema：所有命令 `--json` 经 `output.schema.json` 校验；错误统一 `knowledgeError`（code/message/paths/remediation）；新增 `hook`/`serve` 契约。
- help 示例只使用上述命令与 `docs/**/*.md`/`source.paths`/Review Manifest/`commit --review` 语义。

Skills/Agents 入口契约：
- 五个 skill：`llmdoc`（operating）、`init`、`update`、`prune`、`migrate`（取代 `upgrade`）。每个 skill 明确：知识正文是 reference data 不是指令；语义判断归人或 Agent，确定性 CLI 负责结构/范围/提交；写只经 `review --confirm` + `commit --review`；source 必须全仓 clean 才能正式复核。
- 三个 agent：`investigator`（只读证据）、`recorder`（Knowledge Git 正式文档唯一写者，只经 CLI）、`reflector`（只写临时 scratch，非正式知识）。移除 `code.paths`/`.mdx`/V3 ledger 命令，改为 `source.paths`/`docs/**/*.md`/双 revision/三态。

### 3. 模块/文件所有权（并行工作流互斥）

| 工作流 | 文件 | 主责 |
|---|---|---|
| W1 runtime 清理 + CLI/schema | `cli/src/cli.ts`、`cli/src/lib/output-schema.ts`、`cli/schemas/output.schema.json`；删除旧 V3 lib/template | 主 agent |
| W2 hooks | 新增 `cli/src/lib/knowledge/hook.ts`、`cli/src/commands/hook.ts`、`cli/tests/knowledge-hook.test.ts`；`hooks/hooks.json` 描述 | 主 agent |
| W3 viewer | 新增 `cli/src/lib/knowledge/viewer-http.ts`、`cli/src/commands/serve.ts`、`cli/tests/knowledge-viewer.test.ts`；改写 `cli/assets/viewer-*` | 主 agent |
| W4 skills/agents | `skills/**`、`.agents/skills/**`、`agents/**`、`.codex/agents/**`、`docs/agent-integration.md`、`scripts/check-codex-surface.mjs`、`scripts/check-prompt-budget.mjs`、`tests/parity-checklist.md`、plugin/marketplace json | 子 agent（W4） |
| W5 双语文档/网站 | `README.md`、`README.zh-CN.md`、`website/**`、`docs/v3-ng-design/README.md` 链接 | 子 agent（W5） |
| W6 dogfood + CI | 新增 `cli/tests/knowledge-dogfood-e2e.test.ts`、`cli/tests/knowledge-hook.test.ts`（W2 负责）、`package.json` `validate:dogfood`、`.github/workflows/ci.yml` | 主 agent |

并行约束：W4 与 W5 不修改 `cli/**`、`scripts/check-*.mjs` 由 W4 独占、`README*`/`website/**` 由 W5 独占；主 agent 独占 `cli/**`、`hooks/hooks.json`、`package.json`、`.github/**`、`docs/v3-ng-design/**`。任一文件同一时刻只有一个写者；主 agent 做最终集成与门禁。

### 4. 失败路径矩阵（M5 接入面，真实双 Git）

| 场景 | 期望 |
|---|---|
| hook 无绑定 | 纯诊断（`E_BINDING_NOT_FOUND` 语义的 v3-ng 提示），exit 0，零写 |
| hook source dirty / invalid HEAD | 诊断输出 blockers，exit 0，零写 |
| hook 任何内部异常 | fail-open：合法 JSON `{continue:true,...}` 或诊断文本，exit 0 |
| hook stop/compact 成功 | 合法 JSON `{continue:true, systemMessage?}`，token 预算内 |
| serve 无绑定 | 启动并返回诊断 payload；不自动 init、不回退 embedded/source |
| serve 绑定 knowledge | `/api/state` 含 `knowledgeRevision/sourceRevision/lastGlobalReviewRevision/sourceBlockers/historyAvailable/issues`，节点三态；`/api/doc` 只返回正式 docs |
| serve 请求 inbox/cache 路径 | 404/不列为正式节点 |
| 旧 `llmdoc/*.mdx` 出现在读取入口 | 主入口不读取；仅 `migrate` 可读 |
| `validate:dogfood` | 走 v3-ng 双仓 dogfood（临时 fixture），不依赖 V3 `llmdoc/` |
| skills/agents 文档 | 无 `code.paths`/`.mdx`/`new|adopt|mv|fingerprint|init-state|upgrade`/`--verified`/`--all`；无把知识正文当指令 |
| CLI help/schema | 无已删除 V3 命令或旧字段；`hook`/`serve` 契约存在 |

### 5. Windows/Linux 集成矩阵

| 用例 | Windows（本机必跑） | Linux |
|---|---|---|
| knowledge-* 定向 + dogfood e2e | `npx vitest run ...`，真实临时双 Git | CI `npm test`（ubuntu, node 18/20/22）已覆盖 |
| 路径/junction/大小写 | 本机实测 | CI 仅 symlink 分支；junction 用例 `skipIf(win32)` 反向 |
| hook launcher（`npx` shell） | 本机 `check-prompt-budget.mjs` | CI `check:prompts` |
| viewer HTTP | 本机定向 | CI 全量测试覆盖 |
| `npm run typecheck`/`lint`/`git diff --check` | 本机执行 | CI 执行 |

Linux 无本机环境时：以现有 `ubuntu-latest` CI（`npm ci` → typecheck → lint → test → build → dogfood → check:prompts）作为可移植性证据，并在 progress.md 诚实记录“Linux 未本地执行，仅 CI 证据”。

### 6. 双语文档/示例清单

- `README.md`（en）/`README.zh-CN.md`（zh）：重写为 v3-ng 双仓模型：独立 Knowledge Git、`docs/**/*.md`、`source.paths`、三态、Review Manifest、`commit --review`、`capture/update/prune/migrate`、hooks/viewer；删除 `.mdx`/preload/`upgrade`/`mv`/`new`/`adopt` 承诺。
- `website/src/pages/docs/{cli,concepts,workflows,getting-started}/index.astro` 与 `zh/**` 对应页：命令表、概念（双 revision、三态、clean 门控）、workflow（init/update/prune/migrate）全部切到双仓协议。
- `website/src/components/{HomePage,SiteHeader}.astro`、`website/public/llms.txt`：去 V3/MDX 文案。
- `docs/agent-integration.md`：portable agent recipe 改为 v3-ng（registry binding、双 revision、三态、source clean 门控、Knowledge-only writes、reference-data 声明）。
- 示例仓布局：README/website 内展示 external `knowledge/project/{llmdoc.yaml,docs/**,.llmdoc/meta.json}` 与 `llmdoc init --source --knowledge` 流程。
- `docs/v3-ng-design/README.md` 迁移边界表引用的 `workspace.ts` 等旧路径保持冻结设计原文不动（不迁就实现）。

### 7. dogfood 方案

新增 `cli/tests/knowledge-dogfood-e2e.test.ts`（真实临时双 Git，Windows 必跑，Linux CI 覆盖）：
1. 真实 source Git（含 `src/**`）→ `init --source --knowledge`（外置）→ 断言 knowledge Git 独立、source HEAD/index/worktree 字节不变。
2. `bind` 幂等 `already-bound`；`tree/index/show/search/context` 返回正式 docs；inbox/cache 不召回。
3. `capture` 写 inbox（无 trailer、meta 不变）→ `update --promote` → `review` → `review --confirm` → `commit --review`；断言 K1 含 docs+meta+导航，source 字节仍不变。
4. `prune --report` 报告重复/supersede；`prune --remove` + `review --confirm` + `commit --review` 删除并修复入链。
5. 无绑定 cwd → `E_BINDING_NOT_FOUND`；dirty source → `E_SOURCE_DIRTY`；staged knowledge → `E_KNOWLEDGE_INDEX_DIRTY`；并发/失败诊断结构化。
6. `migrate --dry-run` 对 legacy `.mdx` 零写；`migrate` 建新外置 knowledge Git 与绑定。
7. `hook session-start|stop|compact` fail-open、零写；`serve` HTTP `/api/state`/`/api/doc` 三态/blockers/double revision。
8. 全程对 source HEAD、`.git/index` 字节、工作树文件哈希做前后对比；每条命令 `--json` 经 `output.schema.json` 校验。
9. 命名空间扫描：`lib/v3ng`、`runNg`、`ng-*`、`ngTree/ngError`、`llmdoc.ng-`、旧命令 `.command(...)` 无命中；`legacy.ts` 仅被 `migrate.ts` 引用。

### 8. 删除旧 runtime 的判定

只有同时满足才删除：(1) `rg` 证明无运行时 import（含 `cli/src/**`）；(2) 非 `migrate`/`legacy` 可达；(3) 对应测试已迁移或删除且未被公开测试依赖；(4) `typecheck`/`lint`/全量测试仍通过。据此删除 `lib/workspace.ts`、`lib/state.ts`、`lib/config.ts`、`lib/viewer-state.ts`、`lib/viewer-http.ts`、`lib/repository-health.ts`、`lib/rewrite.ts`、`lib/doc-shape.ts`、`lib/schema.ts`、`cli/templates/doc.mdx`（旧 V3 模板）；`legacy.ts` 保留且只被 `migrate.ts` 引用。`lib/markdown.ts`、`lib/search.ts`、`lib/pagination.ts`、`lib/errors.ts`、`lib/constants.ts`、`types.ts` 因新协议仍用而保留。

### 9. 分步顺序与断点续接入口

1. **M5a** 本计划落盘（本节）。
2. **M5b** W1 runtime 清理 + CLI/schema/help（先加 `hook`/`serve` 接线与 schema，再删旧模块；typecheck/lint 绿）。
3. **M5c** W2 hooks（`hook.ts` + 命令 + `knowledge-hook.test.ts` + `hooks.json` 描述 + `check-prompt-budget` 预算）。
4. **M5d** W3 viewer（`knowledge/viewer-http.ts` + `serve` + assets + `knowledge-viewer.test.ts`）。
5. **M5e** W4 skills/agents/scripts（子 agent，两处正文一致、`check-codex-surface` 通过）。
6. **M5f** W5 README/website（子 agent，双语）。
7. **M5g** W6 dogfood e2e + `validate:dogfood` + CI（Windows 本地跑；Linux 记录 CI 证据）。
8. **M5h** 收口：定向 → `npm run typecheck` → `npm run lint` → `git diff --check` → `npm run check:prompts` → 文档链接检查 → 命名空间/legacy 引用证明 → 一遍原样 `npm test`；更新 progress 为“M5 实现完成，等待 Codex review”，列出 diff/证据/剩余限制，停止。

断点续接：中断后先读本计划、`docs/v3-ng-design/README.md`、architecture §5–§7，再核对 `git status` 与已完成子步骤；不重复已完成工作，不 stage/commit/reset/push。每完成一个子步骤立即在本节下方追加“M5x 实施与验证记录”。

## M5b/M5c/M5d 实施与验证记录 — 2026-09-11

状态：runtime 清理、hooks、viewer 完成并通过定向测试。未进入 skills/agents/文档（M5e/M5f），未 stage/commit/reset/push。

### M5b runtime 清理 + CLI/schema

- 删除已无主入口引用的旧 V3 runtime：`cli/src/lib/{workspace,state,config,viewer-state,viewer-http,repository-health,rewrite,doc-shape,schema,git,format}.ts`、`cli/templates/doc.mdx`（及空 `templates/`）；`cli/package.json` 的 `files` 移除 `templates`。
- `legacy.ts` 仍只被 `migrate.ts` 引用（`rg` 证明）；`lib/markdown.ts`、`lib/search.ts`、`lib/fs.ts`、`lib/pagination.ts`、`lib/constants.ts`、`lib/errors.ts`、`types.ts` 因新协议仍用而保留。
- `cli/src/cli.ts`：新增 `hook <event>` 与 `serve` 命令接线；快速参考增加 “Host integration hook · serve”。
- `cli/src/lib/output-schema.ts` + `cli/schemas/output.schema.json`：新增 `hook`（`llmdoc.hook/v1`）与 `serve`（`llmdoc.serve/v1`）契约。
- 验证：`npm run typecheck` exit 0；`npm run lint` exit 0。

### M5c hooks

- 新增 `cli/src/lib/knowledge/hook.ts`：`runKnowledgeHook` 只读调用 `loadKnowledgeForRead`，输出 `llmdoc.hook/v1`（mode/repositoryId/sourceRevision/knowledgeRevision/lastGlobalReviewRevision/historyAvailable/sourceBlockers/documents/reviewObligations/systemMessage/diagnostic）；任何失败 fail-open 为诊断；compact 输出 LLMDOC_STATE 保留消息；零写、不调用旧 workspace/state/fingerprint。
- 新增 `cli/src/commands/hook.ts`：事件校验 + 委派。
- `hooks/hooks.json` 描述改为 v3-ng 只读 fail-open（命令契约不变）。
- 新增 `cli/tests/knowledge-hook.test.ts`（4）：bound 义务与双 revision、source/knowledge 字节冻结；无绑定诊断且零写；compact/非法事件；CLI 文本/JSON 渲染。
- 验证：`npx vitest run tests/knowledge-hook.test.ts` → exit 0，4/4，Duration 15.5s。

### M5d viewer

- 新增 `cli/src/lib/knowledge/viewer-http.ts`：`createKnowledgeViewerRequestHandler` 只读；`/api/state` 用 `projectKnowledgeViewerState(loadKnowledgeForRead(...))`（三态/source blockers/双 revision/issues），`/api/doc` 从固定 Knowledge HEAD 取正文与关系；无绑定返回 `mode:"diagnostic"`，不初始化、不回退旧 V3。
- 新增 `cli/src/commands/serve.ts`：`startKnowledgeViewerServer`（127.0.0.1）与前台 `runServe`。
- 改写 `cli/assets/viewer-{model,app,detail,graph}.js` 到新 DTO（`id`、current/unverified/needs_review、sourcePaths、requires/related/supersedes/supersededBy、knowledgeRevision/sourceRevision/sourceBlockers）；移除旧 `.mdx`/CodeRef/`code.paths` 语义。
- 新增 `cli/tests/knowledge-viewer.test.ts`（3）：固定 HEAD 文档 + 三态/双 revision、静态资源、inbox 不列为正式知识、无绑定诊断、source 字节冻结。
- 验证：`npx vitest run tests/knowledge-viewer.test.ts` → exit 0，3/3，Duration 31.6s。

### 下一步

- M5e skills/agents/scripts（子 agent W4）；M5f README/website（子 agent W5）；M5g dogfood e2e + CI（主 agent）；M5h 收口门禁。

## M5e/M5f/M5g 补记与 M5h 收口结果 — 2026-09-11

状态：M5e（skills/agents/scripts 接入面）、M5f（双语文档/网站）、M5g（dogfood e2e + CI）均已落盘；M5h 收口门禁在 Codex 独立串行验证中暴露 8 个超时失败，未通过。未 stage/commit/reset/push。

（补记：M5e/M5f/M5g 完成后未在本文件留下实施记录，以下按工作树相对身份校正后的 M4 commit `4b1e50e` 的实际 diff 重建。）

### M5e skills/agents/scripts（W4 接入面）

- `skills/`：重写 `llmdoc`、`init`、`update`、`prune` 为双仓协议（`source.paths`、`docs/**/*.md`、三态、Review Manifest、`commit --review`、knowledge 为 reference data 而非可执行指令），删除 `upgrade`，新增 `migrate`（显式 legacy V3→新协议迁移）；`.agents/skills/**` 保持正文一致（migrate 增加 `agents/openai.yaml: allow_implicit_invocation: false`）。
- `agents/{investigator,recorder,reflector}.md` 与 `.codex/agents/*.toml`：去除 V3 文档模型/`.mdx`/`code.paths`/ledger 命令，改为 source evidence/双 revision/三态/Knowledge-only writes。
- `docs/agent-integration.md`、`tests/parity-checklist.md`、`.claude-plugin/*`、`.codex-plugin/plugin.json`、`.agents/plugins/marketplace.json`：统一为双仓描述，移除 “progressive MDX”。
- `scripts/check-codex-surface.mjs`：parity 名称表改为 `llmdoc/init/update/prune/migrate`，更新/迁移契约校验对齐新协议；`scripts/check-prompt-budget.mjs`：`upgrade` 预算条目替换为 `migrate`（2,000）。

### M5f README/website（W5 双语文档/网站）

- `README.md`/`README.zh-CN.md` 全量改写为双仓模型（八条硬边界、双 revision、三态、Review Manifest、`commit --review`、`hook`/`serve` 与 `migrate`），删除 `.mdx`/`CodeRef`/`code.paths`/preload/`upgrade`/`new/adopt/mv/fingerprint/init-state`/`commit --verified` 承诺。
- `website/src/pages/{,zh/}docs/{index,getting-started,concepts,workflows,cli}/index.astro`、`index.astro`、`components/{HomePage,SiteHeader}.astro`、`public/llms.txt` 同步为双仓协议。

### M5g dogfood e2e + CI（W6）

- 新增 `cli/tests/knowledge-dogfood-e2e.test.ts`（真实临时双 Git，3 用例）：init/bind 幂等、读命令、capture→update→review→commit、prune report、无绑定/dirty/staged blocker、migrate dry-run+real、hook fail-open、serve HTTP，全程断言 source HEAD/index/worktree 字节不变。
- 根 `package.json` `validate:dogfood` 改为 `npm --prefix cli exec -- vitest run tests/knowledge-dogfood-e2e.test.ts`；`.github/workflows/ci.yml` 从 `test` job 移除 V3 `validate:dogfood` 步骤，新增 `dogfood` job（`name: v3-ng dogfood (Linux)`）执行 `npm ci && npm run build` + `npm run validate:dogfood`。
- 验证：Windows 本机定向 3/3 通过；Linux 仅 CI 证据（本机无 Linux）。

### M5h 收口门禁结果（未通过）

- Codex 独立执行 build + 全量 29 个 Vitest 文件串行：25 files 通过 / 4 failed；239/247 tests 通过；8 个 timeout；总 3109.62s。失败：`knowledge-review-seal` 401/449（120s 预算）、`knowledge-manifest-safety` 92（30s）、`knowledge-navigation` 104/125/139/172（5s 默认）、`cli-misc` 20（5s 默认）。
- 本机复现：`knowledge-navigation` “updates navigation after a document deletion” 在全局 30s 预算下超时（实测 34s），确认为真实 Git 密集用例在 Windows/AV 主机上的预算不足，而非断言失败。
- 结论：M5 实现面已落盘，但测试可靠性与剩余运行时品牌/契约问题未关闭；进入 M5 R1 修复周期。

## M5 Codex 首轮审查发现与 R1 修复计划 — 2026-09-11

状态：计划先行。先落本计划再改代码。R1 是 breaking replacement 的收口修复，不引入 V3 运行时兼容，不修改冻结 README/architecture/roadmap，不改版本号、不发布、不 push，不 stage/commit/reset；M1–M4 commit 保持不变。核心不变式：Source Git 提交定义事实，Knowledge Git 提交保存经验证的理解；Source Git 永远只读，Knowledge Git 是唯一持久写边界。

### 发现（Codex 首轮，8 项）

1. **测试超时不可靠**：全量串行 8 个 timeout（4 文件）；默认并行 `npm test` 在 Windows 上广泛超时。需控制 worker/file 并发、去除可避免的重复 setup，仅调整确实不切实际的单测预算，保留全部断言。
2. **v3-ng 运行时品牌**：v3-ng 是分支/设计代号，不是产品/运行时模式。应从 CLI/help、hook/viewer 面向文本、package/plugin/hook 描述、skills/agents 操作 prose、测试标题、CI job 名中移除运行时品牌；保留 `docs/v3-ng-design/**`、显式 legacy-V3 迁移历史与冻结的 `llmdoc.meta/v3-ng` schema 标识；绝不新增 v3-ng/ng 命令、目录、handler、dispatch schema/error 或 fallback。
3. **serve 启动通知**：`llmdoc --json serve` 必须在前台服务继续运行到 signal 的同时输出经注册 schema 校验的启动通知；普通文本保持连贯，stdout 捕获安全；校验端口范围并测试。
4. **`/api/doc` 404**：对 missing/non-formal/inbox/cache id 返回 HTTP 404 与稳定 body；正式文档只能来自固定 Knowledge HEAD；测试状态码与字节不变式。
5. **移除废弃 config schema**：删除 shipped/published 的 V3 `cli/schemas/config.schema.json`（`llmdoc.config/v1` preload）并更新 website route/check；若保留 schema 发布，优先替换为 `llmdoc.yaml` 的 `llmdoc.knowledge/v1`；仓库根 `llmdoc.config.json` 仅作显式 migrate 输入。
6. **移除休眠 V3 API**：追踪 import 后删除 `cli/src/types.ts`、`search.ts`、`markdown.ts` 中休眠 V3 API，仅保留新协议共享函数与显式 migrate 解析；新增扫描/测试防止运行时回归。
7. **过时测试标题**：`keeps --version and legacy commands working` 围绕实际行为重写；确认无 V3 dispatch/fallback。
8. **门禁**：定向测试、typecheck、lint、`git diff --check`、`check:prompts`、website check/build/schema check、namespace/legacy reachability 扫描，以及原样 `npm test`；记录精确证据，Linux 仅记录 CI 配置；结束时 progress 状态为“实现完成，等待 Codex review”，然后停止，不提交。

### 根因判断（独立推演，不迎合既有代码）

- 1 的根因：这些用例是真实双 Git 事务（init→review→confirm→seal），在 Windows/AV 主机上每次 `git` 进程约 235ms，单个完整 fixture 用例约 30–35s。全局 30s/文件级 120s 对“单文件内串联多个完整事务”的用例预算不足；`navigation`/`cli-misc` 没有文件级预算，Codex 以未加载 `vitest.config.ts` 的方式运行时退回 5s 默认。修复策略：(a) 保持 `fileParallelism:false`；(b) 为每个 Git 密集文件声明显式文件级预算；(c) 拆分单文件内串联多个独立事务的巨型用例，使单测预算可测；(d) 删除可避免的重复 setup（`manifest-safety` 中冗余的 `writeFreshManifest`、`cli-misc` 的 `npm init -y`）；(e) 不 skip/delete/dilute 断言，不无差别放大所有 timeout。
- 2 的根因：M5 将设计代号写进了运行时/接入面品牌文案。
- 3 的根因：`runServe` 直接把文本写到 `process.stdout` 后阻塞，`cli.ts` 从不产出 `llmdoc.serve/v1`，且 `--port` 复用 `parseInteger` 拒绝 0、不校验上界。
- 4 的根因：`buildDocument` 未命中时返回 HTTP 200 + `{error}`。
- 5 的根因：V3 config schema 仍被打包/发布。
- 6 的根因：M4/M5 删除 V3 运行时后，`types.ts`/`search.ts`/`markdown.ts` 仍残留无运行时引用的 V3 API。
- 7 的根因：M4 删除 V3 命令后测试标题未同步。

### 分步实施顺序（每步立即追加“M5 R1 实施与验证记录”）

1. **R1-a 测试可靠性**：`cli/vitest.config.ts`（去品牌、明确并发策略）、`knowledge-navigation`/`cli-misc` 显式预算、拆分 `knowledge-review-seal` 巨型用例、去 `manifest-safety` 冗余 setup、`cli-misc` 去 `npm init -y` 并显式预算。
2. **R1-b 运行时品牌**：`cli/src/cli.ts`、`lib/knowledge/hook.ts`、`commands/serve.ts`、`lib/knowledge/viewer-http.ts`、`lib/knowledge/document.ts`、`cli/package.json`、根 `package.json`、`hooks/hooks.json`、plugin/marketplace、`skills/**`+`.agents/skills/**`、`agents/**`+`.codex/agents/**`、README/website 品牌行、CI job 名、测试标题；保留 schema 标识与迁移历史。
3. **R1-c serve**：`commands/serve.ts`、`cli.ts`、`output.schema.json`（如需）、新增/扩展 viewer/serve 测试；端口范围校验。
4. **R1-d `/api/doc` 404**：`lib/knowledge/viewer-http.ts`、`assets/viewer-detail.js`（如需）、`knowledge-viewer.test.ts`。
5. **R1-e config schema**：删除 `cli/schemas/config.schema.json`；`website` 的 `schemas/config.schema.json.ts` 与 `check:schema`、根/website scripts。
6. **R1-f 休眠 API**：`types.ts`、`search.ts`、`markdown.ts`；新增扫描测试（`legacy.ts` 仅被 `migrate.ts` 引用；无旧命令注册/旧 API export）。
7. **R1-g 标题**：`knowledge-cli.test.ts` 标题与实际行为。
8. **R1-h 收口**：定向 → `npm run typecheck` → `npm run lint` → `git diff --check` → `npm run check:prompts` → website check/build/schema → namespace/legacy 扫描 → 原样 `npm test`；记录精确 exit/files/tests/duration；进度状态置“实现完成，等待 Codex review”。

断点续接：中断后先读本节、`docs/v3-ng-design/README.md`、architecture §5–§7，再核对 `git status` 与已完成子步骤；不重复已完成工作，不 stage/commit/reset/push。

## M5 R1 实施与验证记录（R1-a–R1-g）— 2026-09-11

状态：R1-a–R1-g 已实施；未 stage/commit/reset/push。定向证据如下，R1-h 全量门禁另记。

### R1-a 测试可靠性（finding 1）

- 根因证据：`npx vitest run tests/knowledge-navigation.test.ts -t "updates navigation after a document deletion"` 在全局 30s 预算下超时（实测 34145ms）；本机每次 `git` 进程约 235ms，单次 fixture+review+confirm+seal 约 30–35s。Codex 报告 navigation/cli-misc 为 5s 默认，说明其运行未加载 `cli/vitest.config.ts`，故每个 Git 密集文件需自带文件级预算。
- `cli/vitest.config.ts`：保留 `fileParallelism: false` 与 `testTimeout: 30000`，注释澄清并发策略（去 v3-ng 品牌），并说明重文件用 `vi.setConfig` 声明更大预算。
- `knowledge-navigation.test.ts`：新增 `vi.setConfig({ testTimeout: 120000 })`（定向 4 个异步用例各约 30–32s）。
- `cli-misc.test.ts`：新增 `vi.setConfig({ testTimeout: 120000 })`；删除可避免的 `npm init -y`，直接写最小 `package.json`。
- `knowledge-manifest-safety.test.ts`：删除 4 次冗余 `writeFreshManifest`（`tamper` 每次从原始 `manifest` 深拷贝重写，中间的 fresh 写入必被覆盖，且 `confirmReviewManifest` 接收对象而非文件）；用例耗时由 >30s 降至 14.1s。
- `knowledge-review-seal.test.ts`：拆分两个巨型用例（原 401 行“add/update/delete/insufficient”4 场景 → 4 个独立 `it`；原 449 行“body/scope/deletion/addition”4 场景 → 4 个独立 `it`），保留全部断言；文件预算维持 120s，单测最长 78.6s。
- 定向证据：`knowledge-review-seal` 30/30 exit 0，Duration 1032.00s，单测最长 78630ms；`knowledge-manifest-safety` 4/4（最长 14132ms）；`knowledge-navigation` 8/8（异步最长 32189ms）；`knowledge-hook` 4/4（最长 12033ms）；`cli-misc` 3/3；`knowledge-viewer` 7/7。全部在预算内。

### R1-b 运行时品牌（finding 2）

- 去运行时品牌：`cli/package.json`、根 `package.json` 描述；`cli/src/cli.ts` 顶层描述与 `hook` help；`lib/knowledge/hook.ts` 面向文本（unavailable/no binding/mode/counts）；`commands/serve.ts`、`lib/knowledge/viewer-http.ts`、`lib/knowledge/document.ts` 注释；`hooks/hooks.json` 描述；`skills/{llmdoc,init,update,prune,migrate}/SKILL.md` 与 `.agents/skills/**` 镜像；`agents/{investigator,recorder}.md`、`.codex/agents/{investigator,recorder}.toml`；`tests/parity-checklist.md`；`README.md`/`README.zh-CN.md` 的架构链接标签；`website/src/components/{SiteHeader,HomePage}.astro`；`.github/workflows/ci.yml` job `v3-ng dogfood (Linux)` → `Dogfood dual-repository (Linux)`；测试标题 `knowledge-dogfood-e2e`、`knowledge-hook`、`knowledge-viewer` 与 hook 断言。
- 保留：`docs/v3-ng-design/**`、`llmdoc.meta/v3-ng` schema 标识（`meta.ts`、`init.ts`、`seal.ts`、测试 fixture）、显式 legacy-V3 迁移历史（`migrate` 命令/skill 与 `legacy.ts`）；未新增任何 v3-ng/ng 命令、目录、handler、dispatch schema/error 或 fallback。

### R1-c serve 启动通知（finding 3）

- `commands/serve.ts`：`formatServeStart` 对 JSON 模式先 `assertOutputSchema("serve", …)` 再 `JSON.stringify`（单行、stdout 捕获安全）；`runServe(options, { stdout, signal })` 在服务监听后立即写出通知，再阻塞至 SIGINT/SIGTERM 或 `AbortSignal`；新增 `assertViewerPort`（0–65535，越界抛 `E_INVALID_PORT`）。
- `lib/knowledge/errors.ts`：新增 `E_INVALID_PORT`。
- `cli.ts`：`serve` 增加 `json` 透传与 `parsePort` 参数解析；`--port 0` 可用。
- 证据：`knowledge-viewer.test.ts` 新增 3 个用例（JSON 单行 schema 校验且服务在通知后仍可 `/api/state`、文本行、端口范围），全部 7/7 exit 0。

### R1-d `/api/doc` 404（finding 4）

- `lib/knowledge/viewer-http.ts`：`buildDocument` 返回 `{ status, payload }`；missing/non-formal/inbox/cache/无绑定一律 HTTP 404，body 固定为 `{ schema:"llmdoc.viewer-doc/v1", error:"document_not_found", documentId }`；正式文档只从 `readKnowledgeForRead` 的固定 Knowledge HEAD（`docs/**`）取。
- `assets/viewer-detail.js` 已处理 `!response.ok`，无需改动。
- 证据：inbox/escape/unknown id 404、无绑定 404、脏 worktree `docs/secret.md` 404 而 HEAD `architecture.md` 200，且同 id 两次响应字节相等（`Buffer.equals`）。

### R1-e config schema（finding 5）

- 删除 `cli/schemas/config.schema.json`；新增 `cli/schemas/knowledge.schema.json`（`llmdoc.knowledge/v1`，约束 `repositoryId`/`layoutVersion`/`remotes`）。
- 网站路由 `src/pages/schemas/config.schema.json.ts` → `knowledge.schema.json.ts`；`website/scripts/check-published-schema.mjs` 改校验 knowledge schema 与 canonical URL；CI step `Verify published config schema` → `Verify published knowledge schema`；`website/public/llms.txt` 恢复 machine-readable schema 指向 `knowledge.schema.json`。
- 根 `llmdoc.config.json` 移除已失效的 `$schema`，仅保留 `schema: llmdoc.config/v1` 作为显式 migrate 输入。

### R1-f 休眠 V3 API（finding 6）

- `cli/src/types.ts` 仅保留 `PaginationResult`/`OutputOptions`；删除 `DocumentKind`/`DocumentFrontmatter`/`CodeRef`/`ParsedDocument`/`MetaLedger`/`LlmdocConfig`/`LoadedLlmdocConfig`/`WorkspaceData`/`ValidationIssue`/`GitState`/`DocumentImpact`。
- `cli/src/lib/search.ts` 仅保留新协议共享函数（`matchesCodePathPattern`、`tokenizeQuery`、`cjkBigrams`、`countWords`、`buildSnippet`、`countSubstring`）；删除 `searchDocuments`、搜索缓存与对应 imports；`constants.ts` 删除 `CACHE_DIR`/`SEARCH_CACHE_FILE`。
- `cli/src/lib/markdown.ts` 删除 `validateCodeRefTags`，`extractCodeRefs`（migrate 专用）返回内联类型，去除 `CodeRef` 依赖。
- 新增 `cli/tests/runtime-surface.test.ts`（5 个扫描，无 Git）：无 `v3-ng`/`v3ng`/`runNg`/`ngX`/`lib/v3ng`/`llmdoc.ng-`（仅豁免冻结 `llmdoc.meta/v3-ng`）；无 `new/adopt/mv/fingerprint/init-state/upgrade` 注册且当前 18 命令齐全；`legacy.js` 仅 `migrate.ts` 引用；休眠 API 不再 export；`config.schema.json` 不存在且 `knowledge.schema.json` 为 `llmdoc.knowledge/v1`。定向 5/5 exit 0。

### R1-g 过时标题（finding 7）

- `knowledge-cli.test.ts` 标题改为 `keeps --version working and exposes no legacy runtime command`，断言 `--version` 等于包版本；V3 dispatch/fallback 由 `runtime-surface.test.ts` 静态证明无旧命令注册。`cli-output-schema.test.ts` 从“已移除契约”列表剔除已重新注册的 `hook`，并把注释去 v3-ng 品牌。

### R1-a–R1-g 定向门禁

- `npm run typecheck` exit 0；`npm run lint` exit 0；`scripts/check-codex-surface.mjs` exit 0；`scripts/check-prompt-budget.mjs` exit 0（五个 skill 与 hook 预算内）。
- 定向测试：`runtime-surface` 5/5、`cli-output-schema` 2/2、`cli-misc` 3/3、`knowledge-viewer` 7/7、`knowledge-review-seal` 30/30、`knowledge-manifest-safety` 4/4、`knowledge-navigation` 8/8、`knowledge-hook` 4/4，均 exit 0。

## M5 R1 收口门禁与最终证据（R1-h）— 2026-09-11

状态：**M5 R1 实现完成，等待 Codex review。** 未 stage/commit/reset/push；未改版本号、未发布、未 push；冻结 `docs/v3-ng-design/{README,architecture,roadmap}.md` 未改（`git diff --stat` 无输出）。

### 门禁证据（本机 Windows）

- `npm run typecheck`（cli，含 `src`+`tests`）exit 0。
- `npm run lint`（cli，`eslint src tests`）exit 0。
- `git diff --check` exit 0（仅 LF→CRLF 提示，无 whitespace error）。
- `node scripts/check-codex-surface.mjs` exit 0；`node scripts/check-prompt-budget.mjs` exit 0（`llmdoc` ~1587/1600，`init/update/prune/migrate` 及 hook 均在预算内）。
- 网站（`website/`）：`npm run check` exit 0（23 files，0 errors / 0 warnings / 0 hints）；`npm run build` exit 0（产物含 `/schemas/knowledge.schema.json`）；`npm run check:schema` exit 0（`published knowledge schema check: ok`）。
- 命名空间/legacy 可达性扫描：`rg 'legacy\.js' cli/src` 仅 `lib/knowledge/migrate.ts:44`；`rg -i 'v3-ng' cli/src` 仅冻结的 `llmdoc.meta/v3-ng` 三处（`meta.ts:8`/`init.ts:258`/`seal.ts:455`）；`runNg|ngTree|ngError|lib/v3ng|llmdoc.ng-` 无命中；`.command("new|adopt|mv|fingerprint|init-state|upgrade")` 无命中；`cli/schemas/config.schema.json` 不存在。以上由 `cli/tests/runtime-surface.test.ts`（5/5）机械固化。
- **原样 `npm test`**（根目录 `npm test` → `npm --prefix cli test` → `npm run build && vitest run`，`fileParallelism:false`）：**exit 0，30 files / 262 tests 全过，Duration 3248.17s**；无 FAIL/Unhandled/Timeout、无超时预算失败。日志 `.llmdoc-tmp/m5r1full.log`。
- 与 Codex 首轮对比：29 files / 247 tests / 8 timeout / 3109.62s → 30 files / 262 tests / 0 timeout / 3248.17s。新增为 `runtime-surface` 5 个静态扫描 + viewer 新增 4 个 serve/404 用例 + `knowledge-review-seal` 拆分净增 6 个用例；断言未删除或弱化。

### Linux

- 本机无 Linux 环境；Linux 仅以 CI 配置为证据：`.github/workflows/ci.yml` 的 `Node 18/20/22` test job（typecheck/lint/test/build/check:prompts）、`Dogfood dual-repository (Linux)` job（`npm ci && npm run build` + `npm run validate:dogfood`）、`Website and published schema` job（`check && build` + `check:schema`）。**Linux 未本地执行，仅记录 CI 配置证据。**

### 剩余限制

- 全量 `npm test` 在 Windows/AV 主机约 54 分钟；已保持串行执行并仅对真实 Git 密集文件声明更大预算，未改为并行以避免 Git 进程抖动。
- 冻结设计文档未迁就实现；`llmdoc.meta/v3-ng` schema 标识与显式 legacy-V3 迁移历史按约束保留，其余运行时品牌已移除。

状态：**M5 R1 实现完成，等待 Codex review。** 停止，不提交。

## M5 R2 集中审查发现与修复计划 — 2026-09-11

状态：计划先行。先落本计划再改代码。R2 关闭 Codex 集中复审的三项发现：published knowledge schema 与运行时校验不一致、serve 端口错误契约不统一、插件 hook 的 fail-open 仅从 npm/npx 启动的 CLI 加载后才生效。不改冻结 `docs/v3-ng-design/{README,architecture,roadmap}.md`，不引入 V3 兼容，不改版本、不发布、不 push，不 stage/commit/reset；保留全部 M5 工作。

### 发现与落点

1. **published schema 与运行时校验不一致。** `cli/schemas/knowledge.schema.json` 顶层与 remote 条目均为 `additionalProperties:false`，但 `cli/src/lib/knowledge/knowledge-config.ts::validateKnowledgeLayoutConfig` / `validateRemotes` 接受未知键，且 `remotes: null` 被当作空数组。修复：运行时严格拒绝未知顶层键与未知 remote 键，`remotes` 仅“缺省”为空、`null` 拒绝，全部抛 `E_KNOWLEDGE_CONFIG_INVALID`（exit 2）；新增测试用 Ajv 编译 published schema，与运行时逐一比对 representative 配置的 accept/reject 完全一致；不重新引入 V3 config schema。
2. **`llmdoc --json serve --port nope` 输出纯文本。** 现有范围错误（`65536`）在 `commands/serve.ts::assertViewerPort` 抛 `E_INVALID_PORT` JSON，但 `cli.ts::parsePort` 对非整数抛 `CliError`（纯文本、`exit 1`）。修复：把端口字符串解析收敛到 `serve.ts::parseViewerPort`，复用 `assertViewerPort`；malformed/非整数/负数/越界一律 `E_INVALID_PORT`、exit 2；`0` 仍有效。更新 `runCli` 测试，并新增 built CLI（`cli/dist/bin/llmdoc.js`）spawn 测试证明同一契约。
3. **hook fail-open 起点太晚。** `hooks/hooks.json` 直接 `npx ...`：当 npx 无法安装/解析/启动（离线 registry、缺 npm、spawn 失败、超时）时 hook 命令自身非零退出，可能阻塞宿主。修复：新增跨平台插件侧 Node 启动器 `hooks/llmdoc-hook-launcher.mjs`，默认仍用同一 scoped alias（`npx -y --package=@tokenroll/llmdoc-hook-runtime@npm:@tokenroll/llmdoc -- llmdoc hook <event>`）以保证不被同名本地依赖遮蔽；仅在启动/超时/非零退出时 fail-open：SessionStart 输出简短纯文本诊断，Stop/PreCompact 输出合法 `{continue:true,systemMessage:...}` JSON，一律 exit 0；成功时按原始字节转发子进程 stdout，保持现有 CLI 输出不变。`hooks/hooks.json` 用仓库既有兼容约定 `${PLUGIN_ROOT:-$(git rev-parse --show-toplevel)}` 从已安装插件定位启动器，避免假定消费方 cwd；命令不含 Windows/Linux 不兼容的引号。扩展 `scripts/check-codex-surface.mjs`（静态校验 hooks.json 启动器形式 + 启动器内 scoped alias）与 `scripts/check-prompt-budget.mjs`（渲染插件根后执行命令，并用空 PATH 做确定性模拟启动失败，断言 SessionStart 纯文本、Stop/PreCompact 合法 JSON 且 exit 0），不依赖真实网络中断。

### 分步实施顺序（每步立即追加“M5 R2 实施与验证记录”）

1. **R2-1 config 契约对齐**：`knowledge-config.ts` 未知键/`remotes:null` 拒绝；新增 `cli/tests/knowledge-config-schema.test.ts`（Ajv 与运行时双向比对）。
2. **R2-2 serve 端口契约**：`commands/serve.ts::parseViewerPort` + `cli.ts` 改接；扩展 `knowledge-viewer.test.ts`（malformed/越界/负数 JSON `E_INVALID_PORT` exit 2，`0` 有效）与 built CLI spawn 用例。
3. **R2-3 hook 启动器**：新增 `hooks/llmdoc-hook-launcher.mjs`；改 `hooks/hooks.json` 用 `${PLUGIN_ROOT:-$(git rev-parse --show-toplevel)}` 调用启动器；扩展 `check-codex-surface.mjs`、`check-prompt-budget.mjs`（渲染命令 + 空 PATH 模拟失败）。
4. **R2-4 收口门禁**：定向测试（config/schema、serve CLI/output schema、hook/launcher）→ `npm run typecheck` → `npm run lint` → `git diff --check` → `node scripts/check-codex-surface.mjs` → `node scripts/check-prompt-budget.mjs` → website check/build/schema → 原样根 `npm test` 一次；记录精确 exit/files/tests/duration，区分本机 Windows 验证与仅 CI 的 Linux 配置；结束时状态置“M5 R2 实现完成，等待 Codex review”，停止不提交。

断点续接：中断后先读本节、冻结 README/architecture §5–§7，再核对 `git status` 与已完成子步骤；不重复已完成工作，不 stage/commit/reset/push。

## M5 R2 实施与验证记录 — 2026-09-11

状态：进行中；未 stage/commit/reset/push。每完成一步即记实际证据。

### R2-1 config 契约对齐（finding 1）

- `cli/src/lib/knowledge/knowledge-config.ts`：新增 `LAYOUT_ALLOWED_KEYS`/`REMOTE_ALLOWED_KEYS` 与 `rejectUnknownKeys`；`validateKnowledgeLayoutConfig` 拒绝未知顶层键，`validateRemotes` 拒绝未知 remote 键；`remotes` 仅“缺省”为空数组，`null`/非数组拒绝。全部抛 `E_KNOWLEDGE_CONFIG_INVALID`（exit 2）。published schema 未改（已为 `additionalProperties:false`），故与运行时语义一致。
- 新增 `cli/tests/knowledge-config-schema.test.ts`：用 Ajv 编译 `cli/schemas/knowledge.schema.json`，对 18 个 representative 配置（valid full/minimal/empty-remotes；未知顶层键；未知 remote 键；null/非数组 remotes；remote 缺 url/空 name/非字符串 url；缺/wrong schema；非法 repositoryId；非字符串 repositoryId；layoutVersion 2 与 "1"；顶层数组；null）逐一断言 schema 与运行时 accept/reject 完全一致，另断言未知键错误信息含 `unknown key`。
- 证据：`npx vitest run tests/knowledge-config-schema.test.ts` exit 0，1 file / 19 tests passed，Duration 536ms。

### R2-2 serve 端口契约（finding 2）

- `cli/src/commands/serve.ts`：新增 `invalidPort`/`parseViewerPort`；`assertViewerPort` 复用同一错误构造。`parseViewerPort` 仅接受 `^[+-]?\d+$`，再经 0–65535 范围校验，malformed/非整数/负数/越界一律 `E_INVALID_PORT`（exit 2，含 paths/remediation）。
- `cli/src/cli.ts`：`serve --port` 解析器由旧的 `CliError("Invalid port: …")`（纯文本、exit 1）改为 `parseViewerPort`；删除本地 `parsePort`。`KnowledgeError` catch 在 `--json` 下输出 schema 校验过的 `knowledgeError` JSON。
- `cli/tests/knowledge-viewer.test.ts`：端口用例扩展为 `nope|abc|1.5|70000|65536|-1|""` 与 `--port=-1`，逐一断言 exit 2、`E_INVALID_PORT`、`assertOutputSchema("knowledgeError",…)`；新增 `parseViewerPort("0")===0`、`parseViewerPort("65536")` 抛错，以及 built CLI（`cli/dist/bin/llmdoc.js`）spawn `--json serve --port nope|70000` 同契约。
- 证据：`npm run build` exit 0；built CLI 实跑 `node dist/bin/llmdoc.js --json serve --port nope` 输出 `E_INVALID_PORT` JSON、exit 2（`70000` 同）。`npx vitest run tests/knowledge-viewer.test.ts` exit 0，1 file / 8 tests passed，Duration 80.49s。

### R2-3 hook 插件侧 fail-open 启动器（finding 3）

- 新增 `hooks/llmdoc-hook-launcher.mjs`：Node 跨平台包装。默认执行单一安全命令串 `npx -y --package=@tokenroll/llmdoc-hook-runtime@npm:@tokenroll/llmdoc -- llmdoc hook <event>`（仅固定 token，无 Windows/Linux 引号问题，scoped alias 防同名本地依赖遮蔽）；成功时按原始字节转发子进程 stdout/stderr、沿用子进程退出码。启动/超时/非零退出时 fail-open：`session-start` 输出简短纯文本诊断，`stop`/`compact` 输出 `{"continue":true,"systemMessage":…}` JSON，一律 exit 0。未知事件按 JSON 诊断、exit 0。用 `shell:true` + 单一命令串避免 Node DEP0190 警告污染输出。
- `hooks/hooks.json`：三个事件改为 `node "${PLUGIN_ROOT:-$(git rev-parse --show-toplevel)}/hooks/llmdoc-hook-launcher.mjs" <event>`，用仓库既有兼容约定从已安装插件定位启动器，不再假定消费方 cwd；描述更新为经插件根启动器且 fail-open。
- `scripts/check-codex-surface.mjs`：改为解析 hooks.json 结构取 command（避免内嵌 `\"` 破坏旧正则），断言三命令等于经 `${PLUGIN_ROOT:-$(git rev-parse --show-toplevel)}` 定位的启动器调用；并静态断言启动器含 scoped alias 与通过 npx 启动。
- `scripts/check-prompt-budget.mjs`：新增 `renderHookCommand` 渲染插件根后执行真实命令；新增确定性 fail-open 证明——在临时目录写入必然失败的 `npx`（Windows `npx.cmd` / POSIX `npx`）并前置到 PATH（模拟缺 npm/离线，不依赖真实网络中断），断言 SessionStart 纯文本非空非 JSON、Stop/PreCompact 为 `continue:true` + 非空 `systemMessage` 的合法 JSON、全部 exit 0。
- 证据：`node scripts/check-codex-surface.mjs` exit 0；`node scripts/check-prompt-budget.mjs` exit 0（`hook launcher SessionStart/Stop/PreCompact: ok`，`hook launcher failure SessionStart/Stop/PreCompact: fail-open ok`）；`npx vitest run tests/knowledge-hook.test.ts tests/cli-output-schema.test.ts` exit 0，2 files / 6 tests passed，Duration 19.46s。

## M5 Codex 接管 R2 收口计划 — 2026-09-11

状态：用户要求停止 OpenCode，由 Codex 直接接管 M5 R2 审查、修复、验证与提交。OpenCode 会话及其长时全量测试已终止；现有 R2-1/R2-2 实现保留并独立复核，不重复已通过的无关工作。

接管审查发现：R2-3 声称跨平台，但 `hooks/hooks.json` 使用 POSIX shell 参数展开 `\${PLUGIN_ROOT:-$(git rev-parse --show-toplevel)}`。该表达式在 Windows `cmd.exe` 不成立；现有测试先手工替换表达式再执行，因此隐藏了真实宿主命令的跨平台问题。fallback 还会从消费仓库的 Git 根寻找插件文件，违反“从已安装插件定位启动器”的边界。此项必须修复后才能通过 M5 review。

执行顺序：

1. 核实本机已安装插件/宿主对插件根变量的真实约定，改成由宿主展开且不依赖 POSIX 命令替换的稳定入口；测试必须执行与宿主等价的渲染结果，不能再用消费仓库 Git 根兜底掩盖错误。
2. 独立复核 R2-1 schema/runtime 严格一致性和 R2-2 全部端口错误 JSON 契约；补足发现的边界问题。
3. 先跑定向测试、typecheck、lint、surface/prompt、website schema 门禁。全量测试采用可观察的逐文件串行执行并记录每文件结果，避免单条 50 分钟命令无进度；已有 R1 原样 `npm test` 30 files / 262 tests 全过作为基线，R2 改动相关文件必须重新执行。
4. 全部通过后更新本节为实际证据，stage 精确 M5 变更并提交；不 push、不改版本、不发布。

执行记录：本机已安装的 Claude/Codex 共用 hook 清单使用 `node \"${CLAUDE_PLUGIN_ROOT}/...\"`，Claude 本地 changelog 也明确记录该变量由插件系统替换。`hooks/hooks.json` 已改为三处 `${CLAUDE_PLUGIN_ROOT}` 入口；surface check 同步断言精确命令，prompt check 仅模拟宿主替换该变量，不再支持或掩盖 Git-root fallback。该形式的路径由宿主在进入 shell 前替换，Windows/Linux 均只执行普通 `node \"绝对路径\" event`。

### 测试分层设计（用户评审调整）

全量日志证明 3248s 中 3238s 位于测试正文，编译/收集不足 7s；主要成本来自真实双 Git 事务、CAS/锁/故障注入与 Windows 子进程/杀毒 I/O，而不是 Vitest 本身。继续让默认 `npm test` 承担 30 个文件会使本地反馈接近一小时，并让 Node 18/20/22 CI 矩阵重复同一协议压力测试。

本里程碑直接分层：

- `npm test`：build 后运行 quick manifest。覆盖纯契约（CJK/search、输出 schema、published knowledge schema、运行时表面）、锁/registry、source context、内容有效性、CLI breaking replacement、hook/viewer，并额外只运行 `knowledge-review-seal` 的单条成功 seal smoke。目标是 Windows 数分钟内完成，同时至少穿过一次 Source Git → review manifest → Knowledge Git seal 的关键路径。
- `npm run test:integration`：build 后运行现有完整 Vitest 集，保留全部真实双仓、事务、CAS、锁竞争、迁移、故障回滚和 dogfood 证据。M5 最终提交前由 Codex 执行一次。
- CI：Node 18/20/22 矩阵运行默认 quick；另设单一 Node 22 full protocol integration job 运行 `test:integration`。删除重复 dogfood job，因为 dogfood 文件已经属于 full integration；保留 `validate:dogfood` 作为可单独调用的诊断入口。

实现采用 `cli/vitest.quick.config.ts` 显式列出 quick 文件，避免依赖 shell glob，便于 Windows/Linux 一致执行；seal smoke 通过第二条 Vitest 命令按稳定测试名选择，不复制实现或新增镜像测试。`cli/package.json` 和根 `package.json` 暴露同名脚本，README/双语 README 与 CI 同步说明分层边界。

默认门禁实测：根 `npm test` exit 0；quick manifest 12 files / 98 tests 全过，Duration 239.86s；随后 seal smoke 1 passed / 29 skipped，Duration 41.53s。合计约 4.7 分钟，且真实执行了 source context、viewer/hook、schema、lock/registry 与一次 review-manifest → seal → clean Knowledge Git 成功路径。`test:integration` 使用 verbose reporter，让长时完整套件逐用例输出实际进度。

## M5 Codex 最终 review 与收口证据 — 2026-09-11

状态：**M5 review 通过并已提交。** Codex 已终止 OpenCode 写者并独立检查实际 diff；冻结 `README.md`、`architecture.md`、`roadmap.md` 未改。R2-1/R2-2 实现成立；R2-3 的错误 POSIX plugin-root fallback 已由 Codex 改为宿主标准 `${CLAUDE_PLUGIN_ROOT}`，无消费仓库 cwd/Git-root fallback。

最终本机 Windows 证据：

- R2 定向：`knowledge-config-schema`、`knowledge-viewer`、`knowledge-hook`、`cli-output-schema` 共 4 files / 33 tests 全过，Duration 117.69s。
- 默认 `npm test`：quick 12 files / 98 tests 全过，Duration 239.86s；真实 seal smoke 1 passed / 29 skipped，Duration 41.53s；总计约 4.7 分钟。
- 完整 `npm run test:integration`：**31 files / 282 tests 全过，Duration 3574.91s**（tests 3563.88s），verbose 逐用例可观察；无失败或超时。
- 独立 `npm run validate:dogfood`：1 file / 3 tests 全过，Duration 180.09s；覆盖完整新协议闭环、dirty/staged 阻断及只有显式 migrate 才读取 legacy V3。
- `npm run typecheck`、`npm run lint`、`npm run build`、`git diff --check` 均 exit 0；仅 Git 的 LF→CRLF 提示，无 whitespace error。
- `node scripts/check-codex-surface.mjs`、`node scripts/check-prompt-budget.mjs` 均 exit 0；SessionStart/Stop/PreCompact 正常 launcher 与确定性 npx 失败 fail-open 全部通过。
- 网站 `npm run check` 为 23 files、0 errors/warnings/hints；`npm run build` 构建 13 pages（含 `/schemas/knowledge.schema.json`）；`npm run check:schema` 通过。
- `.github/workflows/ci.yml` 由 `js-yaml` 成功解析。Node 18/20/22 跑 quick；Node 22 单独跑 full integration；Linux 仍为 CI 配置证据，本机未执行 Linux。
- runtime-surface 完整套件已验证：无 `lib/v3ng`/ng 命令或 V3 dispatch/fallback；legacy 只从显式 migrate 可达；旧 config schema 与 dormant V3 API 均已移除。

提交边界：自 M4 commit `4b1e50e` 后的全部工作均为 M5 接入、文档、发布 surface、R1/R2 修复和用户评审后的测试分层；`.llmdoc-tmp/**` 为 ignored 测试日志，不进入提交。不改版本、不发布、不 push。

## Git 身份校正与 ponytail 审查 — 2026-09-11

状态：本仓库本地 Git 身份已设置为 `vegetable6 <xukun6cai@gmail.com>`，未修改全局 Git 配置或其他仓库。`v3-ng` 尚未推送且无 upstream，因此将 M1–M5 五个提交的 author/committer 原地改写为该身份；改写前后 `git diff` 为空，代码树完全一致。改写后的 M1–M4 为 `4af2838`、`65151ff`、`bb1d72a`、`4b1e50e`；M5 保持为当前 HEAD。本轮不 push。

`ponytail-review` 只审查过度设计，没有直接修改实现。高置信精简项是：删除已被领域测试覆盖的 R1/R2/roadmap 阶段测试；让运行时直接使用已发布 `knowledge.schema.json`，删除手写平行 validator；删除 viewer 内部旧字段适配；让 Codex 插件直接复用 canonical `skills/`，删除 `.agents/skills/` 镜像和 parity 维护；合并三处 canonical document id 谓词；将重复迁移故障场景改为表驱动；移除 CI 在 `npm test` 后的重复 build。事务 CAS、临时 index、锁、manifest 漂移和故障回滚属于协议安全边界，不列入删除范围。下一步是在用户确认实施范围后先写精简设计和验收边界，再改代码。

## README 设计原则显式化 — 2026-09-11

状态：完成，待提交。中英文 README 已在产品定位后增加同构的“Design principles / 设计原则”六项清单：事实与理解分离、唯一持久写入边界、长期知识准入、变化产生复核义务、有效性可检查、人机同权协议；原先后文重复的知识准入段落已合并删除。未改变冻结协议、CLI 行为或测试边界。`rg` 确认两份 README 均为六项且语义对应，`git diff --check` 通过（仅 LF→CRLF 提示）；提交边界仅为 `README.md`、`README.zh-CN.md` 和本进度记录。

## Ponytail 高收益精简实施计划 — 2026-09-11

状态：设计先行，待实施。基线为 README 原则提交 `aa0eb39`，只精简重复实现和重复验证，不改变双仓协议、错误码、正式命令面或持久写入边界。

| 子项 | 实施边界 | 必须保留 | 验收 |
|---|---|---|---|
| S1 Schema 单一真源 | `knowledge.schema.json` 改为 canonical machine-readable contract；`knowledge-config.ts` 直接用现有 Ajv + `packageRootFromImport` 编译该 schema，删除手写 shape/key/version validator；测试删除“schema 与同一 schema 比较”的双轨矩阵 | YAML parse 错误、`E_KNOWLEDGE_CONFIG_INVALID`/exit 2/paths、未知键诊断、缺省 `remotes=[]`、手工配置与 Git remote 的 URL credential strip、包内 schema 缺失仍算内部故障 | focused config test、typecheck/build、默认 quick；最终统一 integration |
| S2 Viewer 新 DTO 直用 | 删除 `adaptState`；三个 viewer asset 统一消费 `id/sourcePaths/issues`，直接计算 token/error/warning，不再合成 `path/codePaths/growth/validate` | document fetch 参数仍是文档 id；topic/document graph、内部链接、状态 chip 行为不变 | legacy 字段 grep 为空、三个 asset `node --check`、viewer/read tests；必要时浏览器 smoke |
| S3 Skills 镜像 | 本轮调查后保留，不机械删除 | Claude 依赖 `disable-model-invocation: true`，当前 Codex validator 拒绝该字段并要求 `agents/openai.yaml` policy；零副本会削弱一侧“migrate 仅显式调用”的硬门控。当前 664 行镜像是宿主 schema 冲突成本，不是 V3 兼容层 | 记录阻塞证据；未来只有在单一 SKILL 可同时通过两宿主官方 validator 时删除 |
| S4 阶段测试收敛 | 将 `knowledge-r1/r2` 的独有断言迁入 content/read/validate/status/runtime 等领域测试；`knowledge-boundaries` 全部由现有领域测试覆盖后删除；`knowledge-replacement` 仅迁移 bare bound cwd 与 legacy 不可见行为；再删除四个阶段文件 | fixed committed K、identity mismatch、partial evidence、supersedes、literal/glob、history blocker、canonical graph、bare command 和 no legacy fallback；事务/CAS/锁/manifest/故障注入测试不动 | 先跑迁移目标定向集，再跑默认 `npm test`；完整 `npm run test:integration` 作为本轮收口证据 |

实施可并行进行 S1、S2 与 S4；它们文件边界独立。合并后先检查实际 diff 与净删行，再执行定向、quick 和完整 integration。任何独有协议断言未找到明确落点时保留，不以删行数代替覆盖。

## Ponytail 精简实施记录 S1–S4 — 2026-09-11

状态：S1/S2/S4 已实施，S3 经调查保留；定向、quick、surface/prompt 门禁已通过；完整 `test:integration` 尚未完成（首跑被中断，待重跑）。未 stage/commit/reset/push。

### S1 Schema 单一真源（完成）

- `cli/schemas/knowledge.schema.json` 改为 canonical machine-readable contract（补 `remotes.default=[]`）；`cli/src/lib/knowledge/knowledge-config.ts` 删除手写 shape/key/version validator（`LAYOUT_ALLOWED_KEYS`/`REMOTE_ALLOWED_KEYS`/`rejectUnknownKeys`/`validateRemotes`），改为用现有 Ajv + `packageRootFromImport` 在模块加载时编译该已发布 schema；运行时不变量保持不变：YAML parse 错误、`E_KNOWLEDGE_CONFIG_INVALID`/exit 2/paths、未知键诊断（`formatSchemaErrors`）、缺省 `remotes=[]`、URL 凭据剥离、包内 schema 缺失仍为 `E_FILESYSTEM_IO`(70)。
- `cli/tests/knowledge-config-schema.test.ts` 重写为 13 个运行时候选契约用例；删除与同一 schema 比较的双轨矩阵。

### S2 Viewer 新 DTO 直用（完成）

- `cli/assets/viewer-app.js`：删除 `adaptState`（`path/codePaths/growth/validate` 旧字段合成），直接消费 `id/sourcePaths/issues` 并即时计算 token/error/warning；文档选择、graph highlight、fetch 均改用 `node.id`。`viewer-model.js`/`viewer-detail.js` 同步改 `id`。`/api/doc?path=<id>` 的参数约定保持不变（服务端仍按文档 id 读取）。
- legacy 字段 grep（`codePaths|\.growth|\.validate\b|node\.path|adaptState`）在 assets 中为空；四个 asset `node --check` 通过。

### S3 Skills 镜像（调查后保留，不删）

- Claude `migrate` 依赖 `disable-model-invocation: true` 强制显式调用，当前 Codex validator 拒绝该字段并要求独立 `agents/openai.yaml` policy；零副本会削弱至少一个宿主的“migrate 仅显式调用”门控。保留 canonical `skills/` 与 `.agents/skills/` 镜像，等待单一 SKILL 可同时通过两宿主官方 validator 时再收敛。

### S4 阶段测试收敛（完成）

- 删除四个按开发阶段保留的测试文件：`knowledge-boundaries`（262 行）、`knowledge-r1`（392）、`knowledge-r2`（410）、`knowledge-replacement`（200）。
- 独有契约断言已迁入领域测试并保留：
  - `knowledge-content`：canonical relation graph（missing/self/非法路径只进 issue 不入图）、`requiresProblems`、supersedes missing/self/cycle 仅结构 issue 且不改三态、`history_unavailable` blocker + `historyAvailable=false`（digest mismatch 短路不掩盖历史 blocker）、`diverged` blocker、meta evidence 成组拒绝（partial evidence / digest 无 revision / 非规范 ID / 短 OID）。
  - `knowledge-read`：committed config/meta 身份不符 `E_SOURCE_IDENTITY_MISMATCH`、committed 非法 ledger → `unverified`、裸命令在已绑定 cwd 读正式知识且 source 侧 legacy `.mdx` 不可见、无精确绑定的 explicit pair `identityVerified=false` 且不得 current。
  - `knowledge-validate`：合法+非法 source path 别名逐篇报错、glob 有匹配不报 `glob-empty`、live worktree 未提交文件不满足 glob。
  - `knowledge-status-delta`：无关 committed source 变化保持 current、dirty source 只报 blocker 不改 committed 文档状态。
  - `runtime-surface`：CLI 不再出现 `--docs`。
- `knowledge-helpers.ts` 清理死导出：删除无引用的 `gitAllowFail`，`commitKnowledge`/`knowledgeMetaJson` 收回为内部函数。

### 定向与门禁证据（本机 Windows，真实临时双 Git）

- 定向 6 文件 62/62：`knowledge-config-schema` 13、`knowledge-content` 16、`knowledge-read` 17、`knowledge-validate` 5、`knowledge-status-delta` 6、`runtime-surface` 5；另 `knowledge-viewer` + `knowledge-cli` 14/14；全部 exit 0。
- `npm run typecheck` exit 0；`npm run lint` exit 0；`node scripts/check-codex-surface.mjs` ok；`node scripts/check-prompt-budget.mjs` ok；`git diff --check` exit 0（仅 LF→CRLF 提示）；asset `node --check` 4/4。
- 默认 quick `npm test`：exit 0，12 files / 98 tests + seal smoke 1 passed / 29 skipped。
- 本轮实际 diff：22 files，+414/−1520（净 −1106 行，含 progress/README 记录）。

### Ponytail 复查（合并后）

- 复查未发现新增过度设计；两处保留判断：`knowledge-config.ts` 与 `output-schema.ts` 各自引导 Ajv 是约 10 行的重复，但抽共享 helper 需要新模块、净收益接近零；`knowledge.schema.json` 的 `default: []` 仅作契约文档，运行时不消费（`?? []`），保留。
- `.codegraph/` 与 `.llmdoc-tmp/` 未纳入实现或提交。

### 剩余问题与下一步

- 完整 `npm run test:integration` 需在本轮变更冻结后重跑一次，记录真实 exit/files/tests/duration；此前首跑被用户中断，不作为通过证据。

## 设计原则对齐（更新为 7 项）— 2026-09-11

状态：README 原则更新为最新 7 项；Agent 接入面按第 6 项（Agent 维护知识，人负责审阅结论）修正；运行时审计未发现需要改协议代码的偏差。未 stage/commit/reset/push。

### 原则更新与代码审计

- `README.md` / `README.zh-CN.md`：设计原则由 6 项更新为最新 7 项（新增“Agent 维护知识，人负责审阅结论”“知识与执行指令分离”；中英文同构）。最终版原则未包含早前草稿中的 MDX 格式条款，实现继续保持“受限、可静态阅读的标准 Markdown”；若后续恢复 MDX 条款，属协议变更，应单独设计。
- P1–P5、P7 运行时核对（不依赖测试数量）：Source Git 经 `resolveSourceContext` 只读且无 fallback（P2）；持久知识+四项证据只在 Knowledge Git（P1/P5）；inbox 候选与 prune 收敛区分正式/非正式知识（P3）；`status`/`delta` 产出复核义务、无 diff 自动 changelog（P4）；检索 envelope 返回双 revision/blockers/history/issues，文档 summary 返回 status/reasons/sourcePaths（P5）；正式文档为静态 Markdown，hook 仅输出计数与 guidance 且显式声明 reference data（P7）。
- P6 修正（删除把人工授权当维护前置条件的措辞）：
  - `skills/llmdoc/SKILL.md` 与 `.agents/skills/llmdoc/SKILL.md`（正文镜像一致）：Reflection Gate 由“ask once to run `/llmdoc:update`; wait for authorization”改为“fold it into stable knowledge via `/llmdoc:update`; review may follow”；Operating Rules 的“Align before non-trivial edits”明确为 code edits。
  - `docs/agent-integration.md`：删除“then wait for user confirmation”“Run `prune` only with user confirmation”“After user confirmation”；改为 Agent 运行 `update`/在报告给出具体证据时运行 `prune`，人工审阅 sealed conclusions 保持可选；reflection 合并对象由“durable rule”改为“durable knowledge”（P3/P7 用词）。
- 预算回归：`skills/llmdoc` 曾因新措辞到 ~1618/1600，已压缩到 ~1591/1600；`check-codex-surface`/`check-prompt-budget` 复跑 ok。
- 待办：上述变更并入最终 integration 门禁；若通过，更新本节状态为“实现完成，等待 Codex review”。

### Integration 首跑失败与预算修正 — 2026-09-11

- 首跑 `npm run test:integration`：exit 1，27 files（24 passed / 3 failed）、257 tests（252 passed / 5 failed）、Duration 4407.79s。失败为 4 个超时 + 1 个断言：
  - `knowledge-dogfood-e2e` 主用例 180s 超时；`knowledge-dogfood-e2e` dirty/staged 用例 `expected 2 to be 3`。
  - `knowledge-review-seal` “refuses to review or seal a structurally invalid worktree”“does not consume a no_change manifest…” 各 120s 超时。
  - `knowledge-viewer` “never lists inbox candidates as formal knowledge” 60s 超时。
- 根因判定：非代码回归。断言失败的 dirty/staged 用例隔离复跑通过（42s）；同机实测这些真实双 Git 用例已超出旧预算——viewer inbox 71s、dogfood 主用例 197s、review-seal 单测最长 106s（旧记录最长 78.6s）。本机 `%TEMP%` 还积累了 5389 个历史测试临时目录（11.6MB），已清理。
- 修正（仅调度参数，未改任何断言/未吞错）：`knowledge-dogfood-e2e` `testTimeout` 180000→300000；`knowledge-viewer` 60000→120000；`knowledge-review-seal` 120000→180000。
- 隔离复跑：3 files / 41 tests 全过（viewer 119.0s、dogfood 243.8s、review-seal 单测最长 106.2s）。
- 下一步：重跑完整 `npm run test:integration` 作为本轮收口证据。

## Codex review 修复计划 — 2026-09-11

状态：设计先行，待实施。以当前 README 七项原则为准；第 6 项“Agent 维护知识，人审阅结论”不回退。仅修复本轮 review 已确认的问题，不扩大协议或恢复已删除的阶段测试。

1. `knowledge-config.ts` 将 packaged schema 的定位、读取与 Ajv 编译改为首次配置校验时惰性执行并缓存；所有失败继续映射为 `E_FILESYSTEM_IO`(70)，避免 ESM 模块加载阶段绕过 CLI 错误处理。
2. README 第 5 项只修正三态名称为 `current / needs_review / unverified`，不改变当前七项原则。
3. 在现有领域测试中补最小协议断言：canonical requires 与 ledger key 对齐可保持 current；缺失 literal、零匹配 glob、仅 live worktree 命中的 scope 不得 current；history blocker 至少经一个公开 viewer/read 投影保持 `historyAvailable=false` 与 blocker code。
4. 定向测试、typecheck/lint/build 通过后执行 `ponytail-review`；只删除本轮新增的重复或无收益结构，不触碰 CAS、临时 index、锁、manifest 和故障回滚边界。完整 integration 由修复后的冻结工作树重新取证。

用户补充：七项原则与八条硬边界必须使用同一维护主体和权限模型。按当前第 6 项，将 README、流程图及冻结设计中残留的“人或 Agent 同权维护/确认”统一为“Agent 执行正式维护与验证，人审阅结论并将反馈送回 Agent 流程”；标准 Markdown 继续作为人可直接审阅的开放格式，不表示绕过 Agent + CLI 的正式发布协议。

### 实施与验证结果

- Schema validator 改为 `validateKnowledgeLayoutConfig` 首次调用时惰性编译并缓存；`packageRootFromImport`、schema 读取/解析及 Ajv 编译全部进入同一 `try`，失败映射为 `E_FILESYSTEM_IO`(70)。ESM 模块加载不再访问 packaged schema，`--help`/`--version` 不会因 schema 故障在 CLI 错误处理前崩溃。
- README 中英文第 5 项改用正式三态名 `current / needs_review / unverified`。第 6 项保持当前原则；双仓流程图、八条硬边界 6/8、`docs/v3-ng-design/README.md` 与 `architecture.md` 已统一为“Agent 正式维护，人审阅并反馈”，旧的人机同权维护/确认表述扫描为空。
- 覆盖缺口落入现有领域测试：依赖有效性用例用 `./guides/b.md` 证明 docs-root canonical key 与 ledger 对齐；单个 validity 用例同时证明 missing literal、空 glob、仅 live worktree 命中的 glob 均不得 current，而 committed matching glob 可 current；read 用例证明 `history_unavailable` 经 viewer DTO 保留 blocker、`historyAvailable=false` 和 needs_review。
- 定向测试：config/content/read 共 48 个用例最终全部通过。首次合跑有 1 个测试数据错误（误把 `./b.md` 当作相对当前文档目录）；按协议改为 docs-root 的 `./guides/b.md` 后 content 17/17 通过。`npm run typecheck`、`npm run lint`、`npm run build`、Codex surface、prompt budget、viewer asset `node --check` 均 exit 0；`git diff --check` 无错误，仅 Windows LF→CRLF 提示。
- `ponytail-review` 只发现一项：单调用点的 `knowledgeSchemaValidator()` 缓存 getter 可内联，预计净删 4 行；已内联为 `cachedValidateConfig ??= compileKnowledgeSchema()` 并复跑 config 13/13、typecheck、lint、build，全部通过。复查未发现其他可安全删除的抽象；Schema 单源、viewer 直用 DTO、阶段测试收敛与双宿主 skills 镜像均有当前边界支撑。
- 当前 OpenCode integration 在本轮修复前启动，其结果只代表旧快照，不能作为最终收口证据。最终提交前需基于当前冻结工作树重新跑完整 integration。

### 当前快照 integration 首跑 — 2026-09-12

- `npm run test:integration`：exit 1，27 files（26 passed / 1 failed）、259 tests（258 passed / 1 failed），Duration 4037.08s；唯一失败为 `knowledge-review-seal` 的 global review 用例在 180.478s 命中 180s timeout，其余事务、故障注入和所有其他文件均通过。
- 该用例串行执行 scoped review/seal 与 global review/seal 两套完整真实 Git 流程；同文件单次事务用例本轮已达 156.089s。处理边界：只为该双事务用例设置 300s 独立预算，不再提高整个文件的统一 180s timeout，不改断言和产品实现；先隔离复跑，再重新执行完整 integration 取得最终 exit 0。

### 第二次 integration 与 timeout 方案收敛

- global review 用例独立预算后隔离复跑 1/1 通过（70.406s）；第二次完整 integration 中该用例也以 68.266s 通过，但 `knowledge-update-prune` 的 candidate-only reject 用例从首跑的 57.500s 抖动到 90.019s，命中其文件 90s timeout。完整结果仍为 27 files 中 26 passed、259 tests 中 258 passed，Duration 3692.05s；唯一失败继续是 timeout，无断言失败。
- 两次全量分别由不同已单独通过的真实 Git 用例击穿文件级预算，证明分散 `vi.setConfig` 是不稳定的调度配置。收敛方案：默认 integration config 统一 `testTimeout=300000`；quick config 显式保持 `120000`；删除各测试文件的 23 处 timeout 覆盖和因此产生的无用 `vi` imports（保留实际用于 spy 的 `knowledge-init-hardening`）。不改断言或产品代码。完成后跑 typecheck/lint、失败用例隔离测试，再跑第三次完整 integration。

### 最终 integration 证据

- timeout 配置已收敛：`vitest.config.ts` 的 serial integration 统一 300s，`vitest.quick.config.ts` 显式 120s；23 个测试文件删除 `vi.setConfig`，仅 `knowledge-init-hardening` 保留真实 spy 所需的 `vi` import。candidate-only reject 隔离复跑 1/1 通过（69.624s），typecheck/lint exit 0。
- 第三次 `npm run test:integration`：exit 0，27/27 files、259/259 tests，Duration 3761.02s（tests 3751.60s）。此前超时的 global review 与 candidate-only reject 本轮分别 70.556s、75.501s 通过；无断言失败。
- 下一步只剩默认 `npm test` 验证 quick 的独立预算、网站 Schema 发布检查、最终 ponytail 复查与提交边界核对。

### 收口验证（默认 quick、网站 Schema、最终 ponytail、提交边界）— 2026-09-12

- 默认 `npm test`：exit 0。quick config 12 files / 99 tests，Duration 335.63s（tests 331.38s）；seal smoke 1 passed / 29 skipped（43.90s）。单测最长 52.674s（`knowledge-viewer` inbox），低于 quick 独立 120s 预算；`knowledge-contexts` 文件 153.974s 为 22 个用例合计，非单测超时。
- 网站 Schema 发布检查：`npm --prefix website run check:schema` 首跑发现 `website/dist/schemas/knowledge.schema.json` 仍是旧描述且缺 `default: []`；执行 `npm --prefix website run build` 重新生成后复跑 ok。`website/dist` 已被 .gitignore 忽略，不进入提交。
- 最终 ponytail 复查：只审视本轮新增结构（schema validator 惰性编译、viewer 适配层删除、测试收敛与 timeout 统一），无可继续删除项；`knowledge-config.ts`/`output-schema.ts` 各自引导 Ajv 与 schema `default: []` 两处保留判断维持不变。
- `npm run lint` exit 0；`npm run typecheck` exit 0；`git diff --check` exit 0（仅 LF→CRLF 提示）。
- 提交边界：纳入全部 tracked 变更（测试收敛、timeout 统一、schema 单源、viewer DTO、README/设计文档/skills）；排除 `.codegraph/`、`.llmdoc-tmp/`、`website/dist`、`cli/dist`。真实 `%APPDATA%\llmdoc\bindings.json` 留有一条 2026-09-11 20:02 的 `llmdoc-dogfood-fail-*` 测试遗留绑定；本轮默认 quick 与两次全量 integration 均未再写默认 registry，该文件在仓库边界外，单独提示用户处理。
