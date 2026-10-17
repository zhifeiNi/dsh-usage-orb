# dsh-usage-orb

[![ci](https://github.com/zhifeiNi/dsh-usage-orb/actions/workflows/ci.yml/badge.svg)](https://github.com/zhifeiNi/dsh-usage-orb/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> 截图将在发布时用脱敏数据补充（现仓库不含含个人数据的截图）。

DSH 右侧栏面板：**跨会话用量趋势**（token / 缓存命中率 / 轮次，含模型拆分）。

DSH 自带的用量胶囊只显示**当前会话**的账；本插件读取全部会话文件做跨会话聚合，
补上"这周一共用了多少""缓存命中率趋势如何"这类原生给不了的视图。

---

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



### 已实现功能

- **六张指标卡**：合计 token、缓存命中率、解码速度、平均首字延迟、轮次/步数、LLM 累计时长
- **按天趋势图**（纯 SVG 手绘，零图表库）：堆叠柱（未缓存输入 / 缓存读取 / 输出）+ 缓存命中率折线
- **按模型拆分**：横向占比条
- **四类 token 口径表**：未缓存输入 / 缓存读取 / 缓存写入 / 输出 + 合计
- **最新会话列表**：时间、模型、token 数、轮次
- **刷新按钮**、加载态、错误态（保留上次数据）
- 数据来源与统计口径在面板底部如实标注

### 三个修复过的真实缺陷（记录以免重犯）

1. **速度口径错误**：先用 `输出token / llmMs`（分母含 ttft 与工具等待）得 145 tok/s，
   人为偏低；又改 `全部token / llmMs`（分子含上亿缓存重发）得荒谬的 66,254 tok/s。
   **正确算法是 `decodeTokens / decodeMs`**，与 DSH 官方 `StatsPills` 同源，得 227.6 tok/s。
2. **profile JSON 的 BOM**：PowerShell 5.1 的 `Set-Content -Encoding UTF8` 会写入 BOM，
   DSH 的 JSON 解析器直接报 `Unexpected token '﻿'`。写 profile 文件必须用无 BOM 的 UTF-8。
3. **限窗语义**：`days` 是窗口**上限**而非保证长度——数据只跨 3 天时请求 7 天应返回 3 天，
   不能凭空补出未来日期。（我的测试一度断言错误，是测试的问题。）


> **重要发现（2026-10-15）**：本机 `pnpm` 不可用。corepack 缓存的
> `pnpm/12.10.1` 是原生二进制发行版（`bin/` 内只有 `pnpm.mjs`），
> 但 corepack 与 DSH 都在找 `pnpm.cjs`，两者路径不一致，
> 导致 `dsh plugin add` 必然失败并报
> `Cannot find module '...\corepack\v1\pnpm\12.10.1\bin\pnpm.cjs'`。
> DSH 运行时自带的 pnpm 11.7.0（`~/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm`）
> 本身是完好的。**该问题与插件无关，但会阻断一切插件安装。**


---

## 目录结构

```
D:\path\to\dsh-usage-orb\
├── package.json         插件元数据（dsh.bundle / dsh.client / peerDependencies）
├── cordis.patch.yml     叠加层：把插件插入 Loader
├── lib\
│   ├── index.js         host 侧：读会话文件、聚合四类 token
│   └── client.js        client 侧：右侧栏按钮 + 自建面板（手写 CJS，无需打包）
└── README.md
```

**零依赖、零构建步骤**：两端都只使用 Node 内置模块和宿主提供的 `react`。
不需要 `pnpm install`，不需要编译。

---

## 如何安装（只需一个链接，不改任何配置文件）

因为上面那条前提，唯一需要的一步是：**把本目录链接进目标 profile 的 `node_modules`**。

```powershell
$profile = "$env:USERPROFILE\.dsh\profiles\desktop"   # 换成你要用的 profile
New-Item -ItemType Directory -Path "$profile\node_modules" -Force | Out-Null
cmd /c mklink /J "$profile\node_modules\dsh-usage-orb" "D:\path\to\dsh-usage-orb"
```

**然后按约束 (2) 的方式启动——不改 `package.json`、不动 profile 配置：**

```powershell
& "<DSH 安装目录>\DeepSeek Harness.exe" --patch "D:\path\to\dsh-usage-orb\cordis.patch.yml"
```

- 插件实体仍在 `D:\path\to\dsh-usage-orb`，**没有进入 profile**
- 那个 junction 是**纯链接、0 字节**，删掉即彻底还原
- 若想改用 `dsh.profile.bundles` 安装（需改 `package.json`），见下方方式二

### 方式二：正式安装（需改 profile 的 package.json）

在 `dependencies` 与 `dsh.profile.bundles` 里各加一项：

```json
{
  "dependencies": { "dsh-usage-orb": "link:/path/to/dsh-usage-orb" },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-usage-orb"]
    }
  }
}
```

> ⚠️ **必须写成无 BOM 的 UTF-8**。PowerShell 5.1 的 `Set-Content -Encoding UTF8`
> 会写入 BOM，DSH 的 JSON 解析器会直接报 `Unexpected token '﻿'` 并拒绝启动。
> 用 Node 写，或用能保证无 BOM 的编辑器。

### 方式三：pnpm 修好后用官方命令

```powershell
dsh plugin --profile <name> add <本仓库路径>
```

但目前**本机 pnpm 不可用**（见下方"环境问题"），这条命令会失败。

### 卸载

```powershell
cmd /c rmdir "$profile\node_modules\dsh-usage-orb"   # 先断链接，避免误删插件源码
# 若用过方式二，再从 package.json 里移除那两项声明
```



---

## 预期现象

启动后：

1. **宿主日志**里出现两行：
   ```
   [dsh-usage-orb] host 侧已加载
   [dsh-usage-orb] 自检：扫描 12 个会话文件，采用 9 个，跳过 3 个；合计 857218617 tokens，缓存命中率 99.63%，模型 1 个，有日期的 2 天
   ```
   看到这两行 = host 侧活着、数据读取正确。

2. **对话区顶部工具栏**（复制/点赞/分支按钮那一排）右侧出现一个 **「用量」** 按钮。

3. **点它** → 右上角出现一个固定定位面板，写着"链路已打通"，并显示插件 id、
   React 版本、加载时间。

---

## 排错

| 现象 | 说明 |
|---|---|
| 日志里没有 `[dsh-usage-orb]` | 插件没被加载。检查 patch 路径是否正确、文件是否存在 |
| 有 host 日志但界面没有「用量」按钮 | host 活了但 client bundle 没被物化。最可能是 client 模块发现失败（见下方"已知风险"） |
| 按钮在但点击没反应 | panel host 挂载失败；看浏览器控制台（Ctrl+Shift+I）的报错 |

---

## 已知风险

1. **client 模块的发现机制未实测**。DSH 的 `ctx.clientModules` 扫描 Loader entry 找出声明
   `dsh.client` 的包。我们的插件在 profile 之外、通过 `--patch` 以绝对路径插入，
   其 `package.json` 里的 `dsh.client` **是否会被扫描到尚未验证**。
   若未生效，退路是改成"安装进 profile"的分发方式（`dsh.bundle` + `dsh plugin add`）。

2. **`conversation.session.header.utilities` 这个 slot 名来自第三方插件
   `dsh-ui-workbench` 的实践**，不是从官方文档直接抄的。若该 slot 名在你的版本里不同，
   按钮不会出现——需要按官方 `ui-sidebar-right` 文档改用 `ctx.sidebarRightTabs.register()`。

3. **面板用固定定位自挂载**（借鉴 workbench 的做法），不占用官方 dock 布局。
   好处是链路短、不易冲突；代价是不会参与官方的分栏/全屏切换。

---

## 数据口径

严格沿用 DSH 自己的四类 token 口径，与官方胶囊一致：

```
未缓存输入  uncachedInputTokens   按全价计费的部分
缓存读取    cacheReadTokens       命中缓存的部分
缓存写入    cacheWriteTokens      写入缓存的部分
输出        outputTokens          模型生成的部分

缓存命中率 = 缓存读取 / (未缓存输入 + 缓存读取)
```

**绝不把不同来源的口径相加**——这是从 DSH 官方用量面板学到的原则。

### 实测数据（截至 2026-10-15）

```
扫描 12 个会话文件，采用 9 个
未缓存输入  3,197,603
缓存读取    852,143,488
缓存写入    0
输出        1,877,526
合计        857,218,617
缓存命中率  99.63%
轮次/步数   110 / 1,925
```

**注意 99.63% 的缓存命中率**：这意味着上下文重发几乎全部走缓存价，
真正的全价输入只有约 320 万 token。用量成本几乎完全由缓存命中率决定。

---

## 安装

本插件**不是独立的 npm 库**，它运行在 DeepSeek Harness（DSH）桌面端内部，所以安装分三步：

```bash
# ① 在 DSH 的 profile 里登记为本地依赖（以 desktop profile 为例）
#    ~/.dsh/profiles/desktop/package.json
#    "dependencies": { "dsh-usage-orb": "link:D:/path/to/dsh-usage-orb" }

# ② 同一文件里把它加入 bundles，DSH 才会加载它
#    "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-usage-orb"] } }

# ③ 建软链接（Windows 用 mklink /J，类 Unix 用 ln -s）
#    ~/.dsh/profiles/desktop/node_modules/dsh-usage-orb  ->  你的仓库目录
```

> **两种装法的差异**：本地 link 安装时，`cordis.patch.yml` 里的 `name` 必须是可解析的
> 绝对路径（仓库里保留的是开发者本机路径，请改成你自己的仓库路径）；用
> `dsh plugin add` 从 npm/GitHub 安装时，把那一行改成包名 `dsh-usage-orb`。

然后**完全退出并重启 DSH**。右下角出现浮动按钮即安装成功。

## 隐私

- **只读本地**：会话日志（`~/.dsh/storages/` 下的 `*.jsonl`）、插件自己的
  `~/.dsh/usage-panel/` 缓存（余额水位 / 布局偏好 / 报错记录）
- **不联网、无遥测、不上传任何数据**；没有任何第三方统计
- 余额通过 DSH 自己的 `deepseekAccount` 服务读取，**本插件不存储凭据**
- 想彻底重置：删除 `~/.dsh/usage-panel/` 即可

## 免责与兼容性

- **非官方插件**，与 DeepSeek、x.ai 均无隶属、背书或关联关系
- 数据口径依赖 DSH 的**内部实现**（事件流中的 usage 字段、`*.jsonl` 布局）
  → **DSH 升级后可能失效**，届时以新版为准修复
- 按 MIT 提供，**无任何担保**；统计数字仅供观察，不作为账单依据

## 已知限制

- 网页搜索触发的 LLM 调用不计入统计（面板会显式提示"未计入"）
- 余额需要账户服务可用；不可用时静默降级为"仅用量"
- bloub 机器人面孔是**可选外观、默认关闭**（默认使用项目自带图标），
  其代码许可与**设计归属**说明见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)
- 兼容性以 `package.json` 的 `peerDependencies` 为准

## 致谢

- **[bloub](https://github.com/jeremy-prt/bloub)**（MIT，© 2026 Jérémy Perret）——
  机器人表情引擎与几何测量数据。上游声明与 x.ai 无关联，且 MIT 仅覆盖代码、不覆盖其模仿的设计。

## 开发与测试

```bash
npm test          # 三个离线套件（~1 秒，不依赖网络与真实数据，CI 跑这个）
npm run test:e2e  # 端到端：启动真实 DSH + headless Chrome
```

> ⚠️ `test:e2e` **会改动你的环境**：克隆 `~/.dsh/profiles/desktop` 到临时 profile、
> 结束相关进程、写入 `~/.dsh/usage-panel/`，并需要本机已安装 DSH 桌面端
> （可用 `DSH_EXE` / `DSH_APP_ROOT` / `DSH_E2E_OUT` 覆盖路径）。只在你自己的机器上跑。

## 许可

[MIT](LICENSE)。第三方组件与设计归属见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
