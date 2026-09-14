# llmdoc 架构设计入口

本目录说明当前双仓协议的设计与实现边界。产品定位、六项设计原则和五条协议硬边界以
[项目 README](../../README.zh-CN.md) 为准；日常使用从该入口开始。

`v3-ng` 是设计阶段与分支代号，不是 CLI 运行模式。M1–M5 的实施与验收已经完成，
具体提交和验证证据见 [进度记录](progress.md)。仓库完成状态不代表 npm 已发布该实现。

## 设计要解决什么

Source Git 保存事实，Knowledge Git 保存经 Agent 验证、难以从代码低成本重建的工程理解。
知识为具体任务提供上下文；当前代码仍是实现事实的依据。

每次任务由 Agent 判断是否值得新增、修正或复核知识。源码变化只使相关知识需要复核，
不自动要求文档变化或全仓知识覆盖。人工按需审阅结论，CLI 承担确定性检查与提交保护。

## 协议如何支撑这个目标

| 责任 | 设计 |
|---|---|
| 隔离源码与个人知识 | 独立 Knowledge Git，默认外置；用户级 registry 绑定，不向 Source Git 回退写入。 |
| 让上下文可检索、可审阅 | 标准 Markdown、路径作为文档 ID、source scope 与文档关系；不持久化可重建代码百科。 |
| 说明知识的适用依据 | source revision、内容 digest、source paths 与 requires digest 四项验证证据；文档只分三态。 |
| 保证复核对象与发布内容一致 | 固定 clean source 快照、Review Manifest、单写者锁、临时 index 与 ref CAS。 |
| 支持任务中的自主维护 | Agent 直接维护正式文档，经 review、confirm、seal 发布；需要暂存时才使用 capture/inbox。 |
| 保留旧数据而切换协议 | 仅显式 migrate 读取旧 V3；复制到新知识仓，重新验证，不修改旧数据。 |

这些机制不代替 Agent 的语义判断。`validate` 检查结构，`current` 表示已有验证证据仍成立，
都不证明理解必然正确或知识覆盖完整。

## 按问题阅读

| 需要了解 | 文档 |
|---|---|
| 产品原则、安装和日常使用 | [项目 README](../../README.zh-CN.md) |
| 目录、绑定、有效性、复核、提交和失败语义 | [架构与协议](architecture.md) |
| 已实现范围、验收标准与延期能力 | [实施范围与 roadmap](roadmap.md) |
| 实际完成情况、测试证据与历史决策 | [实施进度](progress.md) |
| Agent 如何调用能力并维护知识 | [Agent 接入说明](../agent-integration.md) |
| 为什么替换旧模型 | [历史 V3 设计](../v3-design/README.md) |

## 兼容与演进边界

标准 CLI、hooks、skills、viewer 直接使用本协议，不保留旧 V3 dispatch 或源码写入 fallback，
也不建立 `ng-*` 命令或平行运行时。schema 可以独立版本化，但不用于回退旧协议。

旧 `.mdx`、`code.paths` 和旧 meta 只作为显式迁移输入。迁移前使用相应旧版本工具；
迁移建立新知识仓，不抽取旧历史，也不把转换结果自动标为已验证。

嵌套独立 Git 必须显式选择，外层不能跟踪知识子树，且仍需满足全仓 clean 门控。
llmdoc 不修改外层 ignore；要求源码目录字节级不变时使用外置模式。

后续变更先明确用户问题，再更新受影响的设计契约并实现。持续在进度记录中注明实际验证、
剩余事项和下一步，不把未执行的测试或未发布版本写成已经完成。
