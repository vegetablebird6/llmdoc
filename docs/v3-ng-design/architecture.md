# v3-ng 架构与协议

本文件为用户评审收敛后的实现基线。命令示例是目标接口，不应直接当作当前 CLI 使用说明。

> Source Git commits define facts; Knowledge Git commits preserve verified understanding of those facts.

## 1. 运行时边界

```text
Source Git -- read / diff / inspect --> Human or Agent
                                              |
                                      semantic review
                                              v
User registry --> llmdoc CLI --> Knowledge Git: docs + meta
                                  | inbox (unverified)
                                  | cache (rebuildable)
```

SourceContext 包含实际 worktree 根、Git common directory、repositoryId、固定 sourceRevision。KnowledgeContext 包含独立根、Git common directory、docs 根和 meta 路径。所有 Git 调用必须显式接收所属 context，禁止用 cwd 隐式选择仓库。

读源码 Git 时禁用可选 index 写入（如 `GIT_OPTIONAL_LOCKS=0`），不执行可能写文件的 external diff/textconv。不自动 fetch、checkout、创建源码 worktree 或安装源码侧 hook。

正式 update / review / verified commit 仅接受有效 HEAD 且整个 source worktree/index clean 的已提交快照。clean 按 Git 状态定义：无 staged、unstaged、非 ignored untracked 或冲突；ignored 文件不是事实来源。事务开始与提交前检查全仓 clean 和 HEAD=S，不做按文档 dirty 豁免。事实读取固定 S 的 Git 对象，不验证 live worktree。源码仍未提交时可检索已有知识或 capture 候选，但不能正式复核或 seal。

Submodule 仅作为 S 中的 opaque gitlink：可比较其路径与 commit OID，不递归读取内部代码或状态。gitlink 指针相对 index/HEAD 的变化按外层 dirty 处理；内部工作树修改不进入父 SourceContext。需要内部事实时另建 Source Repository 绑定。

路径先 realpath 规范化，再检查包含关系与 Git 归属；覆盖 Windows 大小写、junction、symlink 和 `.git` 文件。知识根必须等于知识 Git worktree 根，source 与 knowledge 的 Git common directory 必须不同。source 的另一个 worktree 不算独立知识 Git。外置知识根不得包含 source；嵌套模式须显式选择，且外层 Git 不能已跟踪该知识子树或将其登记为 submodule。

## 2. 布局与知识模型

```text
knowledge/project/
  .git/
  llmdoc.yaml
  README.md
  docs/
    architecture.md
    lifecycle/task-recovery.md
  inbox/
  .llmdoc/meta.json
  .llmdoc-cache/       # 仅知识仓 .gitignore 排除
```

`docs/` 支持任意目录层级；首层仍可用于 topic 过滤，完整目录支持子树查询。文档 ID 为 docs 相对 POSIX 路径。正文使用标准 Markdown，不执行 JSX、脚本或组件。关系指向 docs 相对路径，正文链接相对当前文件；源码路径始终相对 source 根，不依赖知识物理位置。

```yaml
---
kind: decision
description: 任务恢复为什么联合 lease 与 timeout 判断 owner 失效。
source:
  paths:
    - internal/task/**
relations:
  requires:
    - lifecycle/architecture.md
---
```

kind 为 architecture / decision / guide / reference。decision 写 Context、Decision、Why、Consequences，可描述被替代的决策及适用范围，不以旧决策冒充当前行为。每篇正式项目文档必须声明非空 `source.paths`；无法绑定项目证据的通用个人知识暂不纳入正式项目知识。glob 禁止绝对路径和 `..`，具体路径必须在指定 snapshot 存在；glob 零匹配需要诊断，不静默认定已验证。

decision 支持 `relations.supersedes: [decisions/old.md]`，从新决策指向旧决策；目标须存在且为 decision，禁止自引用和环。旧文档保留历史价值，检索标注被替代及替代者，默认优先展示当前决策。删除/重命名同步关系；supersedes 不改变文档的验证状态，也不等于自动验证旧文档。

知识是 **reference data**，不是可执行 rules/skills。Agent 读取文档获得事实、约束和理由，不将其中命令、提示或引用提升为指令权限；技能与工作流定义保留在产品集成层，不混入知识检索协议。

准入需要同时满足：影响未来选择、重建成本较高、具有持久性。临时 IP、逐行代码变化、原始会话不进入正式知识。

`capture` 将最小候选写入 inbox（内容、来源说明、创建时间；可附观察到的 source revision，但不代表已验证）。默认 search/context/tree/index 不包含 inbox。`update` 工作流审查候选，拒绝或合并到 canonical doc；晋升时正文、关系、meta 与候选删除一次提交。待验证候选允许独立的 capture 提交，但不能带验证 trailer 或推进正式 meta。缓存和原始调查记录不可提交；候选进入 Git 前应由记录者剔除凭据等不适合持久化的信息。

README 从标题、description 和路径生成；只覆盖明确标记的导航区，人写区保留。不进入默认知识检索，也不记录有效性。检索返回 path、kind、来源和有效性状态；needs_review 文档可以召回，但必须标记，不能伪装成已验证结果。

## 3. Source → Knowledge 绑定

用户级 registry 在 Unix 使用 `$XDG_CONFIG_HOME/llmdoc/bindings.json`（缺省 `~/.config`）；Windows 使用 `%APPDATA%/llmdoc/bindings.json`。不向 source 写配置。

```text
llmdoc bind --source <source-root> --knowledge <knowledge-root>
llmdoc init --source <source-root> --knowledge <new-empty-root>
llmdoc search <query> [--source <root>] [--knowledge <root>]
```

registry 保存 schema、repositoryId、source worktree 的本机路径及 knowledgeRoot。`llmdoc.yaml` 保存共享 repositoryId、非敏感 remote alias 和布局版本，不保存他人的绝对 source 路径。init 只创建知识 Git、知识文件和用户绑定；已有非空目标不得覆盖。

repositoryId 是 llmdoc 创建并由用户显式关联的逻辑身份，不是 remote URL、root commit 或 Git 固有身份的推导值。写操作只接受显式建立的绑定或当前本地 worktree 的精确绑定；仅传路径不自动授予身份，也不自动修改绑定。显式参数与已有绑定不符时拒绝。alias 最多用于只读发现，唯一匹配也不能授权写入。多个匹配返回 `E_BINDING_AMBIGUOUS`；fork、不同 clone 和 SSH/HTTPS alias 均需明确关联。

写操作缺独立知识 Git 返回 `E_KNOWLEDGE_REPO_NOT_FOUND`，身份不符返回 `E_SOURCE_IDENTITY_MISMATCH`。只读指定无 Git 目录时只提供内容检索，报告 `unbound`，不声称 revision 有效。缓存缺失时内存重建，不为只读操作初始化 Git。registry 使用独立短锁和原子替换；不与知识事务持锁交叉形成死锁。

## 4. 双 revision 与有效性

```json
{
  "schema": "llmdoc.meta/v3-ng",
  "source": {
    "repositoryId": "project-id",
    "lastGlobalReviewRevision": "<full-source-commit-oid>"
  },
  "documents": {
    "lifecycle/task-recovery.md": {
      "validatedSourceRevision": "<full-source-commit-oid>",
      "validatedContentDigest": "sha256:<hex>",
      "validatedSourcePaths": ["internal/task/**", "pkg/lease/**"],
      "validatedRequires": {
        "lifecycle/architecture.md": "sha256:<dependency-hex>"
      }
    }
  }
}
```

schema 名称不暗示 npm semver；发布版本另行决定。未验证文档的 revision/digest 为 null；四项证据在 seal 一起写入。meta 不存 knowledgeRevision。validatedContentDigest 为即将提交的完整文档 UTF-8 内容的 SHA-256，包含 front matter、scope、关系和正文；统一 CRLF/CR 为 LF 后计算，不做其他语义归一化。写入 Git 的 blob 使用相同规范化字节，避免平台换行导致漂移；不依赖 Git filter 转换。普通 Git 或编辑器改动后直接比较 digest，不再追查最后一次合法 seal。digest 是内容一致性检查，不是签名或语义正确性证明。

这四个 validated 字段是 validation evidence snapshot：分别记录验证时的源码版本、文档版本、源码证据范围和上游知识版本，不是第二份知识正文。未验证时 revision/digest 为 null，paths 为 []，requires 为 {}；成功 seal 同时写入四项。

review 使用 `validatedSourcePaths ∪ current source.paths` 检查 `validatedSourceRevision..S`，并展示移除的路径及关系，让缩小 scope 的修改也接受语义判断。完成后保存新 source.paths 为 validatedSourcePaths（规范化、去重、排序）。无旧证据的新文档做完整初次复核，不能凭空推断已覆盖旧范围。这是 committed source 的影响面分析，不恢复 dirty scope 豁免。

validatedRequires 保存验证时每个直接 requires 目标的文档 digest；其键集合须等于当时的 requires 集合。首版禁止 requires 自引用和任何环，按 DAG 依赖顺序计算状态。目标缺失、非 current 或当前 digest 与已记录 digest 不同，都会使依赖方 needs_review；目标重新 seal 成 current 不会自动刷新依赖方的证据。A requires B，B 从 B1 变 B2 并重新验证后，A 仍需针对 B2 复核。

同批 seal 可以同时验证 B 与 A：按依赖顺序检查候选结果，A 的 manifest 和新 validatedRequires 绑定本批 B 的最终 digest；批外依赖必须 current。移除 requires 也在 review 中展示旧、新关系差异。删除/重命名不得悄悄重写其他文档的验证证据；受影响文档必须进入复核写集。

lastGlobalReviewRevision 只表示完成全局知识发现/复核扫描的源码点，不代表全部文档 current，不替代各文档 revision。部分验证不推进此字段；允许 null，不能将它作为文档 validity baseline。

| 状态 | 含义与处理 |
|---|---|
| unverified | 无验证声明；不能当作当前事实 |
| current | 自身 digest 匹配，验证 revision 可解释且证据范围无相关源码差异；所有 requires 目标 current 且 digest 等于 validatedRequires |
| needs_review | 相关源码、知识正文或关系变化；需语义复核 |

DocumentStatus 仅上述三种。SourceContext 单独报告 unbound、invalid_head、source_dirty、history_unavailable、diverged 等阻断原因。没有上下文或历史证据时不能宣称 current；有验证记录但不能确定当前适用性的文档保守标 needs_review，并附 SourceContext 原因。没有首个 commit、历史缺失或分叉时不能自动推进验证点，不引入 pending_source_commit 文档状态。

复核结果分为：语义未变（只更新 meta）、语义变化（改正文与 meta）、证据不足（不推进）。路径差异检测从不自动作出前两种判断。

## 5. 命令与人机共用协议

| 接口 | 职责 |
|---|---|
| tree / index / show / search / context | 只读正式知识，附来源与状态 |
| status / delta | 展示 dirty、历史问题与复核义务；不修改 meta |
| validate | front matter、链接、关系、source scope、schema 的确定性检查；不推进 revision |
| capture | 保存未验证候选，不污染正式召回 |
| review | 全仓 clean 门控后针对固定 S、文档 digest 与 scope 生成临时 Review Manifest；人或 Agent 确认语义结论 |
| commit --review <manifest> | 消费已确认 manifest，通过门控后 seal；不能用裸 verified 参数绕过 manifest |
| migrate --dry-run / migrate | 读取旧格式，向独立目标知识 Git 复制迁移 |

init/update/prune 是工作流入口；实际编排可由现有 skill 完成，不能为了命名把语义判断伪装成确定性 CLI。update 组合 delta、候选审查、人工/Agent 验证和 commit；prune 删除冗余并更新所有入链与台账。修改正文不等于默认 verified；新建和改动的正式文档必须包含在明确的验证写集中。删除文档需要连同入链修复一起声明范围。未修改正文也可显式 verified 以仅更新 meta。

人工可以先修改知识 Markdown，再执行 validate / review / commit；知识 worktree 允许 dirty，source 必须全仓 clean。知识写事务要求真实 index 与知识 HEAD 一致，任何 staged 内容（包括范围外）均返回 E_KNOWLEDGE_INDEX_DIRTY，不替用户 unstage。临时 index 从知识 HEAD 初始化，仅纳入 manifest 写集；成功发布后同步真实 index 到新提交，保留范围外工作树草稿。不执行 `git add .`。`--all` 如保留，仅选择全部复核范围，不能绕过 manifest 或当作自动语义验证。

Review Manifest 存在知识仓可重建缓存中，不提交 Git。包含 schema、随机 reviewId、repositoryId、精确绑定、sourceRevision S、knowledgeBaseRevision K0、每篇文档 ID/digest/旧新 source scope/结论、旧 validatedRequires 与候选依赖 digest，以及完整写集（含删除、晋升和关系修改）。旧证据来自 K0 的 meta，commit 不信任 manifest 自行改写旧证据；新证据由已审查候选计算。review 先准备 manifest；人或 Agent 显式确认每项语义结论后才可消费。任何编辑发生在确认之后，都必须重新 review；CLI 不因生成 manifest 自动认定语义成立。

seal 重算文档和依赖 digest、scope、写集，确认与 manifest 完全一致，并要求知识 HEAD=K0、source HEAD=S 且 clean；不一致报 `E_REVIEW_INVALIDATED`。manifest 不允许新增未审查路径；meta-only 也需绑定已复核的文档 digest。成功后标记消费；即使消费标记丢失，K0 的 CAS 也阻止重复发布。manifest 是人机共同使用的本地验证声明，不是对恶意篡改的认证机制。

结构错误建议退出码 2；状态阻断 3；事务/IO 错误 70；成功 0。JSON 错误统一含 code、message、paths 和 remediation；最终输出 schema 与 CLI 实现同步评审。

## 6. 单写者与知识提交

锁置于解析出的知识 Git common directory 下 `llmdoc.lock`，通过排他创建获取，记录随机 owner token、pid、host、起始时间、bootId 和 processStartTime；不可假定 `.git` 是目录。恢复时结合启动会话和进程创建时间避免 PID reuse 误判；平台无法可靠获取身份时保守要求显式人工处理，不仅凭 PID 或 TTL 删除锁。读不获取写锁。多 worktree 共用锁，但首版只承诺本机协作写者；远端并发合并另见 roadmap。

Agent 的受控写会话在编辑前获取锁，持有到 commit 或 abort。人工编辑与普通 Git 不遵守该锁；seal 通过 manifest 内容检查和知识分支 CAS 防止误发布。默认读固定知识 HEAD；显式读取 draft 时附 draft 标记，不把工作树中间态认作正式知识。

Seal 步骤：

1. 获取知识锁，检查精确绑定、source 有效 HEAD=S 且全仓 clean；检查目标知识分支 HEAD=manifest.K0。首版要求知识仓已有初始 commit 且处于分支上，无 merge/rebase 或未解决冲突；init 负责建立初始知识 commit。
2. 检查 manifest 已确认，重算文档、依赖 digest、旧新 scope 和四项验证证据；校验完整写集。真实 index 必须与 K0 一致；记录 index 和生成文件的观察值。
3. 创建仅本次调用使用的临时 `GIT_INDEX_FILE`，通过 `read-tree K0` 初始化。将已审查的规范化文档 blob、新 meta、导航及删除/晋升路径写入临时 index；所有未选路径沿用 K0。
4. 使用 `write-tree` 得到 tree，`commit-tree` 以 K0 为父创建 K1；写入 source revision、verified scope 和 reviewId trailer。这些命令不运行普通 commit hooks，不调用签名或其他外部辅助程序。
5. 发布前再次检查 source HEAD=S 且全仓 clean、文档内容仍匹配、知识目标分支及 HEAD 绑定未变。取得真实 index 的标准 index.lock 并复核其未漂移且仍匹配 K0，持有到 index 同步完成，防止并发 git add 被覆盖。用 `update-ref <branch> K1 K0` CAS 发布；ref 更新显式禁用 reference-transaction 等 hooks。CAS 失败只留下未引用对象，不重置任何分支。
6. 发布成功后以已构建的 K1 index 原子替换真实 index，仅同步 index，不使用会覆盖整个工作树的 reset/checkout。对 llmdoc 生成的 meta 和 README 导航，仅在文件仍等于 seal 前观察值时条件更新（不存在也是观察值），否则保留外部修改并报告未同步路径。README 保留人工区；原本有未纳入写集的 meta/导航编辑时预检拒绝覆盖。
7. 返回 K1/S 与同步结果，标记 manifest 已消费，清理临时资源并释放锁。正常无并发时已 seal 的文档、meta、导航 clean，范围外未提交草稿仍 dirty。

正式提交允许 meta-only；capture 提交不叫 seal。trailer 和 digest 是审计及一致性声明，不是语义正确性证明。发布前失败仅清理本次临时资源；发布后收尾失败必须返回已发布 K1 与 cleanup_required，不能谎称未提交或自动 reset。

首版不支持保留任意 staged 状态后推进 HEAD。只有发布后异常或外部并发才能出现未同步路径，这属于 cleanup_required，不能作为正常成功 UX。Git ref、index 和普通文件不构成跨资源原子事务：历史发布以 CAS 为提交点；收尾失败必须明确 K1 已发布，列出 index/文件同步情况，不回滚历史、不覆盖外部改动。条件文件更新尽量使用短持锁区与原子替换，不能宣称能锁住不遵守协议的任意编辑器。

capture 使用同一知识锁、index clean 门控、scoped temporary index、commit-tree、CAS 及成功后的 index/自有文件同步。capture 写集仅 inbox，不纳入任何 docs/meta 或范围外草稿，不写 verification trailer、不推进四项验证证据；它无需 source clean 或语义 Review Manifest。区别是写集及验证语义，而不是另一套普通 git add/commit 实现。

Source 只读意味着无法阻止检查之后的外部提交，但所有事实来自固定 S 的 Git 对象。发布前检测到 HEAD 漂移或 dirty 则中止；发布后 source 前进不影响对 S 的历史声明，不自动回滚知识提交，也不把验证点追改成新 HEAD。外部非协作进程在检查后的编辑不进入已构造的 tree，保留为草稿。

过期锁不能单凭 TTL 自动删除；只有同机能证明持有者退出才允许显式恢复。跨机或无法判断则报告 owner，由使用者处理。不承诺锁住普通 Git 的任意并发操作；首版不在同一知识工作树同时切换分支。

## 7. 显式迁移与兼容

迁移读取旧 V3 布局，默认复制到外置新知识根；旧源文件、ignore、Agent 配置及旧仓 Git history 保持不变。目标 Knowledge Git 默认建立新的 migration baseline，不抽取、修改或重写旧仓历史；保留历史导入能力另列 roadmap。新绑定只在目标校验完成后生效。失败可重试或删除自己创建的未发布目标，不改旧数据。

| 旧项 | 目标处理 |
|---|---|
| embedded llmdoc | 只读兼容；复制到独立 Git 后允许新协议写入 |
| nested-personal | 可显式选择兼容位置；默认仍复制外置，不能偷偷改外层 ignore |
| `.mdx` / CodeRef | 转 `.md`、普通链接或文字证据；不可无损表达的组件列入人工复核 |
| `code.paths` | 转 `source.paths`，重写关系与正文文档链接 |
| `validatedRevision` | 可保留为迁移来源说明；缺少新 digest/manifest 验证依据时revision/digest 置 null、validatedSourcePaths 置 []、validatedRequires 置 {}，经新 review 后 seal，不把转换内容自动当作已验证 |
| `llmdoc/meta.json` | `.llmdoc/meta.json`，ID 同步去旧前缀并改扩展名 |
| source 配置 / preload | 转知识配置或用户设置；不修改源码内旧文件 |

`migrate --dry-run` 给出逐文件目标、转换、碰撞和无法保留的验证证据。不因文件复制成功而把全部文档标为当前验证。嵌套兼容首先兼容独立存储方式，不等于长期提供两套可写 schema。

实现须同步 CLI 类型/schema、viewer、hooks、skills、agent prompts、示例和双语网站；新模式下 hook 无绑定只提供诊断，不能偷偷 init。不删除旧用户数据，不自动升级 npm major。
