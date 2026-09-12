# v3-ng 实施计划与 Roadmap

状态：M1–M5 已实现、通过 Codex review 并按阶段提交；下表保留交付范围与验收基线。文中的后续阶段不命名为 v4，避免与用户输入中的旧代称混淆。

## v3-ng 实施顺序

| 阶段 | 交付与主要触点 | 通过条件 |
|---|---|---|
| M1 仓库边界 | workspace/fs/git/config；bind/init；用户 registry；独立 context | 外置和嵌套可绑定；缺 Git、同 common Git、路径逃逸失败；所有操作保留 source 状态 |
| M2 内容与读取 | types/schema/markdown/search；docs `.md`、decision、source.paths、双 revision；标准 lib/commands 原位替换；viewer | 不存在 `lib/v3ng`、`ng-*` handler/schema key 或 V3 dispatch/fallback；`tree/index/show/search/context` 直接使用新双仓读取；正式检索不混入 inbox/cache；多层目录、链接、来源和有效性正确 |
| M3 语义提交 | state/commit/status/delta；Review Manifest、digest、锁、临时 index/CAS | docs + meta 单提交；人工 draft 可提交；全仓 dirty、manifest 失效、CAS 冲突不假成功 |
| M4 最小维护闭环 | capture、update/prune 编排、导航生成、显式迁移 | 候选可拒绝/晋升；普通编辑不自动验证；迁移失败不影响旧知识和 source |
| M5 接入与发布 | hooks、skills、agents、CLI 帮助、双语文档、viewer、示例 | 读取入口已在 M2 完成 breaking replacement，其余入口使用相同双仓契约；端到端 dogfood 通过后再确定版本号 |

M1–M5 已按独立提交落地；v3-ng 作为 breaking replacement 直接替换旧运行时，不保留 V3 dispatch、源码仓 fallback 或 `v3-ng` 命令前缀。

## 必须验收的行为

1. 外置知识 init/bind/search/update/commit/prune/migrate 完整流程前后，对比 source HEAD、index 字节及工作树文件；包含只读 status 不刷新 index 的场景。
2. 无知识 Git、知识目录向上命中 source Git、同仓 worktree、Windows junction/大小写、`.git` 文件、已被外层跟踪的嵌套目录均不能突破独立性检查。
3. 两个无关项目、SSH/HTTPS alias、无 remote、多个 clone/worktree、fork 和歧义 registry 不串知识仓。
4. 任意非 ignored staged/unstaged/untracked、删除、重命名或冲突都阻断正式 update/review/seal；HEAD 无效也阻断。submodule 仅比较 opaque gitlink，内部事实必须单独绑定，不递归验证。
5. 语义未变仅 meta 提交；语义改变 docs + meta 单提交；没有明确 verified 声明的正文编辑不能复用旧验证；历史缺失和非祖先不能强制标 current。
6. 两个 CLI 写者互斥；manifest 后编辑任一文档/scope/依赖使 review 失效；知识 index 有任何 staged 即拒绝；发布后同步真实 index，范围外工作树草稿保留；write-tree/commit-tree/update-ref CAS 不运行 hooks。验证 CAS 失败和发布后收尾失败，不覆盖草稿或回滚已发布提交。
7. reader 不把提交中间态当作 seal；知识 commit 对 S 的声明保持不变，即使源码随后前进；普通 Git 修改的文档须重新复核。
8. capture 可以持久化未验证候选但正式检索不召回；promote 的文档、meta、关系和候选移除原子发布；README 导航不扩大验证范围。
9. V3 迁移 dry-run 展示所有映射；扩展名碰撞、CodeRef 无损转换失败、旧 revision 无法解释时保守处理；旧仓零修改，重复执行不覆盖目标草稿。
10. CLI JSON schema、viewer 和各 Agent 接入口端到端一致；Windows 与 Linux 都运行关键集成用例。
11. v3-ng 同名主命令不得保留 V3 dispatch 或 embedded/source fallback；旧 `.mdx` 只能由显式 migrate 读取。缺绑定应返回 v3-ng 绑定错误，而不是进入旧 workspace。

测试优先真实临时双 Git 仓与故障注入，不只 mock Git 或测试字段改名。各阶段已执行对应测试；最终收口的 lint、typecheck、默认 quick、完整 integration、文档/prompt 与网站 Schema 检查证据记录在 `progress.md`。

## 后续版本

| 能力 | 为何延期 | 启动条件与预期边界 |
|---|---|---|
| Project / Personal 知识联邦 | 通用知识没有单项目 source revision，需独立有效性模型 | 单项目闭环稳定；定义 Project > Personal 排序、来源展示及冲突处理后实施 |
| AST / imports / symbol 图谱与 graph boost | 非双仓隔离的前置条件，增加语言及缓存复杂度 | 真实 recall/impact benchmark 证明收益；只写可重建 cache，键含 source identity/revision 与解析器版本 |
| 多 Agent 分支 + worktree + merge | 单写者足以支持首版同机共享；合并 meta 不能只按文本自动解决 | 出现实际写入竞争；先定义语义冲突与 source snapshot 合并协议 |
| 跨机器同步与远程锁 | 本机锁不能覆盖远端协作 | 定义 push/pull、冲突与凭据边界；不把本地锁宣传成分布式保证 |
| inbox 自动分类、过期、批量去重 | 先证明最小 capture → review → promote 有价值 | 候选积压数据足够；仍不允许未经验证自动进入 canonical docs |
| 段落级证据、复杂索引与 embedding | 文档级路径差异和词法检索先完成闭环 | 有质量和性能评测；不将可重建结构混入长期知识 |
| GUI 编辑与可视化审查 | 标准 Markdown + CLI 已满足人机共用底线 | CLI 协议稳定后复用，不能在 UI 中另建有效性规则 |

## 用户需求覆盖

| 输入议题 | 落点 |
|---|---|
| 1–2 源码只读、知识独立 | 架构 §1、§3；M1 |
| 3 无 Git 写失败 | 架构 §3；M1 |
| 4–5 双 revision、一次知识声明 | 架构 §4、§6；M2–M3 |
| 组织与纯 Markdown | 架构 §2；M2 |
| 候选和正式知识区分 | 架构 §2、§5；M4 |
| decision 与准入门槛 | 架构 §2；M2 |
| 代码变化只触发 Verify | 架构 §4–§5；M3 |
| 代码图谱 | 后续 AST 图谱；本版确立 cache-only 边界 |
| 多 Agent source binding | 架构 §3；M1 |
| 人类一等编辑 | 架构 §5–§6；M3 |
| Write Lock | 架构 §6；M3 |
| 全仓 clean source snapshot（本次评审替代关联 dirty） | 架构 §1、§4、§6；M3 |
| Project / Personal 分层 | 后续知识联邦 |
| 最终定位与八条原则 | 设计 README；贯穿所有阶段 |

原文对外部项目的比较作为需求背景，不作为本设计的已验证产品事实；方案以本地 V3 实现与用户要求为依据。

## 本次评审追加验收

- repositoryId 是显式逻辑身份；alias 唯一匹配只允许只读发现，不能进入写操作。
- digest 覆盖全文与 front matter，CRLF/LF 规范化一致；普通 Git 修改可直接检出，不扫描 seal 历史。
- DocumentStatus 只有 unverified/current/needs_review；SourceContext 阻断原因独立输出。
- supersedes 目标类型、环、重命名与检索标注正确；知识内容不能成为 Agent 的可执行指令。
- seal 正常完成后真实 index 匹配 K1，文档/meta/导航 clean，范围外草稿 dirty；重复消费 manifest 被 K0/CAS 拒绝。

## 协议冻结补充验收（D4）

- A requires B：B1 改为 B2 并重新 seal 后，A 仍 needs_review；A 重新 review 后才可 current。同批 A/B 按 DAG 顺序绑定最终 digest；拒绝 requires 环。
- 删除旧 scope 中 pkg/lease/** 后，review 仍基于 validatedSourcePaths 与新 scope 并集检查旧验证 revision 到 S，展示被移除范围；seal 四项证据一起更新。
- lastGlobalReviewRevision 仅在全局扫描完成时推进，部分验证不推进且不改变其他文档状态。
- seal/capture 遇到范围外 staged 也拒绝；并发 git add 不能被 index 同步覆盖。发布前失败不移动 HEAD，发布后同步失败报告已发布 K1 与 cleanup_required。
- capture 在存在 docs 草稿时只提交 inbox，无 verification trailer；成功同步 index，docs 草稿保持 dirty。
- meta/README 在观察后被外部修改时保留该修改并报告未同步；正常路径不能留下反向 staged 差异。
- PID 复用、系统重启及平台无法获取进程身份时，锁恢复不误删活跃锁。
- migration 建立新目标历史，旧仓历史原样不动，不执行 subtree history extraction。

## 明确延期

| 能力 | 首版处理 | 后续条件 |
|---|---|---|
| 任意 staged 内容保留 | 任意 staged 均阻断知识写事务 | 确有需求且能保持自然 Git UX 后单独设计 |
| 迁移旧知识完整历史 | 目标建立新的 migration baseline | 未来可设计 --preserve-history，不承诺首版接口 |
