# dsh-balance-lite

> DeepSeek 余额显示插件（精简版）— 纯余额与会话消耗显示，无设置面板。

## 与完整版 (`dsh-balance`) 的区别

| 功能 | `dsh-balance` | `dsh-balance-lite` |
|------|:---:|:---:|
| 余额实时显示 + 三色状态灯 | ✅ | ✅ |
| 点击状态灯手动刷新 | ✅ | ✅ |
| 悬停弹出双栏详情卡片 | ✅ | ✅ |
| 本会话消耗估算 (按模型) | ✅ | ✅ |
| 谷峰费率自动切换 | ✅ | ✅ |
| 中英文国际化 | ✅ | ✅ |
| 可视化设置面板 | ✅ | ❌ |
| 定价参考弹窗 | ✅ | ❌ |
| YAML 配置导出 | ✅ | ❌ |
| API 连通性测试 | ✅ | ❌ |
| 运行时热更新配置 | ✅ | ❌ |

精简版体积约为完整版的 **1/3**。

## 安装

```bash
dsh plugin --profile web add dsh-balance-lite
```

> ⚠️ `dsh-balance` 和 `dsh-balance-lite` **二选一**，请勿同时安装。

## 配置

所有配置通过 `$DSH_HOME/profiles/web/cordis.patch.yml` 设置：

```yaml
- id: dsh-balance-lite
  config:
    # DeepSeek API 密钥 (留空则走 apiKeyRef 解析)
    apiKey: ''
    # credentials / 环境变量引用名
    apiKeyRef: DEEPSEEK_API_KEY
    # DeepSeek API 基址
    baseUrl: https://api.deepseek.com
    # 服务器查询余额间隔 (毫秒)
    refreshIntervalMs: 300000
    # 浏览器读取缓存间隔 (毫秒)
    clientPollIntervalMs: 30000
    # 计价货币
    currency: CNY
    # 多币种阈值
    thresholds:
      CNY: { warning: 10, danger: 5 }
      USD: { warning: 1.4, danger: 0.7 }
    # 自定义模型单价 (每 100 万 tokens)
    prices:
      deepseek-chat: { cacheHit: 0.2, cacheMiss: 2, output: 8 }
    # 谷时模型单价 (留空则使用官方标准单价)
    pricesOffPeak: {}
```

## 想要更多功能？

安装完整版：

```bash
dsh plugin --profile web remove dsh-balance-lite
dsh plugin --profile web add dsh-balance
```
