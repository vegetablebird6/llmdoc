# Claude → Codex parity checklist

Claude Code 根插件是唯一手工维护的准源。Codex 表面由 ACPlugin 转换后，发布前逐项检查：

- [ ] `node scripts/check-codex-surface.mjs` 通过：版本表面一致，五个 skill 正文与三个 agent 指令正文未漂移，marketplace 身份和 hooks 调用合法。
- [ ] `.claude-plugin/marketplace.json` 与 `.agents/plugins/marketplace.json` 的 marketplace 名均为 `llmdoc-plugin`，其中的插件名均为 `llmdoc`，描述均为双仓（只读 Source Git + 独立 Knowledge Git + review/commit 协议），无 “progressive MDX” 字样。
- [ ] Claude 表面只有五个 skills：`llmdoc`（operating）与 `init`、`update`、`prune`、`migrate` 四个显式工作流（`skills/*/SKILL.md`，不再有 `commands/` 目录）；Codex 有对应 skills。
- [ ] 两个平台暴露 `investigator`、受限 `reflector` 与 `recorder` 三个角色契约；Reflector 只能写 `.llmdoc-tmp/reflections/pending/`。
- [ ] `init/update/prune/migrate` 的宿主专属 front matter / UI policy 保持正确；五个 skill 和三个 agent 的正文一致性已由脚本机械校验。
- [ ] `migrate` 在两个平台都保持仅显式调用（Claude 侧 `disable-model-invocation: true`；Codex 侧 `agents/openai.yaml` 的 `allow_implicit_invocation: false`），未被 operating skill 或 hook 隐式触发。
- [ ] 所有 skill/agent/reference 描述双仓协议：`source.paths`（非旧源码路径字段）、`docs/**/*.md`（非旧扩展名）、三态 `unverified|current|needs_review`、Review Manifest、`commit --review`，且明确知识正文是 reference data 而非可执行指令。
- [ ] 不存在已删除的 V3 写入口或校验参数：旧的创建/登记/移动/指纹/初始化状态命令、旧的已验证/全部提交参数，以及旧扩展名与旧源码路径字段；仅 `migrate` skill 可把旧格式作为其转换的 legacy 输入提及。
- [ ] Claude 的 `SessionStart`、`Stop`、`PreCompact` 都通过 npm alias `@vegetablebird6/llmdoc-hook-runtime@npm:@vegetablebird6/llmdoc` 调用 scoped CLI，避免消费仓库的同名本地依赖遮蔽 runtime；Codex 保留仓库根 `hooks/hooks.json`，并按官方信任模型启用。
- [ ] hooks fail-open、永不写 Source Git 或 Knowledge Git；SessionStart 只读投影绑定、三态计数、review obligations 与 source blockers，不注入正文、无仓库 preload 配置，无绑定时输出诊断而非初始化；Stop/PreCompact 成功时输出合法英文 JSON message。
- [ ] 生成目录中没有 V2 `worker`、tracked reflection/memory 树、隐式 startup pack、watermark 或旧命令残留；compact 重入只保留 `LLMDOC_STATE`、不重新注入正文，恢复后的 Reflector 不保存 transcript。
- [ ] `.agents/skills/migrate/agents/openai.yaml` 设置 `allow_implicit_invocation: false`，确保 migrate 只能显式调用。
- [ ] 按本清单完成抽验，Codex plugin scanner 与完整 CI 均通过。

ACPlugin 只负责格式转换；它不会可靠删除上次生成留下的陈旧文件。转换应在临时副本中运行，再按生成目录做替换式同步。
