# dsh-balance

DeepSeek 余额实时显示插件: 在 dsh Web UI 输入框**下方、命中率/输入输出 token 统计条所在的同一行**, 实时显示:

- **账户余额与充足度状态指示灯**(如 `🟢 余额 ¥97.69`, 红/黄/绿三色直观反映余额充裕状况，**点击状态圆点可直接手动强刷查询最新余额**)
- **本次对话的估算消耗**(如 `本会话约 ¥3.92`, 按模型、按 DeepSeek 官方单价估算)
- **`?` 定价参考图标**: 悬停以 `?` 为中心优雅浮现 **DeepSeek V4 系列专属定价微卡片**（支持 `deepseek-v4-flash` 与 `deepseek-v4-pro`），点击直达官方定价页 <https://api-docs.deepseek.com/zh-cn/quick_start/pricing/>

悬停读数可查看**左右双栏毛玻璃卡片**：
- **左栏【📊 账户余额】**：实时大字总额、充足度 Badge、充值与赠送金额构成、5分钟自动刷新时间戳点击指示灯强刷指引以及偏好设置快速入口。
- **右栏【⚡ 本会话消耗】**：当前会话预估总花费、按模型细分明细（如 `• deepseek-v4-flash: ¥3.92`）、换行小字体展示输入/输出与缓存命中统计（如第一行 `Token: 输入 124M · 输出 301K` 与第二行 `命中: 123M (99.3%)`）。
- **时间感知引擎**：内置 2026 年 8 月 17 日起 DeepSeek 谷峰计费自动切换机制（09:00~12:00, 14:00~18:00 峰时 / 其他时段 5 折谷时），全自动无缝同步。

![示例预览图](./assets/preview.png)

## 架构

```
┌─────────────┐  按 refreshIntervalMs 轮询   ┌──────────────────┐
│ DeepSeek API│◀────────────────────────────│ 服务器插件(host)  │
│ /user/balance│                            │ · 余额缓存(带陈旧回退)│
│             │  ?force=1 手动强刷路由       │ · /query-balance 路由│
└─────────────┘                             │ · queryBalanceCost  │
                                            │   会话花费投影(含V4谷峰)│
                                            └────────┬───────────┘
                                                     │ 只读缓存 / 投影推送帧
                                            ┌────────▼───────────┐
                                            │ 浏览器插件(client)   │
                                            │ · 双栏悬停卡片      │
                                            │ · 点击指示灯手动强刷  │
                                            │ · 单例轮询器(页面隐藏 │
                                            │   时暂停)            │
                                            └────────────────────┘
```

- **性能**: 浏览器只读本地缓存(每 `clientPollIntervalMs` 一次极小 JSON), 不直接访问 DeepSeek;
  服务器按 `refreshIntervalMs` 拉取并缓存(失败保留上次成功值); 花费由投影折叠计算
  (与 dsh-token-meter 相同的 O(1) 状态机, 同引用事件零开销), 随既有 `session/projection`
  推送帧实时到达客户端, 无额外网络请求。
- **手动强刷**: 点击状态指示灯按钮可直接穿透缓存向 DeepSeek 官方发起实时查询，服务端内置 2000ms 冷却防刷保护。
- **密钥**: 复用 Harness 的 credentials 能力(`ctx.credentials`), 默认引用
  `DEEPSEEK_API_KEY`(即 `$DSH_HOME/.credentials.yaml` 或进程环境), 无需在配置里写密钥。
- **同行动态布局**: 组件全 Flex 居中对齐，与输入框底部统计条完美处于绝对水平中线。

## 安装

### 方式一：使用 DSH CLI 自动安装与配置（推荐）

DeepSeek Harness 自带的插件管理命令可以为您**一键完成下载安装和修改配置文件**：

```sh
dsh plugin --profile web add dsh-balance
```

执行完毕后，**重启 `dsh web` 即可生效。**

### 方式二：让 AI 助手帮您安装

如果您正在使用 Antigravity 等 AI 助手，直接复制以下提示词发给它：

> 请帮我在当前环境中安装 `dsh-balance` 插件，将其配置写入到我的 `cordis.yml` 中并启用它。

### 方式三：本地源码安装

如果您下载了源码，可以通过以下命令进行本地链接安装：

```sh
dsh plugin --profile web add <本目录绝对路径>
```

---

## 升级

当插件发布新版本后，您可以通过以下命令升级到最新版本：

```sh
dsh plugin --profile web remove dsh-balance
pnpm store prune
dsh plugin --profile web add dsh-balance@latest
```

> **为什么需要 `pnpm store prune`？**
> pnpm 会在本地缓存已下载的包。如果不清除缓存，即使 NPM 上已经发布了新版本，
> `dsh plugin add` 仍然可能安装到旧版本。执行 `pnpm store prune` 可以清除过期缓存，
> 确保拉取到最新版本。

---

## 卸载

使用 DSH CLI 一键卸载并自动清理配置文件：

```sh
dsh plugin --profile web remove dsh-balance
```

## ⚙️ 可视化设置面板说明

在 Web 界面输入框底部的统计条最右侧，点击 **⚙️ 齿轮图标**（或在悬停卡片底部点击 **⚙️ 打开偏好设置**），即可呼出可视化配置弹窗：

| 配置分组 | 包含设置项 | 说明 |
| :--- | :--- | :--- |
| **🎯 常规与阈值** | 计价货币、预警阈值、告急阈值、服务端查询间隔、前端读取缓存间隔 | 支持实时红黄绿三色阈值指示条预览；货币切换即时反映到会话消耗与余额展示。 |
| **🔑 API 凭证** | API Key、Base URL、请求超时时间、连通性测试 | 支持自定义 API Key（留空自动继承环境凭证）；提供 **⚡ 测试 API 连通性** 按钮，一键验证密钥有效性并反馈真实余额。 |
| **⚡ 模型单价** | 各模型（V4 Flash / V4 Pro / Chat / Reasoner）每 1M Token 的命中/未命中/输出单价 | 支持微调模型单价，提供“恢复官方推荐单价”按钮。 |
| **📋 YAML 导出** | 实时生成 `cordis.patch.yml` 配置代码块 | 随调参实时渲染 YAML 配置文本，支持一键复制到剪贴板，方便将当前参数持久化写入配置文件。 |

> **提示**：在设置弹窗中点击「**保存并生效**」，修改将立即应用到当前服务与页面，无需手动重启 `dsh web`！

## 配置模板

在 `$DSH_HOME/profiles/web/cordis.patch.yml`（或指定 profile 的 patch 文件）中覆盖配置。

### 模板 1：标准国内人民币账户（默认开箱即用 · 包含 DeepSeek V4 系列）

```yaml
- id: dsh-balance
  config:
    apiKey: ''                    # 留空自动复用 DEEPSEEK_API_KEY
    apiKeyRef: DEEPSEEK_API_KEY
    baseUrl: https://api.deepseek.com
    warningThreshold: 10          # 余额 < 10 元显示黄色预警灯
    dangerThreshold: 5            # 余额 < 5 元显示红色告急灯
    refreshIntervalMs: 300000     # 服务器向 DeepSeek 拉取余额的查询间隔(单位: 毫秒 ms，300000ms = 5分钟)
    clientPollIntervalMs: 30000   # 浏览器从本地读取缓存的刷新间隔(单位: 毫秒 ms，30000ms = 30秒)
    timeoutMs: 8000               # 单次网络请求超时时间(单位: 毫秒 ms，8000ms = 8秒)
    currency: CNY
    prices:
      deepseek-v4-flash: { cacheHit: 0.1, cacheMiss: 3, output: 9 }
      deepseek-v4-pro: { cacheHit: 0.3, cacheMiss: 9, output: 27 }
      deepseek-chat: { cacheHit: 0.1, cacheMiss: 1, output: 2 }
      deepseek-reasoner: { cacheHit: 1, cacheMiss: 4, output: 16 }
    defaultPrices: { cacheHit: 0.1, cacheMiss: 1, output: 2 }
```

### 模板 2：海外美元账户（USD 计价与小额阈值）

```yaml
- id: dsh-balance
  config:
    apiKey: ''
    apiKeyRef: DEEPSEEK_API_KEY
    baseUrl: https://api.deepseek.com
    warningThreshold: 2.0         # 余额 < $2.0 显示黄色预警
    dangerThreshold: 0.5          # 余额 < $0.5 显示红色告急
    refreshIntervalMs: 300000     # 服务器拉取余额间隔(单位: 毫秒 ms，300000ms = 5分钟)
    clientPollIntervalMs: 30000   # 浏览器读取缓存间隔(单位: 毫秒 ms，30000ms = 30秒)
    timeoutMs: 8000               # 请求超时时间(单位: 毫秒 ms，8000ms = 8秒)
    currency: USD                 # 计价货币切换为美元
    prices:
      deepseek-v4-flash: { cacheHit: 0.014, cacheMiss: 0.44, output: 1.32 }
      deepseek-v4-pro: { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 }
    defaultPrices: { cacheHit: 0.014, cacheMiss: 0.44, output: 1.32 }
```

### 模板 3：高频重度开发者（高缓冲安全档）

```yaml
- id: dsh-balance
  config:
    warningThreshold: 50          # 余额 < 50 元预警(留足多次长任务会话缓冲)
    dangerThreshold: 10           # 余额 < 10 元告急
```

### 模板 4：开发测试隔离环境（Dev Profile · 独立 3081 端口）

在 `$DSH_HOME/profiles/dev/cordis.patch.yml` 中：

```yaml
- id: webserver
  config:
    host: 127.0.0.1
    port: 3081                   # 固定测试环境跑在 3081 端口

- id: dsh-balance
  config:
    warningThreshold: 10
    dangerThreshold: 5
```

---

## AI 助手提示词模板 (Prompt Templates)

如果您正在使用 **Antigravity**、**Cursor** 或 **Claude** 等 AI 助手，可直接复制以下提示词发给它自动完成操作：

### 📋 提示词 1：全新安装与默认启用
> 请帮我在当前 DeepSeek Harness 环境中安装 `dsh-balance` 插件，将其默认配置写入到我的 `cordis.patch.yml` 中并确保已启用。

### 📋 提示词 2：调整余额预警与告急阈值
> 请帮我修改 `dsh-balance` 插件的配置，将告急阈值（红灯）设置为 10 元，预警阈值（黄灯）设置为 30 元。

### 📋 提示词 3：切换为美元（USD）账户计价
> 我的 DeepSeek 账户使用的是美元计价，请帮我将 `dsh-balance` 插件的货币单位切换为 `USD`，将阈值调整为预警 $2.0、告急 $0.5，并更新对应的每 1M Token 美元定价策略。

### 📋 提示词 4：配置独立的 Dev 测试环境与端口隔离
> 请帮我初始化一个 DSH `dev` Profile，将本地 `dsh-balance` 插件链接进去，并将 Web 端口固定为 `3081`，以便于我和日常使用的 3080 端口环境并行测试。

---

## 验证

```sh
npm test                         # 运行全部测试
node test/smoke-projection.mjs   # 投影折叠(替换语义/模型归属/计价)测试
node test/smoke-client.mjs       # 客户端 bundle 注册与渲染冒烟测试(零依赖)
```

手工验证:

```sh
curl http://127.0.0.1:3080/query-balance
# → {"ok":true,...,"isAvailable":true,"thresholds":{"warning":10,"danger":5},"balances":[{"currency":"CNY","total":99.74,...}]}
curl http://127.0.0.1:3080/plugins/dsh-balance/client.js   # 客户端 bundle
```

## 开发说明

- 服务器插件: `src/index.js`(ESM, 零构建)。
- 客户端 bundle: `client/client.js`, 手写的惰性 CJS 工厂格式
  (`window.__ModuleLoader__.load({id, factory})`), 修改后**重启 dsh web** 生效
  (无 monorepo 构建链时不做 bundle 重哈希)。
- 项目自带 `node_modules`(schemastery/zod), 与 profile 内同名依赖互不冲突。
- 本地测试: `test/` 目录下提供零依赖单元与冒烟测试，发布 npm 时自动排除测试目录。

## 常见问题 (FAQ)

**Q: 插件怎么知道查询的是哪个用户的余额数据？**

A: 插件在向 DeepSeek 官方服务器发送查询请求时，会在请求头中携带您的 **API Key**（即 `sk-xxxx`）。因为每一个 API Key 在 DeepSeek 官方都是唯一绑定到您的账号上的，所以服务器通过识别这串凭证，就能精准返回您的账号真实余额。
此外，本插件利用了 DSH 原生的凭据管理系统（Credentials），它会自动复用您平时用于聊天的 `DEEPSEEK_API_KEY`，所以您甚至不需要在插件里重复配置密钥，它就“聪明地”复用了您的身份去查余额了！

**Q: 红黄绿状态指示灯的判断规则是什么？**

A:
* 🟢 **绿色（充足）**：余额 $\ge$ `warningThreshold`（默认 $\ge 10$ 元），账户额度充裕。
* 🟡 **黄色（偏低）**：`dangerThreshold` $\le$ 余额 $<$ `warningThreshold`（默认 $5 \sim 10$ 元），提示余量不多，建议适时充值。
* 🔴 **红色（告急）**：余额 $<$ `dangerThreshold`（默认 $< 5$ 元）或余额不可用/异常，警示当前任务可能中断。
各阈值均可在可视化设置面板或配置文件中自由调节。

**Q: 8月17日 DeepSeek 官方更新谷峰定价后，插件会自动同步吗？**

A: **完全会自动同步！** 插件内部已植入时间感知计费引擎（`resolveModelPrice`）。当时间进入北京时间 2026年8月17日 00:00 后，插件会在会话发生 Token 扣费估算和展示 `?` 定价卡片时，自动识别当前处于 **☀️ 峰时（09:00~12:00, 14:00~18:00）** 还是 **🌙 谷时（其他时段享5折特惠）**，全自动精准折算与显示，无需人工重启或修改任何配置。

---

## 📝 更新日志 (Changelog)

### v0.2.2 (2026-08-17)

- 🔒 **配置与数据安全强化**：
  - 修复前端保存设置时对空 `apiKey` 的误清空缺陷；
  - 修复 `thresholds` 多币种初始化时的浅拷贝覆盖问题，实现逐币种深度合并（Deep Merge）；
  - 为 `readJsonBody` 增加 10 秒超时防护与超大请求体熔断机制。
- 💱 **实时币种自适应与定价完整性**：
  - 切换计价货币（CNY ↔ USD）后前端即时动态自适应折算会话消耗，无需刷新网页，避免会话中断；
  - 完善谷时自定义模型定价下发与服务端回退的一致性。
- 🎨 **格式化与测试体系强化**：
  - 修复负数金额显示格式与负号位置（如 `-¥5.00`、`-¥0.050`），增加 NaN 防御；
  - 扩充全套零依赖自动化冒烟测试（覆盖同步骤模型切换、超时熔断、数值下限防御等场景）。

---

### v0.2.1 (2026-08-17)

- 💱 **多币种（CNY / USD）阈值独立设置**：
  - 支持人民币与美元独立设置预警与告急阈值，各币种独立记忆与持久化；
  - 默认值按今日固定汇率智能换算（CNY: 10 / 5，USD: 1.4 / 0.7），滑块按选中货币自适应调整刻度量程。
- ⚡ **分段定价配置与自定义模型管理**：
  - 设置面板支持分别配置与切换 ☀️ 峰时 与 🌙 谷时单价；
  - 支持在设置面板中动态添加与删除自定义模型单价。
- 🎨 **UI 与交互精细化优化**：
  - 峰时/谷时标记去除冗余汉字，采用极简 ☀️ / 🌙 图标，悬停即显时段文字气泡（Tooltip）；
  - 移除鼠标悬停问号光标，恢复清爽的默认指针；
  - 修复滑块由于容器定位导致的横向异常贯穿屏幕样式 Bug；
  - 会话卡片底部辅助提示字号精细优化（9.5px）并对齐列表标记。

---

### v0.2.0 (2026-08-17)

- 🌙 **DeepSeek 谷峰动态计费引擎**：
  - 内置时间感知计费引擎，自动识别北京时间 09:00~12:00 / 14:00~18:00 峰时与其余时段 5 折谷时；
  - 会话花费投影与定价参考卡片全自动动态同步。
- ⚙️ **可视化设置面板**：
  - 支持在 Web 界面热配置参数并即时「保存并生效」，无需重启服务；
  - 交互式三色阈值双滑块调节，带实时数值与图例；
  - 实时 YAML 导出与一键复制功能。
- 🔄 **状态指示灯一键强刷**：
  - 点击左上角状态圆点即可穿透本地缓存强刷 DeepSeek 实时余额，内置 2000ms 冷却保护防刷机制。

---

### v0.1.0 (2026-08-16)

- 🚀 **首发版本发布**：
  - 输入框底部统计栏同行无缝嵌入余额与会话消耗读数；
  - 红/黄/绿三色账户充足度状态指示灯；
  - 左右双栏毛玻璃悬停详情卡片（账户总额、充值/赠送构成、模型消耗明细、Token 命中率）；
  - `?` 定价参考气泡微卡片与官方定价直达链接；
  - 高性能单例轮询器与 O(1) 投影折叠花费计算。


