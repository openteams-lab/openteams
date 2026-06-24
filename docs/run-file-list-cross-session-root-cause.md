# Run 文件列表混入其他 Session 文件的根因与修复方案

## 结论

这个问题不应在前端靠过滤兜底。run 结束后的消息底部文件列表必须由后端按
`run_id + session_id` 生成；前端只负责渲染和根据 `has_diff` 决定打开 diff
还是文件资源管理器。

当前最需要修复的根因在 artifact fallback 链路：为了让 `.openteams/**` 这类
gitignored artifact 进入 run 文件列表，后端会从 protocol `work_records.jsonl`
补充 artifact 路径。但这条补充链路必须同时校验 `session_id` 和 `run_id`。
如果只依赖 run 文件路径、前端缓存，或只按 `run_id` 过滤，一旦 protocol 文件被
同步、迁移或历史数据污染，就可能把其他 session 的 artifact 路径补进当前 run
的文件列表。

## 当前链路

1. Agent run 结束时写入 run-scoped diff/meta。
2. protocol 输出稍后写入 `work_records.jsonl`，其中 artifact 记录带有
   `session_id`、`run_id`、`session_agent_id`、`agent_id`、`message_type`。
3. `GET /api/chat/runs/{run_id}/files` 读取 run diff/meta，并补充同 run 的
   artifact paths。
4. 前端 `AgentMessageContent` 按 run 拉取文件列表，并把结构化消息里直接出现的
   artifact 路径作为 supplementary rows 合并。

## 触发混入的高风险点

1. 后端 artifact fallback 没有强制校验 `session_id`。
   - `work_records.jsonl` 的记录本身包含 `session_id`，但读取结构如果忽略它，
     就少了一层隔离校验。
   - 即使当前路径按 session 存放，也应该用记录内的 `session_id` 做防御式过滤。

2. 前端 run 文件缓存只按 `runId` 缓存。
   - UUID 正常情况下全局唯一，但缓存 key 缺少 `sessionId` 不利于防御旧数据、
     mock 数据、测试数据或异常复用。
   - 应改成 `${sessionId}:${runId}`，并在请求返回时确认仍匹配当前 message。

3. 前端会合并 `message.artifacts`。
   - 这部分必须只来自当前 message 的结构化 reply。
   - 如果 placeholder 替换逻辑把其他 session/message 的 artifacts 携带过来，
     会在前端合并阶段混入。

## 修复方案

### 后端

1. `WorkRecordJsonLine` 增加并解析 `session_id` 字段。
2. `load_run_artifact_work_record_paths` 同时过滤：
   - `record.session_id == run.session_id`
   - `record.run_id == run.id`
   - `record.message_type == "artifact"`
3. 增加测试：构造两个 session、两个 run、同一个 workspace，protocol 文件中放入
   当前 session 与其他 session 的 artifact 记录，断言当前 run files 只返回当前
   session/run 的路径。
4. 调试日志打印 `run_id`、`session_id`、`artifact_record_count`、
   `artifact_path_count`，方便复核返回来源。

### 前端

1. `runFileRowsCache` 和 `runFileRowsPending` 的 key 从 `runId` 改为
   `${sessionId}:${runId}`。
2. 请求返回前校验 message 的 `sessionId` 和 `runId` 没有变化。
3. 保留当前 `hasDiff=false` / `.openteams/**` 直接打开文件资源管理器的行为。

## 验证点

1. Session A 和 Session B 在同一 workspace 中分别输出 artifact。
2. 打开 A 的 run 消息底部文件列表，只出现 A 的 run diff、A 的 artifact。
3. 打开 B 的 run 消息底部文件列表，只出现 B 的 run diff、B 的 artifact。
4. 右侧 session 文件变更列表仍不展示 `.openteams/**` artifact。
