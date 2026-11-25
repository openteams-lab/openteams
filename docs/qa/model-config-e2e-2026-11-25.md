---
title: "新模型配置端到端验收：2026-11-25"
description: "Codex、Claude Code、Kimi 的真实模型发现、配置持久化、首轮执行和重启续聊结果。"
---

## 验收结论

**后端可执行用例通过；完整产品验收仍有阻塞。** 三个 Codex 新模型及 Kimi K3.1 Pro、HighSpeed 均完成真实首轮和服务重启后的续聊，共 10 次成功回复。Claude 两个 Fable 选择项实际发起请求后均被当前接入服务以订阅错误拒绝。浏览器控制服务不可用，页面交互未验收。

本轮发现并修复 Codex 固定 CLI 版本过旧的问题：同账号下，应用原先固定的 `0.153.4` 仅返回 4 个模型；升级至 `0.167.0` 后返回 10 个，包含三个目标新模型。仅增加模型预设不足以解决此问题。

## 环境与范围

- 基础提交：`53c11c052b49f79f606660b12cc4268561bd519c`，加本轮 Codex 版本和独立数据目录修改。
- 平台：macOS arm64；从当前源码构建 `target/debug/server`。
- CLI：Codex `0.167.0`、Claude Code `2.1.321`、Kimi `2.5.2`。
- 后端 `127.0.0.1:24080`，Vite `localhost:24081`；使用独立测试项目、成员、会话和 Git 工作区。
- `OPENTEAMS_ASSET_DIR` 指向测试数据目录，数据库和运行时配置与日常实例分离。使用本机 CLI 已有账号，未复制凭据。
- 所有真实成功用例使用 `low`；其他推理强度依靠能力列表及既有单元测试覆盖，未逐一进行付费推理。
- CLI 全列表均比较；实际对话覆盖本次重点新增模型，未遍历所有历史模型。

本地完整证据位于 `.openteams/qa/model-config-20261125/receipt.json`。原始运行日志位于该目录的 `workspace/.openteams/runs/`，保持为忽略的运行时数据。

## 模型发现与保存

| 用例 | 实测结果 | 状态 |
| --- | --- | --- |
| Codex CLI 与 HTTP 列表对齐 | 10 个，直接 CLI 按每页 2 个遍历 5 页；与刷新接口一致 | 通过 |
| Claude CLI 与 HTTP 列表对齐 | `default`、`fable`、`haiku`、`opus`、`sonnet`，共 5 个 | 通过 |
| Kimi CLI 与 HTTP 列表对齐 | 6 个；`kimi-code/k3.1-pro` 与 `kimi-code/k3.1-pro-highspeed` 独立保留 | 通过 |
| 新增模型可见性 | Codex 升级后刷新返回新增模型；`model_source=runner`，目标三个运行时无刷新错误 | 通过 |
| 项目成员配置保存 | 8 个测试成员的运行时、模型、推理强度和空 MCP 配置均正确复制到会话成员 | 通过 |
| 服务重启持久化 | 成员配置、会话配置、上游会话指针和模型列表与重启前一致 | 通过 |
| 发现失败保留缓存 | 对 Codex 发现进程注入退出失败；模型 ID 和逐模型能力完整保留，接口返回错误 | 通过 |

失败注入通过一个透明启动脚本转发真实 Codex CLI，成功发现后，仅切换脚本的失败标记，保持运行时配置不变。此检查不伪造模型返回值。完成后恢复原运行时选项，并再次刷新真实列表。

## 真实执行与续聊

每次通过正常 `POST /api/chat/sessions/{id}/messages` 发送唯一回执标记，再读取会话消息和运行日志核对。模型生成的自述不作为模型选择证据。

| 选择项 | 首轮 | 重启后续聊 | 运行时证据 |
| --- | --- | --- | --- |
| `gpt-6.2-astra` | 通过 | 通过 | app-server 回复 `model=gpt-6.2-astra`、`reasoningEffort=low` |
| `gpt-6.2-sol` | 通过 | 通过 | app-server 回复 `model=gpt-6.2-sol`、`reasoningEffort=low` |
| `gpt-6.1-terra` | 通过 | 通过 | app-server 回复 `model=gpt-6.1-terra`、`reasoningEffort=low` |
| `kimi-code/k3.1-pro` | 通过 | 通过 | ACP `ConfigOptions` 返回对应模型 ID 和 `thinking=low` |
| `kimi-code/k3.1-pro-highspeed` | 通过 | 通过 | ACP `ConfigOptions` 返回对应模型 ID 和 `thinking=low` |
| `fable` | 阻塞 | 未执行 | Claude 初始化解析为 `claude-fable-5-2`；请求返回 HTTP 400 订阅错误 |
| `claude-fable-5-2` | 阻塞 | 未执行 | Claude 初始化使用精确模型 ID；请求返回相同订阅错误 |
| `gpt-6-luna` + `ultra` | 按预期拒绝 | 不适用 | 执行前返回不支持该推理强度，列出 `low, medium, high, xhigh, max` |

Codex 续聊使用现有的 fork/resume 路径，运行时线程 ID 会改变；app-server 返回的续聊线程包含首轮历史，`prior_turns=1`。Kimi 两个用例均复用各自原有的上游会话 ID。

### 可追溯运行记录

| 用例 | 首轮 run_id | 续聊 run_id |
| --- | --- | --- |
| Codex Astra | `c67070aa-a8ab-4406-a66a-eb5e2833f58f` | `c8061f3e-3a22-44b5-9fe2-51d29863e53f` |
| Codex Sol | `e0ee8471-84d7-412d-a74f-bcece8e701c3` | `d1e0e9b6-2651-41d9-985a-c0395910ff4d` |
| Codex Terra | `19ba0dfc-a7eb-4eca-afc4-2615d143c3c9` | `8dd68e90-87af-4677-80aa-26b1546ff526` |
| Kimi Pro | `b9c9b3fe-d9e6-4662-994d-14c173c799f8` | `b634699e-6039-4a83-926c-4ba6b1a98846` |
| Kimi HighSpeed | `3d3b3817-3a91-4304-a038-71337b12b9f6` | `5a112ee4-81d9-41ae-8e6c-1d150466c7ef` |
| Claude Fable | `6ab51bd0-5ecf-4a06-93f2-a7100abbf033` | — |
| Claude Fable 精确 ID | `740c2440-1e5f-4512-afaf-b02cea9af6c6` | — |
| 非法推理参数 | `f5e648f9-5748-40e5-a6a5-3465608ffd7e` | — |

## 尚待验收的条件

1. **Claude 账号**：当前 Claude 接入火山引擎 CodingPlan，实际返回订阅无效或过期的 HTTP 400。恢复可用订阅，或配置具备目标模型权限的账号后，重跑两个 Fable 首轮及续聊用例。本次已验证别名解析与请求发起，尚未验证成功推理。
2. **浏览器连接**：创建测试页面及查询浏览器清单均返回 `The browser access host is unavailable`，可用浏览器列表为空。因此下拉框操作、页面刷新、错误提示和视觉呈现均未标记通过。
3. **前端能力消费**：静态核查显示 `frontend/src/pages/TeamPage.tsx` 的模型列表读取 `discovered_models`，推理选项读取成员级 `reasoning_capability`；当前前端未消费新增的 `model_details`。逐模型推理选项联动仍需完成页面侧验证与接入。

## 复现步骤

需已安装 Rust、Node/npx、Python 3.9+、Git 和 Kimi，且三个 CLI 账号可用。`turn` 会产生真实模型请求与相应账号用量。此脚本的阶段需顺序执行；重跑整套验收时选择新的报告目录。

```bash
cargo build -p server --bin server --offline -j 1
# 首次安装 CLI 可能超过发现接口的 30 秒超时，先完成包安装。
npx -y @openai/codex@0.167.0 --version
npx -y @anthropic-ai/claude-code@2.1.321 --version

qa() {
  python3 scripts/verify-model-config-e2e.py "$@" \
    --report-dir .openteams/qa/model-config-next
}
qa prepare
qa start
qa discover
qa baseline
qa create
qa turn
qa restart
qa verify
qa turn --resume
qa failure-cache
qa audit
qa stop
```

`audit` 对所有首轮和续聊证据进行分类：通过退出 `0`，外部账号阻塞退出 `2`，缺失或失败用例退出 `1`。本轮预期退出 `2`，对应两个 Claude 用例；执行后仍应运行 `stop` 关闭测试服务。

浏览器恢复可用后，可启动 `FRONTEND_PORT=24081 BACKEND_PORT=24080 pnpm run frontend:dev`，对上述测试项目进行页面验收。

## 本轮回归检查

- `cargo build -p server --bin server --offline -j 1`：通过。
- `cargo test -p executors --lib codex --offline -j 1`：41 项通过。
- `cargo fmt --all -- --check`、`git diff --check`：通过。
- 验收脚本 Python 语法及命令行帮助检查：通过。

本轮未修改前端代码或 Rust 对外类型，因此未重复生成共享类型。前一轮的 145 项后端测试和前端类型检查结果不计入本轮端到端通过数。
