# 第三方声明 / Third-party notices

本插件以 MIT 许可发布。以下组件来自第三方，各自遵循其原许可。

---

## bloub — x.ai bot avatar 的 SVG 复刻

| 项 | 内容 |
|---|---|
| 上游 | https://github.com/jeremy-prt/bloub |
| 作者 | Jérémy Perret |
| 许可 | MIT（Copyright (c) 2026 Jérémy Perret） |
| 本仓库中的位置 | `lib/bloub-engine.js` |

`lib/bloub-engine.js` 由上游表情引擎（`src/bot/`，框架无关、无时钟的纯时间函数）
机械抽取并适配为可内联模块：只做了封装与导出改动，**未改动其几何、表情参数与插值常量**。
上游 README 记录这些数值是"对参考视频逐帧测量得到的测量值"，改动会失去相似度，故保持原样。

### 上游 MIT 许可全文

```
MIT License

Copyright (c) 2026 Jérémy Perret

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 关于设计归属（重要）

上游 README 原文：

> Not affiliated with, endorsed by or connected to x.ai. It recreates the visual
> behaviour of their bot avatar as an exercise; "Grok" and "x.ai" belong to their
> owners. **The MIT licence covers the code in this repository, not the design it
> imitates.**

即：**MIT 覆盖代码，不覆盖它所模仿的设计**。"Grok" 与 "x.ai" 归其各自所有者。

本插件的立场与上游一致：
- bloub 面孔是**可选外观，默认关闭**（默认使用项目自带图标）
- 与 x.ai / DeepSeek 均无隶属、背书或关联关系
- 如果你要在其他产品中使用这套外观，请自行评估设计层面的权利

### 抽取链说明

本仓库的引擎最初由一份本地 HTML 移植版（`bloub-expressions/index.html`）抽出，其上游即上表项目。
如需追溯许可与出处，**以上游仓库为准**。
