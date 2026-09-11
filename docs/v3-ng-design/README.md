# llmdoc v3-ng 设计

状态：协议主线冻结，P0/P1 评审已落地，作为实现基线；本目录定义目标契约，不代表功能已经实现。用户需求文本中的 v4 均指 v3-ng；后续版本统一写入 [roadmap](roadmap.md)，不预先承诺版本号。

## 定位与范围

**Detached Engineering Knowledge Base：独立于源码生命周期，由人和 Agent 共同维护的持久工程知识库。**

> Source Git commits define facts; Knowledge Git commits preserve verified understanding of those facts.

llmdoc 保存难以从代码低成本重建、会影响未来决策且跨多个 commit 成立的工程理解。它不是 Code Wiki Generator。代码变化只产生复核义务；复核可能只更新验证依据，不修改正文。

本次交付为设计，运行时代码、发布版本及现有 V3 用户行为不随文档自动改变。

## 八条硬边界

1. 知识工作流对 Source Repository 只读：不得修改其文件、index、history 或配置。Coding Agent 的源码开发是另一条工作流。
2. Knowledge Repository 必须是独立 Git，默认外置；嵌套独立 Git 仅兼容已有用户。
3. 持久知识写入不得向上回退到 Source Git。未绑定或非独立 Git 时明确失败；只读检索可以读取显式指定的无 Git 知识目录。
4. 只认有效 HEAD 且全仓 worktree/index clean 的 Source commit；Source Revision 是验证依据，Knowledge Revision 是知识 Git commit。
5. Review Manifest 绑定 source revision、内容 digest 和 scope；正文、关系、meta 用临时 index 与 CAS 一次发布，要求知识 index 无 staged 内容，成功后同步 index 与自有生成文件。meta 不存 knowledge commit。
6. 语义验证由人或 Agent 负责，CLI 执行确定性的结构、范围及提交检查。`validate` 成功不证明知识正确。
7. AST、符号和依赖图是可重建索引，不生成可提交的代码百科。
8. 人和 Agent 都能编辑标准 Markdown，并经过相同的验证声明及提交协议；知识是 reference data，不是可执行 rules/skills。

“唯一写入边界”指知识内容及其 Git；`bind` 允许写用户级 registry，临时文件和缓存写知识目录或用户级缓存。它们都是明确例外，仍不能写入源码仓。嵌套兼容仅允许写独立知识子树；不得改外层 Git、ignore 或其他源码文件。若要求源码目录字节级完全不变，必须使用外置模式。

嵌套兼容也不豁免 source 全仓 clean：若外层将知识目录显示为 untracked，则阻断正式复核。只有用户事先配置的忽略规则使其不进入外层 Git 状态时才可使用；llmdoc 不代改外层规则。

## 本轮纳入

| 能力 | v3-ng 决策 |
|---|---|
| 双仓库与绑定 | 外置默认；用户级 registry；独立 Git 硬检查；嵌套兼容 |
| 知识模型 | `.md`；architecture / decision / guide / reference；保留路径作为 ID |
| 有效性 | revision/digest/source paths/requires 四项验证证据；全仓 clean 门控；文档仅三态 |
| 人工维护 | 直接编辑、显式验证声明、单次知识提交 |
| 多 Agent | 共享 CLI 协议与单写者锁；读不加写锁 |
| 候选知识 | 最小 inbox / capture / review-promote；默认检索排除候选 |
| 导航 | 标准 Markdown README，可重建，不作为知识节点或验证对象 |
| 迁移 | 显式复制迁移、dry-run、旧格式只读诊断，禁止隐式原地升级 |

## 与当前 V3 的衔接

核对基准：2026-09-09，本地 `main` HEAD `ae0695dbf4fc4084e0078be3edf6a7772e059722` 加已有未提交修改；随后创建 `v3-ng`。这是工作树观察，不是对已发布 npm 包的断言。

| 当前工作树证据 | v3-ng 变化 |
|---|---|
| [workspace.ts](../../cli/src/lib/workspace.ts) 已有 sourceGitRoot / projectionGitRoot / nested-personal，但无嵌套时回退 source Git | 显式 SourceContext / KnowledgeContext，移除写入 fallback |
| 同文件仍从 `root/llmdoc` 扫描 `.mdx`，限制两层，使用 `code.paths` | 外置根、`docs/**/*.md`、`source.paths`；允许多层目录，不要求 topic 入口 |
| [commit.ts](../../cli/src/commands/commit.ts) 的 nested 分支已有单次 docs + meta 提交及 source HEAD 检查 | 复用分离方向；统一独立 Git 事务、显式验证范围和锁 |
| embedded 分支仍提交正文后追加 meta commit | v3-ng 不提供 embedded 持久写入；迁移后才可写 |
| [V3 设计](../v3-design/README.md) 使用三个 kind、MDX、动态导航 | 新增 decision、纯 Markdown、人类导航；历史 V3 设计保留 |

不能把这些已有演进归功于本次设计，也不能据此认定实现已经满足全部新契约。

## 阅读顺序

1. [架构与协议](architecture.md)：目录、绑定、schema、命令、有效性、事务、迁移。
2. [实施与 roadmap](roadmap.md)：阶段、验收、延期内容及需求覆盖。
3. [实施进度与续接记录](progress.md)：每步完成情况、验证证据和下一步；中断后先读此文件。

实施约定：先将设计落地并完成评审，再写运行时代码。每完成一个实施步骤，立即更新进度记录与受影响的设计契约；遇到方案调整先改设计再继续实现。不能只在聊天中记录完成情况。

评审收敛：最小 inbox、decision/supersedes、全仓 clean snapshot、临时 Review Manifest、digest、临时 index/CAS、opaque submodule、显式逻辑身份绑定均纳入基线。旧 embedded 只读并复制迁移；不再实现 dirty scope 或 live worktree 验证。

冻结补充：requires 禁环并绑定目标 digest；review 使用旧新 scope 并集；capture 复用 scoped 写事务；全局扫描点命名为 lastGlobalReviewRevision。首版不支持任意 staged 状态保留，迁移不抽取旧仓历史。
