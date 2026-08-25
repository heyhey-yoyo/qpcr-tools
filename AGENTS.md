# qPCR 分析工具 — 项目说明（供 AI 编码代理阅读）

## 项目概览

这是一个**纯前端静态网页 Demo**：qPCR（实时荧光定量 PCR）孔板模板设计与 ΔCt / ΔΔCt 相对表达分析工具。无后端、无构建步骤、无任何 npm 依赖。数据完全在浏览器本地计算，不上传任何服务器。

## 文件结构

```text
qpcr-tools/
├── index.html              # 页面结构，中文 UI，4 步卡片流程
├── app.js                  # 应用入口/协调器，ES module，全局事件绑定与状态管理
├── styles.css              # 全部样式（压缩风格，单行规则）
│
├── core/                   # 纯计算模块（无 DOM、无 localStorage、无全局变量）
│   ├── ct.js               # Ct 值校验：parseCt(), isValidCt(), filterValidCts()
│   ├── statistics.js       # 统计函数：mean(), sd(), sem(), spread(), rowStats()
│   ├── normalize.js        # 字符串归一化：normalizeKey()
│   ├── escape.js           # HTML/XML 转义：escapeHtml()
│   └── ddct.js             # 核心分析：computeAnalysis() — ΔCt/ΔΔCt 纯计算
│
├── state/                  # 状态管理模块
│   ├── experiment.js       # 实验配置：组别/基因的稳定 ID 模型、CRUD、名称解析、display name 同步
│   └── migration.js        # localStorage 数据迁移（v3→v7），向后兼容旧版
│
├── ui/                     # UI 渲染模块（读/写 DOM，但不访问全局变量）
│   ├── render.js           # DOM 渲染：renderGroups, renderTargetGenes, renderRefGene,
│   │                       #   renderBlocks, renderPlateGrid, renderRows, renderResults,
│   │                       #   readBlocksFromDom, readRowsFromDom, buildAlertsHtml
│   └── charts.js           # SVG 图表生成（纯函数）：resultsChartSvg(), groupChartSvg()
│
├── io/                     # 输入/输出模块
│   ├── import.js           # 数据导入：parseCtColumn()（罗氏单列 Ct 解析）
│   └── export.js           # 数据导出：resultsCsv(), plateCsv(), downloadFile(), exportTemplateJson()
│
├── test/                   # 单元测试（Node.js ES module, .mjs）
│   ├── ct.mjs              # Ct 校验测试
│   ├── ddct.mjs            # ΔΔCt 计算回归测试
│   └── migration.mjs       # localStorage 迁移测试
│
├── README.md               # 用户文档（中文）
└── AGENTS.md               # 本文件：AI 代理文档
```

## 技术栈与运行架构

- **技术栈**：原生 HTML + CSS + JavaScript ES Modules（`import`/`export`）。无框架、无打包器、无 npm 依赖。
- **运行时**：浏览器 `<script type="module">` 加载，需要 HTTP 服务器（`python -m http.server`）。
- **缓存策略**：`index.html` 中通过查询串 `?v=` 引用 CSS 和 JS，修改后需提升版本号。
- **无 package.json** — 测试通过 Node.js `.mjs` 文件直接运行，无需项目配置。

## 本地运行

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

## 数据模型（v7）

### 稳定 ID 体系

组别、目标基因和内参基因使用不可变 ID 关联，名称仅用于显示：

```javascript
// 实验配置
experiment = {
  groups: [{ id: 'g_xxx', name: 'NC', compareToGroupId: null }, ...],
  targetGenes: [{ id: 'tg_xxx', name: 'IL6' }, ...],
  refGene: { id: 'ref', name: 'GAPDH' },    // 内参基因，ID 固定为 'ref'
  biologicalReplicates: 1
}

// 区块（同时存储 ID 和显示名称）
block = { groupId: 'g_xxx', group: 'NC', geneId: 'tg_xxx', gene: 'IL6', ... }

// 数据行
row = { groupId: 'g_xxx', group: 'NC', geneId: 'tg_xxx', gene: 'IL6', cts: [...], ... }
```

- **内部匹配**使用 ID（对照组检测、内参检测、基因分组）。
- **名称用于显示**，通过 `resolveGroupName()` / `resolveGeneName()` 解析。
- **改名**时只更新 `name` 字段，ID 不变，已有数据关联不受影响。
- **旧数据迁移**：`migration.js` 按名称匹配恢复 ID，兼容 v3/v4/v5 格式。

### Ct 校验

所有 Ct 数据入口统一调用 `parseCt(value)`，规则：
- 必须是有限数字，`0 < Ct ≤ 50`
- NaN、空值、无穷大、负数、0、超过 50 均拒绝
- 无效值不参与计算，在界面上红色边框标记（CSS class `ct-invalid`）
- Ct 输入框即时校验：每次 `input` 事件都调用 `parseCt()` 并更新视觉状态

```javascript
parseCt(50)      // → { valid: true, value: 50 }
parseCt(50.01)   // → { valid: false, value: null }
parseCt('25.12') // → { valid: true, value: 25.12 }
```

### 误差字段语义

- `techSem`：样本技术重复 SEM（ΔCt 层面，由目标+内参独立孔的 SD 传播）
- `bioSem`：对照组生物学重复 SEM。仅当对照组有 ≥2 个生物学样本时计算；单个生物学样本时 `bioSem = null`，不使用技术重复 SEM 代替
- 图表误差棒 = `techSem`（仅样本技术重复误差）
- 对照组无误差棒，CSV 中显式标记"技术重复SEM（ΔCt层面，不含对照均值误差）"
- `bioSem === null` 时 CSV 和界面显示为空或"—"，不显示为 0

### 两种分析模式

- **ddct**（相对表达量 2^-ΔΔCt）：以对照组为校准样本，按目标基因分别计算 ΔCt、ΔΔCt 和相对表达倍数
- **dct**（归一化表达量 2^-ΔCt）：仅以内参基因归一化，计算每个样本的 ΔCt 和 2^-ΔCt

## 关键行为

### 实验配置管理

- **分组芯片**（`renderGroups`）：每个分组渲染为 chip 组件，显示名称 + "改"按钮 + 比较基准下拉选择 + "基准"徽章（baseline 组）+ 删除按钮（仅 >1 组时显示）
- **目标基因芯片**（`renderTargetGenes`）：每个基因渲染为 chip，显示名称 + "改"按钮 + 删除按钮（仅 >1 个时显示）。添加按钮在达到孔板上限时自动禁用
- **内参基因芯片**（`renderRefGene`）：显示名称 + "改"按钮 + "内参"徽章
- **生物学重复数**：独立 `<input>` 控件，范围 1–24
- **技术复孔数**：全局 `<input>` 控件，范围 1–6。修改只暂存（`replicateCount`），点击"刷新点板信息"时随模板一起生效；提交时若会截断已录入 Ct 会弹确认

### 提交式设计（第一步改动暂存，刷新点板信息才提交）

- 第一步（实验配置 + 孔板设置）的任何结构改动都**只暂存**：`stagedDirty = true`（`markStaged()` 统一处理：置位 + `renderPlate()` + `save()`），预览上方显示"设计已变更"提示，**不实时级联**到区块表 / 孔位 / Ct 数据表
- **"刷新点板信息"（`loadPreset`）是唯一的提交入口**：按当前实验配置 + 当前孔板设置（起始孔/方向/空孔，不再重置为 A1）调用 `buildTemplate()` 构建模板
  - 溢出检查：`generatePlacements().overflow` → alert 且保持原模板不变
  - 无条件确认：提交会清除当前所有孔位与已录入的 Ct 数据（`rows = []` 清空后经 `syncRowsFromBlocks` 重建全部空白行），确认框明示此后果，取消则放弃提交
  - 成功：`stagedDirty = false; refreshAll()`
- **改名（分组/基因/内参）同样只暂存**：不实时同步到已生成的模板与 Ct 数据表（界面会暂时显示新旧混合名称，改名输入框文案与预览上方的"设计已变更"提示会提醒点击"刷新点板信息"后生效）。样本名由 `组名-BioRepN` 生成，刷新时按新名字重建
- 删除分组/基因只删实验配置，**不级联删除** blocks/rows；旧区块保留到下次提交时按新配置重建（确认文案中有说明）

### Blocks → Rows 单向同步

- **区块表（第二步）是唯一权威**，Ct 数据表（第四步）只读跟随
- 第二步区块的任何编辑（样本/组别/基因名称修改、添加、删除、移动、"另起一行"）都会实时调用 `syncRowsFromBlocks()` 同步到第四步
- `syncRowsFromBlocks()` 通过匹配 `样本 + groupId + geneId` 保留已有 Ct 值，新行 Ct 为空
- **Ct 数据表没有删除按钮**：删除行只能通过删除对应区块完成（`removeBlock` 同步 `rows.splice(index, 1)`）
- 后续步骤（2–5）的操作不影响第一步的实验配置

### 模板预设系统

- **刷新点板信息**（`loadPreset`）：提交式入口。按当前实验配置 + 当前孔板设置（起始孔/方向/空孔，不重置）调用 `buildTemplate()` 生成模板。孔板容量不足则弹窗拒绝、模板保持不变；确认后清除当前所有孔位与已录入 Ct 数据，直接重建（不保留旧匹配的 Ct）
- **功能演示**（`exampleTemplate`）：4 组（NC/24H/48H/96H）× 3 目标基因（IL-1B/SP1/AKT）× 2 生物学重复，384 孔板时双份。载入前有溢出检查，失败时恢复演示前状态
- **生物学重复相邻排列**（`bioGroupReplicates`）：仅复孔数 = 1 时显示，勾选后同一基因的生物学重复排列在相邻孔位
- **孔板比较组边界**：孔板预览虚线根据相邻孔位的 `clusterId` 绘制（如 N1T1 与 N2T2），仅分隔不同比较组；孔间默认间距已加大（96孔板 10px，384孔板 8px），虚线自然落在间距中间

### 模板导入/导出

- **导出模板**：`exportTemplateJson()` 生成 JSON（含 version: 5, replicateCount, experiment, plate, blocks）
- **导入模板**（`importTemplate`）：支持 version 1–5，自动恢复 experiment 配置和复孔数，导入成功后同步刷新孔板预览与 Ct 数据表，旧版混合复孔数据降级处理

### Ct 数据导入

- **罗氏单列 Ct 粘贴**（`parseCtColumn`）：从剪贴板读取或手动粘贴。检测并跳过标题行（Ct/Cq/Cp/Ct Value 等）、缺失值行（Undetermined/No Ct/N/A 等）、孔位 ID 行。严格按孔位顺序从上到下依次填入。显示详细状态消息（填入数/剩余数/多出数/跳过数）

### 分析计算流程

1. `rowStats()` 对每行 Ct 值计算 mean/sd/spread/n
2. 合并重复"样本+组别+基因"记录（按字符串 key）
3. 按样本分组，配对目标基因与内参基因
4. 计算 ΔCt = targetCt − referenceCt，techSem（SD 传播）
5. 对照组统计：按基因分组计算平均 ΔCt，bioSem（≥2 样本时）
6. ΔΔCt = ΔCt − 对照组平均 ΔCt，相对表达量 = 2^−ΔΔCt
7. QC 判断：目标+内参的 Ct 极差均不超过阈值 且 n ≥ 2

### 图表

- **resultsChartSvg**：逐样本柱状图，保持传入顺序（rows 顺序 = 区块表顺序，与孔板排版一致），不重新排序。绿柱=通过，橙柱=需复核。误差棒为 techSem 换算的倍数区间。长名称截断+悬停全名
- **groupChartSvg**：分组汇总图（仅 ΔΔCt 模式 + 多基因时）。按分组聚类（组簇顺序 = 结果中组首次出现顺序，即板上顺序），基因作为簇内彩色柱。顶部显示基因图例。单基因时自动隐藏

### QC 告警层级

`buildAlertsHtml()` 按优先级生成 HTML 告警：
1. 无有效结果 → warning
2. 重复记录已合并 → warning
3. 单孔无技术重复 → warning
4. 对照组缺基因数据 → danger
5. 对照组 QC 失败（优先复核） → danger
6. 目标基因极差过大 → warning
7. 内参基因极差过大 → warning
8. 全部通过 → success

单复孔记录（n<2）不参与 QC spread 警告。

### 持久化

- localStorage 键 `qpcr-demo-v7`（兼容 v3/v4/v5/v6 旧键的自动迁移）
- `save()` 在每次操作后调用，保存 experiment、blocks、rows、replicateCount、plate 设置、mode、spread
- `load()` 自动迁移旧格式数据（通过 `migrateState()`）
- "恢复默认"（`resetBtn`）：清除所有 localStorage 键，重置所有状态为默认值

## 代码风格

- 2 空格缩进、单引号、行尾分号
- ES Module `import`/`export`
- 核心计算函数必须是纯函数（不读 DOM、localStorage 或全局变量）
- UI 渲染函数接收状态作为参数，不读取全局变量（但可以写 DOM、绑定事件）
- UI 文案、CSV 表头为中文；标识符为英文
- 所有插入 `innerHTML` 的用户输入必须经 `escapeHtml()` 转义
- `styles.css` 为压缩风格（多规则单行），修改时保持该风格
- 工具主体采用 `ydchen-portfolio` 的米白 / 浅灰 / 赤陶色视觉系统；`YDchen Tools` 页眉结构与样式保持不变
- 修改 `app.js` 或 `styles.css` 后同步提升 `index.html` 中的 `?v=` 版本号

## 部署

静态资源直接上传（Cloudflare Pages / Workers 等），无环境变量、无服务端代码。

## 数据与隐私

- 所有数据仅在浏览器本地处理，不上传任何服务器
- 状态存储在 `localStorage`（键 `qpcr-demo-v7`，兼容 `qpcr-demo-v6`/`v5`/`v4`/`v3`）
- 无网络请求或远程依赖

---

## AI 维护提醒

> **⚠️ 任何修改此项目的 AI 代理都必须遵守：**
>
> - **修改代码后必须同步更新本文件与 README.md**
> - README.md 面向人类用户，AGENTS.md 面向 AI 代理，两份文件不可互相替代
> - 新模块文件需在本文的文件结构中列出
> - localStorage 键升级需在 migration.js 中处理
> - 核心计算逻辑的修改需要更新 test/ddct.mjs
