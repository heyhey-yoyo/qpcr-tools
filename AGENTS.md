# qPCR 分析工具 — 项目说明（供 AI 编码代理阅读）

## 项目概览

这是一个纯前端静态网页 Demo：qPCR（实时荧光定量 PCR）孔板模板设计与 ΔCt / ΔΔCt 相对表达分析工具。无后端、无构建步骤、无任何 npm 依赖。数据完全在浏览器本地计算，不上传任何服务器。

视觉验收以工具主体正文 15px、操作标签不小于 12px 为基线；384 孔板紧凑注释可例外缩小。`YDchen Tools` 页眉结构与样式受保护，宽表和孔板只能在自身容器内横向滚动。

## 技术栈与运行架构

- 技术栈：原生 HTML + CSS + JavaScript ES Modules（`import`/`export`）。无框架、无打包器、无 npm 依赖
- 运行时：浏览器 `<script type="module">` 加载，需要 HTTP 服务器（`python -m http.server`）
- 缓存策略：`index.html` 中通过查询串 `?v=` 引用 CSS 和 JS，修改后需提升版本号
- 无 package.json — 测试通过 Node.js `.mjs` 文件直接运行，无需项目配置

## 项目结构

| 文件 | 作用 |
| --- | --- |
| `index.html` | 页面结构，中文 UI，4 步卡片流程 |
| `app.js` | 应用入口/协调器，ES module，全局事件绑定与状态管理 |
| `styles.css` | 全部样式（压缩风格，单行规则） |
| `core/` | 纯计算模块（无 DOM、无 localStorage、无全局变量） |
| `core/ct.js` | Ct 值校验：parseCt(), isValidCt(), filterValidCts() |
| `core/statistics.js` | 统计函数：mean(), sd(), sem(), spread(), rowStats() |
| `core/normalize.js` | 字符串归一化：normalizeKey() |
| `core/escape.js` | HTML/XML 转义：escapeHtml() |
| `core/ddct.js` | 核心分析：computeAnalysis() — ΔCt/ΔΔCt 纯计算 |
| `state/` | 状态管理模块 |
| `state/experiment.js` | 实验配置：组别/基因的稳定 ID 模型、CRUD、名称解析、display name 同步 |
| `state/migration.js` | localStorage 数据迁移（v3→v7），向后兼容旧版 |
| `ui/` | UI 渲染模块（读/写 DOM，但不访问全局变量） |
| `ui/render.js` | DOM 渲染：renderGroups, renderTargetGenes, renderRefGene, renderBlocks, renderPlateGrid, renderRows, renderResults, readBlocksFromDom, readRowsFromDom, buildAlertsHtml |
| `ui/charts.js` | SVG 图表生成（纯函数）：resultsChartSvg(), groupChartSvg() |
| `io/` | 输入/输出模块 |
| `io/import.js` | 数据导入：parseCtColumn()（罗氏单列 Ct 解析） |
| `io/export.js` | 数据导出：resultsCsv(), plateCsv(), downloadFile(), exportTemplateJson() |
| `test/` | 单元测试（Node.js ES module, .mjs） |
| `test/ct.mjs` | Ct 校验测试 |
| `test/ddct.mjs` | ΔΔCt 计算回归测试 |
| `test/migration.mjs` | localStorage 迁移测试 |
| `README.md` | 用户文档（中文） |
| `AGENTS.md` | 本文件：AI 代理文档 |

## 运行与构建

```bash
python -m http.server 8000
# → http://localhost:8000
```

> ES Module 需要 HTTP(S) 协议，`file://` 下无法使用。

## 测试

```bash
node test/ct.mjs        # Ct 校验测试
node test/ddct.mjs      # ΔΔCt 计算回归测试
node test/migration.mjs # 数据迁移测试
```

测试直接 `import` 模块，无需正则提取或 `eval()`。

## 代码组织与风格约定

### 数据模型（v7）

稳定 ID 体系：组别、目标基因和内参基因使用不可变 ID 关联，名称仅用于显示（组别 `g_xxx`、基因 `tg_xxx`、内参 `ref`）。

- 内部匹配使用 ID（对照组检测、内参检测、基因分组）
- 名称用于显示，通过 `resolveGroupName()` / `resolveGeneName()` 解析
- 改名时只更新 `name` 字段，ID 不变，已有数据关联不受影响
- 旧数据迁移：`migration.js` 按名称匹配恢复 ID，兼容 v3/v4/v5 格式

### Ct 校验

所有 Ct 数据入口统一调用 `parseCt(value)`：必须是有限数字，`0 < Ct ≤ 50`；NaN、空值、无穷大、负数、0、超过 50 均拒绝；无效值不参与计算，界面红色边框标记（CSS class `ct-invalid`）。

### 误差字段语义

- `techSem`：样本技术重复 SEM（ΔCt 层面，由目标+内参独立孔的 SD 传播）
- `bioSem`：对照组生物学重复 SEM，仅当对照组有 ≥2 个生物学样本时计算；单样本时 `bioSem = null`
- 图表误差棒 = `techSem`；对照组无误差棒
- `bioSem === null` 时 CSV 和界面显示为空或「—」，不显示为 0

### 两种分析模式

- `ddct`（相对表达量 2^-ΔΔCt）：以对照组为校准样本，按目标基因分别计算 ΔCt、ΔΔCt 和相对表达倍数
- `dct`（归一化表达量 2^-ΔCt）：仅以内参基因归一化

### 提交式设计（第一步改动暂存，刷新点板信息才提交）

- 第一步（实验配置 + 孔板设置）的任何结构改动都只暂存：`stagedDirty = true`（`markStaged()` 统一处理），预览上方显示「设计已变更」提示，不实时级联到区块表 / 孔位 / Ct 数据表
- 「刷新点板信息」（`loadPreset`）是唯一的提交入口：按当前实验配置 + 当前孔板设置调用 `buildTemplate()` 构建模板
  - 溢出检查：`generatePlacements().overflow` → alert 且保持原模板不变
  - 无条件确认：提交会清除当前所有孔位与已录入的 Ct 数据
  - 成功：`stagedDirty = false; refreshAll()`
- 改名（分组/基因/内参）同样只暂存，刷新后按新名字重建

### Blocks → Rows 单向同步

- 区块表（第二步）是唯一权威，Ct 数据表（第四步）只读跟随
- 第二步区块的任何编辑都会实时调用 `syncRowsFromBlocks()` 同步到第四步
- `syncRowsFromBlocks()` 通过匹配 `样本 + groupId + geneId` 保留已有 Ct 值，新行 Ct 为空
- Ct 数据表没有删除按钮：删除行只能通过删除对应区块完成

### 模板预设系统

- 刷新点板信息（`loadPreset`）：提交式入口，孔板容量不足则弹窗拒绝
- 功能演示（`exampleTemplate`）：4 组（NC/24H/48H/96H）× 3 目标基因（IL-1B/SP1/AKT）× 2 生物学重复，384 孔板时双份
- 生物学重复相邻排列（`bioGroupReplicates`）：仅复孔数 = 1 时显示
- 孔板比较组边界：虚线根据相邻孔位的 `clusterId` 绘制

### 模板导入/导出

- 导出模板：`exportTemplateJson()` 生成 JSON（含 version: 5, replicateCount, experiment, plate, blocks）
- 导入模板（`importTemplate`）：支持 version 1–5，自动恢复 experiment 配置和复孔数，旧版混合复孔数据降级处理

### Ct 数据导入

罗氏单列 Ct 粘贴（`parseCtColumn`）：检测并跳过标题行、缺失值行、孔位 ID 行，严格按孔位顺序填入，显示详细状态消息。

### 分析计算流程

1. `rowStats()` 对每行 Ct 值计算 mean/sd/spread/n
2. 合并重复「样本+组别+基因」记录（按字符串 key）
3. 按样本分组，配对目标基因与内参基因
4. 计算 ΔCt = targetCt − referenceCt，techSem（SD 传播）
5. 对照组统计：按基因分组计算平均 ΔCt，bioSem（≥2 样本时）
6. ΔΔCt = ΔCt − 对照组平均 ΔCt，相对表达量 = 2^−ΔΔCt
7. QC 判断：目标+内参的 Ct 极差均不超过阈值 且 n ≥ 2

### 图表

- `resultsChartSvg`：逐样本柱状图，保持传入顺序（rows 顺序 = 区块表顺序）。绿柱=通过，橙柱=需复核，误差棒为 techSem 换算的倍数区间
- `groupChartSvg`：分组汇总图（仅 ΔΔCt 模式 + 多基因时），按分组聚类，基因作为簇内彩色柱，单基因时自动隐藏

### QC 告警层级

`buildAlertsHtml()` 按优先级生成告警：无有效结果、重复记录已合并、单孔无技术重复、对照组缺基因数据、对照组 QC 失败、目标基因极差过大、内参基因极差过大、全部通过。单复孔记录（n<2）不参与 QC spread 警告。

### 持久化

- localStorage 键 `qpcr-demo-v7`（兼容 v3/v4/v5/v6 旧键的自动迁移）
- `save()` 在每次操作后调用，保存 experiment、blocks、rows、replicateCount、plate 设置、mode、spread
- `load()` 自动迁移旧格式数据（通过 `migrateState()`）
- 「恢复默认」（`resetBtn`）：清除所有 localStorage 键，重置所有状态为默认值

### 代码风格

- 2 空格缩进、单引号、行尾分号
- ES Module `import`/`export`
- 核心计算函数必须是纯函数（不读 DOM、localStorage 或全局变量）
- UI 渲染函数接收状态作为参数，不读取全局变量（但可以写 DOM、绑定事件）
- UI 文案、CSV 表头为中文；标识符为英文
- 所有插入 `innerHTML` 的用户输入必须经 `escapeHtml()` 转义
- `styles.css` 为压缩风格（多规则单行），修改时保持该风格
- 修改 `app.js` 或 `styles.css` 后同步提升 `index.html` 中的 `?v=` 版本号

## 部署

静态资源直接上传（Cloudflare Pages / Workers 等），无环境变量、无服务端代码。

## 标志维护约定

`YDchen Tools` 文字页眉是受保护的品牌区域，必须保持原结构、尺寸与样式；项目专属统一标志仅用于 favicon 或现有非页眉标志，不得改变页面布局。

---

## AI 维护提醒

> **⚠️ 任何修改此项目的 AI 代理都必须遵守：**
>
> - 修改代码后必须同步更新本文件与 README.md
> - README.md 面向人类用户，AGENTS.md 面向 AI 代理，两份文件不可互相替代
> - 新模块文件需在本文的文件结构中列出
> - localStorage 键升级需在 migration.js 中处理
> - 核心计算逻辑的修改需要更新 test/ddct.mjs
