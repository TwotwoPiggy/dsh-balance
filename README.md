# dsh-balance

DeepSeek 余额实时显示插件: 在 dsh Web UI 输入框**下方、命中率/输入输出 token 统计条所在的同一行**, 实时显示:

- **账户余额**(如 `余额 ¥99.47`)
- **本次对话的估算消耗**(如 `本会话约 ¥0.0007`, 按模型、按 DeepSeek 官方单价估算)
- **`?` 图标**: 悬停显示当前配置的 DeepSeek 定价策略(按模型: 缓存命中/未命中/输出,
  每 1M token), 点击打开官方定价页 <https://api-docs.deepseek.com/zh-cn/quick_start/pricing/>

悬停读数可查看详情: 余额构成(赠送/充值)、余额是否可用、更新时间、刷新间隔、按模型分解的会话消耗与 token 明细。

## 架构

```
┌─────────────┐  按 refreshIntervalMs 轮询   ┌──────────────────┐
│ DeepSeek API│◀────────────────────────────│ 服务器插件(host)  │
│ /user/balance│                            │ · 余额缓存(带陈旧回退)│
└─────────────┘                            │ · /query-balance 路由│
                                           │ · queryBalanceCost  │
                                           │   会话花费投影(按模型)│
                                           └────────┬───────────┘
                                                    │ 只读缓存 / 投影推送帧
                                           ┌────────▼───────────┐
                                           │ 浏览器插件(client)   │
                                           │ · conversation.     │
                                           │   composer.dock 条目 │
                                           │ · 单例轮询器(页面隐藏 │
                                           │   时暂停)            │
                                           └────────────────────┘
```

- **性能**: 浏览器只读本地缓存(每 `clientPollIntervalMs` 一次极小 JSON), 不直接访问 DeepSeek;
  服务器按 `refreshIntervalMs` 拉取并缓存(失败保留上次成功值); 花费由投影折叠计算
  (与 dsh-token-meter 相同的 O(1) 状态机, 同引用事件零开销), 随既有 `session/projection`
  推送帧实时到达客户端, 无额外请求。
- **密钥**: 复用 Harness 的 credentials 能力(`ctx.credentials`), 默认引用
  `DEEPSEEK_API_KEY`(即 `$DSH_HOME/.credentials.yaml` 或进程环境), 无需在配置里写密钥。
- **同行动态布局**: 组件实测统计条兄弟节点的高度, 用负 margin 精确拉回同一行并右对齐;
  统计条不存在(空白会话)时自动退化为独立的一行, 统计条出现后自动归位。

## 安装

### 方式一：使用 DSH CLI 自动安装与配置（最简单推荐）

DeepSeek Harness 自带的插件管理命令可以为您**一键完成下载安装和修改配置文件**：

在运行 DeepSeek Harness 的终端目录中，执行以下命令：

```sh
dsh plugin add dsh-balance
```
*(注：如果您使用的是特定的 profile，例如 web，请加上参数：`dsh plugin --profile web add dsh-balance`)*

执行完毕后，**重启 `dsh web` 即可生效。**

### 方式二：手动通过 NPM 安装

如果您想手动修改配置，可以通过 NPM 安装：

```sh
npm i dsh-balance
```

安装完成后，手动在您的 `cordis.yml` 或 `cordis.json` 配置文件中的 `plugins` 节点下启用该插件：

```yaml
plugins:
  # 其他已有的插件...
  dsh-balance: {}
```

### 方式三：让 AI 助手帮您安装

如果您正在使用 Antigravity 等 AI 助手，直接复制以下提示词发给它：

> 请帮我在当前环境中安装 `dsh-balance` 插件，将其配置写入到我的 `cordis.yml` 中并启用它。

### 方式四：本地源码安装

如果您下载了源码，可以通过以下命令进行本地链接安装：

```sh
dsh plugin --profile web add <本目录绝对路径>
```

---

## 卸载

同样可以使用 DSH CLI 一键卸载并自动清理配置文件：

```sh
dsh plugin remove dsh-balance
```

## 配置

在 `$DSH_HOME/profiles/web/cordis.patch.yml` 中覆盖(整行替换, 需重述所有键):

```yaml
- id: query-balance
  config:
    apiKey: ''                    # 显式密钥; 留空走 credentials(DEEPSEEK_API_KEY)
    apiKeyRef: DEEPSEEK_API_KEY   # credentials / 环境变量引用名
    baseUrl: https://api.deepseek.com
    refreshIntervalMs: 300000     # 查询频率: 服务器向 DeepSeek 拉取余额的间隔(毫秒)
    clientPollIntervalMs: 30000   # 浏览器刷新显示的间隔(毫秒)
    timeoutMs: 8000               # 单次请求超时
    currency: CNY                 # 花费估算计价货币(与 prices 一致)
    prices:                       # 每 1M token 单价(按 currency 计价)
      deepseek-chat: { cacheHit: 0.2, cacheMiss: 2, output: 8 }
      deepseek-reasoner: { cacheHit: 0.5, cacheMiss: 4, output: 16 }
    defaultPrices: { cacheHit: 0.2, cacheMiss: 2, output: 8 }  # 未列出模型的回退价
```

> 价格为公开参考价, 若官方调整请自行更新; 若余额为 USD, 请把 `currency` 与
> `prices` 一并改为美元价。

## 验证

```sh
node scripts/smoke-projection.mjs   # 投影折叠(替换语义/模型归属/计价)测试
node scripts/smoke-client.mjs       # 客户端 bundle 注册与渲染冒烟测试
```

手工验证:

```sh
curl http://127.0.0.1:3080/query-balance
# → {"ok":true,...,"isAvailable":true,"balances":[{"currency":"CNY","total":99.74,...}]}
curl http://127.0.0.1:3080/plugins/dsh-query-balance/client.js   # 客户端 bundle
```

## 开发说明

- 服务器插件: `src/index.js`(ESM, 零构建)。
- 客户端 bundle: `client/client.js`, 手写的惰性 CJS 工厂格式
  (`window.__ModuleLoader__.load({id, factory})`), 修改后**重启 dsh web** 生效
  (无 monorepo 构建链时不做 bundle 重哈希)。
- 项目自带 `node_modules`(schemastery/zod), 与 profile 内同名依赖互不冲突。

## 常见问题 (FAQ)

**Q: 插件怎么知道查询的是哪个用户的余额数据？**

A: 插件在向 DeepSeek 官方服务器发送查询请求时，会在请求头中携带您的 **API Key**（即 `sk-xxxx`）。因为每一个 API Key 在 DeepSeek 官方都是唯一绑定到您的账号上的，所以服务器通过识别这串凭证，就能精准返回您的账号真实余额。
此外，本插件利用了 DSH 原生的凭据管理系统（Credentials），它会自动复用您平时用于聊天的 `DEEPSEEK_API_KEY`，所以您甚至不需要在插件里重复配置密钥，它就“聪明地”复用了您的身份去查余额了！
