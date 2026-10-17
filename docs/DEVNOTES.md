# 开发记录（非用户文档）

这些是开发期间踩到的真实问题与实验结论，保留给未来的维护者；对使用者没有阅读价值，所以不在 README 里。

## 当前状态：✅ 已在真实 DSH + 真实浏览器中端到端跑通（含截图）

| 环节 | 状态 | 证据 |
|---|---|---|
| 数据源解析 | ✅ 真实数据 | 13 个文件扫描、采用 9 个；四类 token 完整；按模型之和 = 总量 |
| 指标口径 | ✅ 与 DSH 同源 | 解码速度 228.6 tok/s（`decodeTokens/decodeMs`，与官方 `StatsPills` 同算法）、缓存命中率 99.62% |
| host 侧加载 | ✅ 真实 DSH 日志 | `[dsh-usage-orb] host 侧已加载` + 自检行 |
| host 路由 | ✅ 真实 HTTP 200 | `GET /usage-panel/api/usage` 返回合法 JSON；`POST {"days":2}` 正确裁剪 |
| **client 激活** | ✅ 真实控制台 | `[dsh-usage-orb] client 侧已加载` / `已挂载浮动入口`，无异常 |
| **界面渲染** | ✅ **真实浏览器截图** | headless Chrome 打开真实 DSH，点击后 656 字符面板文本 + `rects=9, polylines=1, circles=3, texts=6`； |
| 卸载路径 | ✅ | `ctx.effect` cleanup 干净撤回 |
| 本地 desktop profile | ✅ **零改动** | 全程未写入 |

### 两个只在真实运行时才暴露的 bug（离线预检全部漏掉）

1. **client 侧未声明 `inject`** → 插件完全不激活。
   框架在激活阶段就拒绝：`cannot get property "slots" without inject`，
   表现为「没有按钮」，且**我的代码一行都没执行**。
   修法：`const inject = ['slots']`。
2. **入口按钮绑在不存在的 slot 上** → 插件激活了但界面无入口。
   `conversation.session.header.utilities` 只在**打开会话后**才挂载，
   空态界面下永远不显示。
   修法：改为**自挂载浮动按钮**，不依赖任何 slot（同类插件 workbench 也是这个模式）。

> 教训：静态预检能验证逻辑，但**验证不了框架的激活契约与 DOM 挂载时机**。
> 真实浏览器跑一遍不可替代。


### ⚠️ 关键前提（隔离实验得出，务必注意）

**插件目录必须能被 Node 当作包解析到——即出现在某个 `node_modules` 里。**

| 条件 | host 侧 | **client bundle** |
|---|---|---|
| 目录在 `node_modules` 里 + 任意方式插入 | ✅ | ✅ **被物化** |
| 目录不在任何 `node_modules` 里（仅 `--patch` 绝对路径） | ✅ | ❌ **不被物化，界面无按钮** |

插入方式（`dsh.profile.bundles` 列表 vs `--patch` 覆盖层）**不影响**结果。

原因：client 模块发现要把插件当 npm 包解析（读其 `package.json` 的 `dsh.client`），
而 `file://` 绝对路径条目不构成一个可解析的包。

> **实验记录（2026-10-15）**：早期结论曾误判为"必须装成包、`--patch` 不行"。
> 那是因为"包在 node_modules"与"用 bundles 安装"两个变量绑在同一个实验里，未做隔离。
> 隔离后（只给前者、不给后者）client bundle 正常物化，证明 **`--patch` 方式完全可用**。

---

## 速度口径

`decodeTokens / decodeMs`（与 DSH 官方 `StatsPills` 同源）。日志里的 `llmMs` 含首字延迟与工具等待，用作分母会偏低；全部 token 当分子会因上亿缓存重发而荒谬。

## 限窗语义

`days` 是窗口**上限**而非保证长度：数据只跨 3 天时请求 7 天，应返回 3 天。
