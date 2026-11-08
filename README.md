# magpie-page-credentials · 凭据额度

[magpie](https://github.com/yetone/magpie) 的页面插件：在侧栏「凭据额度」里一页看清所有订阅账户的额度——5 小时 / 7 天等窗口的剩余、重置倒计时、恢复可用时间、订阅到期、Codex 重置卡，并且可以直接在页面里**刷新额度**、**使用 Codex 重置卡**。

## 功能

- **汇总**：账户总数与状态分布（可用 / 紧张 / 暂停调度 / 已耗尽）、现在可用的账户数、下一次窗口重置、可用重置卡总数及最早过期时间。
- **账户卡片**（按服务分组，可搜索、筛选、排序）：
  - 每个窗口一条「剩余额度」条：颜色随剩余变化，条上的竖线是「按时间匀速使用此刻应剩多少」，用得比时间快会标出「用得偏快」；
  - 重置倒计时（每秒更新）和具体时间，用尽的账户显示「恢复可用」倒计时；
  - 近 48 小时剩余额度走势（来自 magpie 的额度历史）；
  - Antigravity 这类按模型计额的账户：按额度池分组，模型级窗口合并后收进「模型明细」；
  - WorkBuddy 积分、按量计费服务的余额与走势；
  - 订阅到期、是否自动续费、已用重置卡数、读取时间。
- **刷新**：单个账户刷新，或「全部刷新」（magpie 对同一账户 30 秒内只真正读取一次）。
- **Codex 重置卡**：确认对话框列出当前窗口、可选择使用哪一张（默认最早过期的），结果以 magpie 的返回码说明（已重置 / 无需重置 / 冷却中……）。
- 跟随 magpie 的深浅色主题与配色；离开页面时暂停定时刷新。

## 安装

```sh
magpie plugin add github:miyling/magpie-page-credentials
```

或在 magpie 的「插件」页里添加 `github:miyling/magpie-page-credentials`。安装后侧栏「插件」分组里会出现「凭据额度」。

桌面应用和 `magpie web`（含 Docker 部署、反向代理）都可以用。

## 选项

在插件管理里编辑本插件的选项（`plugins.json`）：

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `port` | `4396` | 插件本地服务监听的端口（只绑 `127.0.0.1`）。端口被占用时改这里。 |
| `gatewayUrl` | 自动 | magpie 网关地址。默认取 `MAGPIE_ADDR`，否则 `http://127.0.0.1:3425`。 |
| `gatewayKey` | 自动 | 网关 key。默认从 magpie 配置目录的 `caller-keys.json` 里挑一把启用、满权限的 key。 |

> **使用重置卡需要满权限的网关 key**：magpie 规定花重置卡（不可撤销）即使从本机发起也必须带一把启用、非只读、没有限制预算 / 模型 / 账户的网关 key。插件会自动使用 magpie 里已有的这类 key；没有的话，页面会提示你在「网关 › 网关 key」里新建一把，或填到 `gatewayKey` 选项里。

## 工作方式与安全

magpie 的插件页运行在 `sandbox="allow-scripts"`、`connect-src 'none'` 的 iframe 里，页面本身不能联网，所以本插件分两部分：

1. **后端**（`index.mjs` → `lib/server.mjs`）：magpie 在 Bun 插件宿主里加载插件时，在 `127.0.0.1:<port>` 起一个本地服务，托管看板（`app/`），并把操作转给 magpie 网关的 `/v1/magpie/quotas/cards`、`/quotas/refresh`、`/quotas/history`、`/quotas/codex-reset`。
2. **入口页**（`page/`）：magpie 侧栏打开的页面。它读取后端写下的会话密钥，然后把帧跳到本地服务——桌面窗口里直接是 `http://127.0.0.1:<port>/`，`magpie web` 里经 magpie 的页面服务反代（`magpie.page.service`），远程浏览器也能用。

安全措施：

- 网关 key 只在插件进程内存里使用，不会出现在任何响应、页面或日志里；
- 本地服务只绑回环地址，校验 `Host`（防 DNS 重绑定）与 `Origin`；
- 因为沙箱页是 opaque origin，`/api` 必须回 `Access-Control-Allow-Origin: *`；为防止其他网站借此读取账户信息或花掉重置卡，每次启动生成随机会话密钥，写在插件目录 `page/session/<port>.js`（只能经 magpie 按页面 token 读到），入口页通过 URL fragment 交给看板，`/api` 只认带该密钥的请求；
- 远程 magpie 同步来的卡片（`office/codex` 这类）不会在这里刷新或使用重置卡。

## 开发

```sh
npm test                                   # 单元测试 + 用假网关测服务
node scripts/dev.mjs 4397 http://127.0.0.1:3425   # 直接起服务预览，打印带会话密钥的地址
CRED_GATEWAY_KEY=sk-magpie-… node scripts/dev.mjs  # 指定网关 key
```

零运行时依赖，Node ≥ 20 / Bun。

## 许可

MIT
