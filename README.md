# Komari Cron Task（定时任务）

按 cron 计划在选定节点上定时执行 shell 命令，回收每个节点的执行结果，失败时通过 Komari 已配置的通知渠道发送告警。适用于定时备份、健康巡检、日志轮转、证书续期等运维自动化场景。

> 需要 Komari ≥ 1.4.3（依赖 `server.cron` 插件调度 API 与 `admin:exec` 远程执行 RPC）。
>
> 已通过 Komari 1.4.3 + komari-agent 1.2.60 实机端到端验证：任务管理、cron 触发、命令下发、结果回收、失败判定、历史落盘。

## 功能

- **任务数量不限**：通过插件内置的管理页面增删改任务，任意数量
- **管理页面**（Komari 侧边栏「定时任务」入口）：
  - 任务列表：名称 / cron / 命令 / 目标节点 / 启用状态一目了然
  - 新建 / 编辑 / 删除 / 启停任务
  - 手动触发（立即执行一次）
  - 执行历史：每次运行的命令、节点输出、退出码、耗时、超时标记（最新在前，保留最近 200 条）
- **cron 表达式**：支持 5 字段（`分 时 日 月 周`）、6 字段（含秒）以及 `@every 1m` 固定间隔写法，按服务器本地时区执行
- **结果回收**：通过系统远程执行任务（`admin:exec`）下发命令，轮询回收每个节点的输出与退出码
- **失败告警**：任一节点退出码非 0、或全部节点离线时，通过已配置的通知渠道（Telegram / 邮件 / webhook 等）发送任务名、节点、退出码与输出预览
- **执行历史**：最近 200 轮执行记录保存在插件数据目录（`data/plugin-data/crontask/history.json`），升级插件不丢失
- **并发保护**：同一任务上一轮未结束时不重复触发
- **节点离线**：离线节点由系统直接记为退出码 -1，不影响其他在线节点执行

## 安装

1. 在 Komari 后台「插件」页面通过插件市场或本仓库 Release 上传 `crontask-0.3.0.zip`
2. 批准权限：插件声明 `allowSystemRPC`（调用系统 RPC）与 `node`（持久化存储）两项能力
3. 在 Komari 侧边栏进入「定时任务」页面，新建任务并填写参数

## 管理页面配置项

| 配置 | 说明 |
|---|---|
| 任务名称 | 用于通知与历史记录的标识 |
| cron 表达式 | 触发计划，见上文格式说明 |
| 命令 | 每个目标节点上执行的 shell 命令，支持多行 |
| 目标节点 | 选择要执行命令的节点（支持从节点列表勾选或粘贴 uuid）；未选择时该任务跳过本轮 |
| 结果等待超时（秒） | 下发后等待全部节点返回结果的最大秒数（1–3600），超时按部分结果结算并标记 |
| 失败时发送通知 | 失败时是否发送告警 |

## 开发

```sh
npm install
npm run typecheck   # 类型检查
npm test            # 单元测试 + 宿主模拟集成测试（28 项）
npm run check       # manifest 校验
npm run build       # 产出 script.js
npm run pack        # 产出 dist/crontask-0.3.0.zip
```

### 集成测试说明

`test/host.test.ts` 在 Node 中模拟 Komari 的 goja 宿主环境，直接加载构建产物 `script.js` 执行，覆盖：cron 表达式级调度、执行下发、结果轮询（含 exit_code 中间态等待）、失败通知、历史落盘、并发去重、管理 RPC 全链路。无需真实服务器即可回归核心逻辑。

### 本地实机验证

若本机有 Komari 实例，可用管理页新建一个 `@every 1m` 的简单任务（如 `echo hello`）和一个必然失败的任务（如 `exit 1`），观察：任务表生成、通知到达、`data/plugin-data/crontask/history.json` 生成。

## 发布

### 方式一：自有插件市场源（推荐）

本仓库自带 `market/v1.json`（Komari 插件市场目录格式）与 `.github/workflows/update-catalog.yml`（Release 发布时自动更新版本号与 SHA-256）。

1. 把本仓库推到你的 GitHub，打包发 Release（tag `v0.3.0`，附件 `dist/crontask-0.3.0.zip`）
2. Action 会自动校验 zip 并更新 `market/v1.json`
3. 在 Komari 后台「插件 → 市场来源」添加：
   ```
   https://raw.githubusercontent.com/Reinakumiko/Komari-Crontask/main/market/v1.json
   ```
4. 之后每次发新 Release，市场列表自动跟上，后台一键更新

> 记得把 `market/v1.json` 里的 `YOUR_USERNAME` 与 `author` 改成你自己的（首次提交前）。

### 方式二：官方市场

将 `dist/crontask-0.3.0.zip` 挂到 GitHub Release（tag `v0.3.0`），然后在 [komari-monitor/plugin-market](https://github.com/komari-monitor/plugin-market) 提交插件 Issue；市场工作流会校验 SHA-256 并自动跟进后续 Release。

## 权限说明

- **`allowSystemRPC`**：必需。用于调用 `admin:exec`（下发命令）、`admin:getTaskResultsByTaskId`（回收结果）、`admin:sendNotification`（失败告警），以及插件的管理 RPC（`crontask.*`，默认 admin 角色可调）
- **`node`**：必需。用于访问 `__storageDir__` 持久化任务与执行历史。该权限为运行时设置，不参与管理员审批

插件不声明、不使用高危的 `allowExec`（本机 shell）或 `allowAllFileAccess`；命令在目标节点上由 agent 执行，插件本身不做任何命令拼接。

## 实机验证记录（v0.2）

- 管理页面通过 `/api/admin/plugin/crontask/admin/` 提供（admin 鉴权），页面内 JS 以同源 session 调用 `crontask.*` RPC 与 `common:getNodes`
- 任务 CRUD / 启停 / 手动触发 / 历史查看全部端到端跑通
- cron 采用**表达式级去重注册**（同表达式只注册一次，fire 时动态匹配当前任务），任务增删改即时生效且不触发插件重载，无竞态
- 正常任务 `echo crontask-ok && date` → history 记录 `exit_code: 0` + 完整 stdout
- 失败任务 `echo boom && exit 7` → history 记录 `exit_code: 7` + `'boom\n'`

## 注意

- 命令在节点上的执行身份取决于 agent 进程权限，请勿在命令中硬编码敏感凭据
- cron 按服务器本地时区匹配，跨时区使用请留意
- 单轮执行时间包含轮询等待，最长受「结果等待超时」限制，请勿配置过短导致长命令被标记超时