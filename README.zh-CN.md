<div align="center">

<img src="page/icon.png" width="88" height="88" alt="magpie-page-credentials">

# magpie-page-credentials

### 所有账户的额度与重置卡，一页看清。

**[magpie](https://github.com/yetone/magpie) 的凭据额度看板插件：集中查看所有订阅账户、编程套餐与 API 余额。**<br>
实时掌握 5 小时 / 7 天窗口剩余、重置倒计时与 48 小时走势，<br>
并在侧栏页面内直接**刷新额度**与**使用重置卡（支持 Codex 与智谱 GLM Coding Plan 等）**。

[![License: MIT](https://img.shields.io/badge/license-MIT-111111)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](package.json)
[![magpie plugin](https://img.shields.io/badge/magpie-page%20plugin-3b6cf6)](https://github.com/yetone/magpie)

[English](README.md) · **简体中文**

</div>

<br>

## 它做什么

`magpie-page-credentials` 是 [magpie](https://github.com/yetone/magpie) 的侧边栏页面插件（`magpie.page`）。无需单独登录或导入密钥，直接复用你在 magpie 里已经配好的 **Claude Code**、**Codex（ChatGPT）**、**Antigravity**、**GitHub Copilot**、**WorkBuddy**、**智谱 GLM Coding Plan**、**Kimi**、**Qwen** 以及各类按量计费 API Key，提供支持**卡片 / 列表双视图**的凭据额度工作台。

| 能力 | 说明 |
| --- | --- |
| **双视图工作台（卡片 / 列表）** | 支持**卡片视图**（适合纵览多窗口详情与 48h 走势）与**列表视图**（全页共用粘性单表头、内嵌可折叠分组带、基于 Container Queries 的自适应多列进度条，适合多账号横向对比），按 `V` 一键切换 |
| **智能分组与汇总卡联动** | 自动将零散的按量计费 Key 归入「**API 余额**」分类，订阅与套餐按服务商归组；点击顶部任意汇总指标卡（全部 / 可用 / 耗尽或暂停 / 有重置卡）可直接联动筛选对应账户 |
| **主窗口与附加配额分离** | 自动识别 `MCP · Month`、`Extra usage`、`On-demand` 以及存在 `Total credits` 时的子积分拆项，将其作为附加配额展示，**不会因为 MCP 等附加项用尽而把主模型额度误判为「已耗尽」** |
| **匀速基准线与快慢预警** | 为 5 小时 / 7 天等周期窗口计算时间进度基准线（进度条上的竖刻线）：当消耗速度明显快于时间流逝（超出 15% 以上）时自动标记「**用得偏快**」 |
| **通用重置卡支持** | 不局限于单一服务：同时支持 **Codex 速率重置卡**（经 magpie 网关 `/v1/magpie/quotas/codex-reset`）与 **智谱 GLM Coding Plan 窗口重置券**（按 `5 小时` / `7 天` 窗口类型匹配可用重置券并核销，完成后自动刷新额度） |
| **原生图标与主题跟随** | 内置对齐 magpie 的 190+ 服务商图标（支持彩色 SVG/PNG、随深浅色自适应的单色遮罩，以及用户在 magpie 中上传的 `file:` 自定义图标），滚动条、配色与字体完全跟随 magpie 窗口 |
| **实时倒计时与快捷操作** | 窗口重置倒计时与「恢复可用」时间每秒更新；支持点击账号名一键复制、快捷键搜索（`/`）、分组开关（`G`）、单账号刷新与全部刷新（magpie 对同一账号 30 秒内只向厂商发起一次真实读取） |

## 快速开始

**1 · 安装**

在终端执行：

```sh
magpie plugin add github:miyling/magpie-page-credentials
```

或者打开 magpie，在「**插件**（Plugins）」页面中添加 `github:miyling/magpie-page-credentials`。

**2 · 打开看板**

安装并启用后，magpie 左侧导航栏「**插件**」分组下会出现「**凭据额度**」：

- **桌面端（macOS / Windows / Linux）** 与 **`magpie web`（含 Docker 部署、反向代理）** 均可直接使用；
- 切换到其他页面时自动暂停后台轮询，切回本页时立即同步最新状态。

**3 · 更新与重载**

```sh
magpie plugin update
```

本地修改代码或执行更新后，在 magpie「插件管理」里把本插件**关掉再打开**，插件宿主即会重启并加载新代码。

## 插件选项

在 magpie「插件管理」中编辑本插件的选项（保存在 `plugins.json`）：

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `port` | `4396` | 插件本地服务监听端口（仅绑定 `127.0.0.1`）。端口被占用时可修改此项 |
| `gatewayUrl` | `""`（自动） | magpie 网关地址。留空时优先取环境变量 `MAGPIE_ADDR`，否则默认 `http://127.0.0.1:3425` |
| `gatewayKey` | `""`（自动） | 网关调用密钥。留空时自动从 magpie 配置目录的 `caller-keys.json` 中选取一把已启用、满权限的 key |

> **关于重置卡权限**：
> - **Codex 重置卡**：magpie 网关规定消费 Codex 重置卡不可撤销，即使从本机发起也必须携带一把**已启用、非只读、未限制预算 / 模型 / 账户**的满权限网关 key。插件会自动从 `caller-keys.json` 查找；若尚未创建，页面顶部会提示你在「网关 › 网关 key」中新建一把，或填到 `gatewayKey` 选项里。
> - **智谱 GLM Coding Plan 重置券**：插件直接读取该套餐在 `providers.json` 中的配置，按你在弹窗中选择的窗口（5 小时 / 7 天）查询并核销对应可用重置券，核销后自动触发 magpie 刷新该套餐额度。

## 架构与安全边界

magpie 的插件页运行在 `sandbox="allow-scripts"`、`connect-src 'none'` 的沙箱 `iframe` 里，静态页面本身不能直接联网。本插件采用「**沙箱入口页 + 本地受保护服务**」的双层结构：

```text
index.mjs          Bun 插件宿主入口，管理本地 HTTP 服务生命周期
lib/
  server.mjs       本地服务（127.0.0.1:4396）：静态看板、/api/* 路由、Host/Origin 与会话鉴权
  gateway.mjs      对接 magpie 网关与上游重置接口（Codex 重置卡 / 智谱套餐重置券 / 远程节点）
  session.mjs      每次启动生成 24 字节随机会话密钥，原子写入 page/session/<port>.js
page/
  index.html       magpie 侧栏沙箱入口页：读取会话密钥并通过 URL fragment 跳转至本地服务
  launcher.js      自动识别桌面端直连与 magpie web 反代（magpie.page.service）
app/
  index.html       看板主界面（顶栏、汇总卡、分类/状态筛选栏、卡片/列表容器、弹窗）
  model.js         纯数据模型：服务商元数据、窗口分组、附加配额识别、匀速基准、排序与搜索
  app.js           视图渲染与交互：卡片/列表双视图、主题桥接、重置卡选择弹窗、快捷键
  style.css        响应式布局（Container Queries）、列表粘性表头与 magpie 原生风格滚动条
  icons/           内置 magpie 服务商图标集（彩色 SVG/PNG 与单色自适应遮罩）
test/
  model.test.mjs   数据模型与多服务商重置卡逻辑单元测试
  server.test.mjs  会话鉴权、防 DNS 重绑定、CORS 与网关转发集成测试
```

**安全措施**：

1. **密钥不离进程**：`caller-keys.json` 与 `providers.json` 中的密钥仅在插件后端进程内存中使用，绝不出现在任何响应、页面或日志里；
2. **仅绑回环 + 防 DNS 重绑定**：本地服务只绑定 `127.0.0.1`，严格校验 `Host`（仅认 `127.0.0.1:<port>` 与 `localhost:<port>`）和 `Origin`；
3. **一次性启动会话密钥（`x-cred-session`）**：因为沙箱页是 opaque origin（`Origin: null`），`/api/*` 需返回 `Access-Control-Allow-Origin: *`。为防止浏览器里的其他网页借此读取账户信息或花掉重置卡，后端每次启动都会生成 24 字节随机密钥写入 `page/session/<port>.js`（只能经 magpie 按当次页面 token 读到），由入口页通过 URL fragment 传给看板，所有 `/api/*` 请求均用 `crypto.timingSafeEqual` 校验该密钥；
4. **远程卡片只读保护**：从另一台远程 magpie 同步来的卡片（如 `office/codex`）在看板中明确标出来源，禁止在本机误触发刷新或消费重置卡。

## 本地开发与测试

零外部运行时依赖，需 Node.js ≥ 20 或 Bun：

```sh
# 运行全部单元与服务集成测试（全 mock，零真实网络请求）
npm test

# 启动独立开发预览服务（自动打印带会话密钥的本地预览 URL）
node scripts/dev.mjs 4397 http://127.0.0.1:3425
```

## 许可

[MIT](LICENSE)
