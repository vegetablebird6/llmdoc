# llmdoc

[官网](https://llmdoc.tokenroll.ai/) · [English](README.md)

**Detached Engineering Knowledge Base（独立工程知识库）。** llmdoc 保存难以从代码
低成本重建的工程理解，让 Agent 在任务中获得有用上下文，不必每次重新推导相同的设计决策。

Source Git 的 commit 定义事实；Knowledge Git 的 commit 保存对这些事实经过验证的理解。
Agent 负责维护知识，人按需审阅结论，并将纠正反馈给 Agent。

## 在任务中如何发挥作用

| 职责 | 承担者 |
|---|---|
| 当前实现的事实 | Source Git；知识与代码冲突时，以代码为准。 |
| 决策、理由、约束与跨模块契约 | 独立 Knowledge Git 中的标准 Markdown。 |
| 哪些理解值得保存、是否仍然成立 | 正在处理任务的 Agent。 |
| 检索、结构检查与受保护的发布 | llmdoc CLI。 |

每次任务中，Agent 检索相关上下文、检查代码，并自主判断是否获得了值得保存的长期知识。
一次任务可以不写任何知识，新增源码也不自动要求新增文档。相关源码变化触发已有知识的
语义复核，不自动生成知识变更日志。

一个源码 worktree 通过用户级 registry 绑定到一个独立知识 worktree，默认外置存放。
个人知识提交与业务代码协作分开管理。

[设计原则](#设计原则) · [硬边界](#八条硬边界) · [安装](#安装) ·
[日常使用](#日常使用) · [详细参考](#详细参考)

## 设计原则

1. **事实与理解分离。** Source commit 是可追溯的事实基线；Knowledge commit 保存
   Agent 针对该事实基线形成并验证过的工程理解。源码回答“系统现在是什么”，llmdoc
   回答“为什么这样设计、哪些约束必须成立，以及未来修改时需要知道什么”。
2. **只有一个持久写入边界。** Source Git 对 llmdoc 始终只读；llmdoc 不得修改、
   stage 或 commit 业务仓。所有持久知识及其元数据只在独立的 Knowledge Git 中保存和
   演进，且不得在 Knowledge Git 缺失时退回 Source Git。
3. **只沉淀长期工程知识。** 只有同时具备未来决策价值、较高重建成本和跨多个 source
   commit 稳定性的知识才进入正式知识库，包括架构意图、设计决策、约束、不变量、失败
   语义和跨模块契约。文件结构、符号关系、调用图等可从源码重新生成的信息属于索引或
   缓存，而不是持久知识。
4. **源码变化只产生复核义务。** 代码变化意味着相关知识需要重新验证，而不意味着文档
   必须变化。语义复核可以得到三种结果：正文需要更新、正文不变但刷新验证基线，或确认
   变化与该知识无关。llmdoc 不根据代码 diff 自动生成知识变更日志。
5. **知识有效性必须可验证。** 每份正式知识都应声明其 source scope、validated
   source revision 和必要的内容完整性信息，使 llmdoc 能明确区分 `current`、
   `needs_review`、`unverified` 三种状态。检索结果应同时返回知识内容和验证依据，
   而不是仅依赖文档更新时间判断可信度。
6. **Agent 维护知识，人负责审阅结论。** 知识的发现、整理、修改、验证和 seal 由
   Agent 驱动。人可以审阅 Agent 生成的结论并提出纠正、补充或质疑；这些反馈重新进入
   Agent 的知识更新流程，由 llmdoc 完成正式知识的修改和重新验证。人工审阅是可选的质量
   控制环节，而不是日常知识维护的前置条件。
7. **知识与执行指令分离。** llmdoc 保存的是可阅读、可检索、可引用和可审计的
   reference knowledge，不承担 rule、skill、prompt、hook 或其他执行指令的分发职责。
   知识内容不得依赖隐藏指令或运行时行为才能成立。

## 八条硬边界

1. **源码只读。** 知识工作流绝不修改源码仓库的文件、index、history 或配置。源码
   开发是另一条工作流。
2. **独立 Knowledge Git。** Knowledge Repository 必须是自己的 Git 仓库。默认外置；
   嵌套独立 Git 仅在显式选择时支持。
3. **禁止向上回退。** 持久知识写入绝不回退到 Source Git。没有绑定或没有独立 Git
   时 CLI 明确失败。只读检索可以读取显式指定的无 Git 知识目录。
4. **有效且 clean 的已提交 source 快照。** 只有 HEAD 有效且 worktree/index 全仓
   clean 的 source commit 才算数。Source revision 是验证依据，Knowledge revision
   是 Knowledge Git commit。
5. **Review Manifest 搭配临时 index 与 CAS。** Review Manifest 绑定 source
   revision、内容 digest 与 scope。正文、关系与 meta 通过临时 index 和 ref 的
   compare-and-swap 一次发布；知识 index 不得有任何 staged 内容，成功后与
   llmdoc 自有生成文件一起同步。
6. **Agent 负责语义维护。** 正式知识由 Agent 修改、验证和 seal；人审阅结论并把纠正
   反馈给 Agent 流程。CLI 执行确定性的结构、范围与提交检查，`validate` 通过并不证明
   知识正确。
7. **可重建索引。** AST、符号与依赖图是可重建索引，不是可提交的代码百科。
8. **使用可审阅的标准 Markdown。** Agent 通过受保护的验证与提交协议维护正式知识；
   人审阅同一份纯 Markdown，并把纠正反馈给 Agent 流程。知识是 reference data，
   不是可执行 rules/skills。

“唯一写入边界”指知识内容及其 Git。`bind` 可以写用户级 registry，临时文件和缓存
写在知识目录或用户级缓存下。这些都是明确例外，且都不能写入源码仓库。嵌套模式只写
独立知识子树，绝不改动外层 Git、ignore 规则或其他源码文件。若要求源码目录字节级
完全不变，请使用外置模式。

## 安装

### Claude Code

添加 marketplace 并安装插件：

```text
/plugin marketplace add TokenRollAI/llmdoc
/plugin install llmdoc@llmdoc-plugin
```

如果安装摘要提示 `Run /reload-plugins to activate.`，请运行该命令；如果 reload
警告需要重新读取对话，请改用 `/reload-plugins --force`。插件生效后，用
`/llmdoc:init` 初始化仓库。

### Codex

添加 marketplace，然后从仓库目录启动 Codex：

```bash
codex plugin marketplace add TokenRollAI/llmdoc
codex
```

在 Codex 中运行 `/plugins`，打开 `llmdoc-plugin` marketplace 并安装 `llmdoc`。
启用前先审查插件及其 hooks，然后在新会话中要求使用 `llmdoc:init` skill。

### 直接使用 CLI

不需要插件。在目标仓库中查看外部 CLI 帮助：

```bash
npx -y @tokenroll/llmdoc --help
```

`@tokenroll/llmdoc` 是项目外部工具。不要把它加入消费项目的 `package.json` 或
lockfile，也不要使用会解析到无关第三方包的裸命令 `npx llmdoc`。需要可复现运行时，
请在包名中固定版本：`npx -y @tokenroll/llmdoc@<version> <command>`。

## 日常使用

### 首次建立知识库

安装插件后，让 Agent 使用 `llmdoc:init` skill，并指定外置知识目录。该工作流负责
了解项目、建立绑定并形成首批有价值的知识。

CLI 提供其中的建仓步骤，本身不会编写工程理解：

```bash
npx -y @tokenroll/llmdoc init --source ./app --knowledge ../app-knowledge
# 或绑定已有的独立知识仓
npx -y @tokenroll/llmdoc bind --source ./app --knowledge ../app-knowledge
```

`init` 不覆盖非空目标。只有外层 Git 未跟踪知识子树时才显式选择 `--nested`；
正式复核仍要求源码 worktree clean。

### 按任务检索上下文

根据问题选一个入口，它们是备选关系，不是必做清单：

| 需要 | 接在 `npx -y @tokenroll/llmdoc` 后的命令 |
|---|---|
| 了解知识地图 | `tree` |
| 查找概念 | `search "重试策略"` |
| 找到源码变化对应的知识 | `context --files src/api/client.ts` |
| 浏览主题元数据，不读正文 | `index --topic lifecycle` |
| 阅读选中文档 | `show lifecycle/task-recovery.md` |

Agent 将检索结果作为上下文，到代码中核对当前事实。维护知识时可用 `status`、
`delta` 了解复核义务，它们不是检索前的固定步骤。

### 沉淀有价值的理解

Agent 在每次任务中自主判断是否需要新增、纠正或重新验证知识，优先合并到已有的对应文档。
日常知识维护不以人工批准为前置条件。

对于依据充分的理解，Agent 直接维护 Knowledge Git 中的正式 Markdown，再通过复核协议发布：

```bash
npx -y @tokenroll/llmdoc validate
npx -y @tokenroll/llmdoc review
npx -y @tokenroll/llmdoc review --confirm <reviewId>
npx -y @tokenroll/llmdoc commit --review <reviewId>
```

确认前由 Agent 完成语义复核，结论为 `changed`、`unchanged` 或 `insufficient`；
可用 `--set <id>=<conclusion>` 覆盖建议。正文不变时可以只刷新验证基线；证据不足时不推进
验证。确认后的编辑需要重新 review。

正式复核与 seal 要求有效且全仓 clean 的源码快照，以及没有 staged 内容的知识 index。
验证台账由 CLI 写入，不手工编辑 `.llmdoc/meta.json`。

**需要延后处理时才 capture。** 如果发现值得保留的线索，但暂时无法完成正式维护，例如
源码尚未提交，Agent 可以用 `capture` 将未验证候选保存到 `inbox/`，以后合并到已有
文档，或通过 `update` 晋升。候选不进入正式检索，capture 不是每次知识编辑的必经步骤。

## 知识布局

```text
knowledge/
├── .git/
├── llmdoc.yaml            # 共享身份与布局版本
├── README.md              # 机器生成的导航区
├── docs/
│   ├── architecture.md
│   └── lifecycle/task-recovery.md
├── inbox/                 # 未验证候选
├── .llmdoc/meta.json      # 每篇文档的验证证据
└── .llmdoc-cache/         # 可重建，由知识仓 .gitignore 排除
```

文档 ID 是相对 docs 的 POSIX `.md` 路径，`docs/` 可以任意层级嵌套。`README.md`
的导航区由标题、description 和路径生成，永远不是知识节点，也不是验证对象。

## 文档格式与源码证据

每篇正式文档都必须声明非空的 `source.paths`（相对 source 根的 glob）。绝对路径与
`..` 会被拒绝，每个具体路径都必须在指定 snapshot 中存在。

```yaml
---
kind: decision
description: 任务恢复为什么联合 lease 与 timeout 判断 owner 失效。
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

`kind` 为 `architecture`、`decision`、`guide` 或 `reference`。`relations` 支持
`requires`、`related` 与 `supersedes`。`supersedes` 从新决策指向它替代的旧决策，不
改变任一文档的验证状态。`requires` 构成无环依赖图：上游文档变化并重新 seal 后，其
依赖方会变为 `needs_review`，直到针对新 digest 重新验证。

## 如何理解有效性

检索结果同时返回作为事实快照的 source revision，以及保存文档的 Knowledge Git revision。
每篇文档只有一种状态：

| 状态 | 含义 |
|---|---|
| `unverified` | 尚未记录验证证据。 |
| `current` | 正文与范围匹配验证记录，源码历史可用且兼容、没有相关变化，所依赖知识仍为 current 且 digest 匹配。 |
| `needs_review` | 正文、相关源码、依赖或可用证据已不能支持之前的验证结论。 |

`current` 描述文档已有的验证依据，不证明知识覆盖全部代码，也不保证 Agent 的理解绝对
正确。语义判断仍由 Agent 负责。

`source_dirty`、`invalid_head`、`history_unavailable`、`diverged` 等源码条件单独
报告。未提交源码不进入已验证快照；正式复核受阻时，仍可检索已有知识。

台账保存四项证据：`validatedSourceRevision`、`validatedContentDigest`、
`validatedSourcePaths`、`validatedRequires`。`lastGlobalReviewRevision` 记录显式
全局复核的基线，不代表每篇文档都有效。完整 schema、依赖规则与发布保证见
[架构与协议](docs/v3-ng-design/architecture.md)。

## 按需操作

| 场景 | 入口 |
|---|---|
| 暂存尚未验证的发现 | `capture --title "lease vs timeout" --from notes.md`；使用返回的候选 ID。 |
| 处理候选 | `update --promote <candidateId> --to <newDocId> --kind decision --description "..." --source-path "internal/task/**"`，或 `update --reject <candidateId>`；之后复核、确认并 seal。 |
| 收敛冗余知识 | 先 `prune --report`，由 Agent 判断是否值得删除，再 `prune --remove <id>` 并发布。 |
| 读取旧 V3 知识 | 显式执行 `migrate --dry-run --knowledge <newRoot>`，用户要求迁移时再对同一目标执行 `migrate`。 |
| 浏览已提交知识 | `serve` 在 `127.0.0.1` 启动只读 viewer。 |
| 接入生命周期诊断 | `hook session-start`、`hook stop` 或 `hook compact`；只读且 fail-open。 |

候选 ID 相对 `inbox/`，晋升创建新文档，不覆盖已有文档。`update` 只准备变化，本身不
证明知识已验证。Hook 提供诊断，不承担知识维护或创建绑定。

旧 V3 布局只通过显式迁移读取。迁移复制到新的独立 Knowledge Git，不改动旧仓库，也不
导入旧历史；转换后的文档仍需经新协议验证。

精确参数以 `npx -y @tokenroll/llmdoc --help` 或 `help <command>` 为准。检索支持
`--json`、`--budget`、`--limit`、`--cursor`。其他 Agent 可使用
[通用接入说明](docs/agent-integration.md)。CLI 界面、诊断和 viewer 使用英文，支持中文
查询和知识正文。

## 开发本仓库

仓库根目录是私有开发工作区；面向消费方的公开产物是 `@tokenroll/llmdoc` CLI。

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

`npm test` 是日常快速门禁，覆盖协议契约、宿主 surface、选定读取路径和一次真实的
review/seal 冒烟事务。`npm run test:integration` 执行完整双 Git、CAS、锁、迁移、
回滚与故障注入套件；CI 只在 Node 22 完整执行一次，同时在受支持 Node 矩阵运行快速门禁。

请从仓库根目录安装依赖，确保本地 `llmdoc` bin 在校验前已建立链接。CLI 语义变化
必须与两端宿主 surface、双语 README、设计文档和 dogfood knowledge 保持同步。

## 详细参考

- [通用 Agent 接入说明](docs/agent-integration.md)
- [架构与协议](docs/v3-ng-design/architecture.md)
- [Agent 工作规范](skills/llmdoc/SKILL.md)
- 工作流约定：[`init`](skills/init/SKILL.md)、
  [`update`](skills/update/SKILL.md)、[`prune`](skills/prune/SKILL.md) 和
  [`migrate`](skills/migrate/SKILL.md)
- CLI 参考：`npx -y @tokenroll/llmdoc --help`
