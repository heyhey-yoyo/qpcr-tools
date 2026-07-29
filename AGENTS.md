# qPCR 分析工具 — 项目说明（供 AI 编码代理阅读）

## 项目概览

这是一个**纯前端静态网页 Demo**：qPCR（实时荧光定量 PCR）孔板模板设计与 ΔCt / ΔΔCt 相对表达分析工具。无后端、无构建步骤、无任何 npm 依赖，整个项目只有 4 个文件，全部位于仓库根目录：

| 文件 | 作用 |
| --- | --- |
| `index.html` | 页面结构，中文 UI（`lang="zh-CN"`），分 4 个步骤卡片：设计孔板模板 → 设置分析参数 → 录入 Ct 数据 → 分析结果 |
| `app.js` | 全部应用逻辑（约 880 行，单文件、无模块系统、无框架），直接在浏览器全局作用域运行 |
| `styles.css` | 全部样式，使用 CSS 自定义属性（`--primary` 等），以 minified/压缩风格书写（多规则单行） |
| `README.txt` | 中文的变更说明与部署说明 |

主要功能：

- 96 孔板（8×12）/ 384 孔板（16×24）模板设计，支持横向/纵向点板、起始孔、区块间空孔、“另起一行”、预设模板连续追加（样本编号自动递增）
- 孔位排布预览图（`renderPlate` / `generatePlacements`），点击空孔可设为模板起点
- 一键读取剪贴板中的罗氏单列 Ct / Cp / Cq 数据（`navigator.clipboard.readText`），失败时降级为手动粘贴（`parseCtColumn` / `applyCtColumnText`），支持 Ct/Cq/Cp 表头与 Undetermined、No Ct 等缺失值
- ΔCt / ΔΔCt 计算、2^-ΔΔCt / 2^-ΔCt 相对表达量、技术重复质控（Ct 最大差值阈值，`calculate`）
- 点板清单 CSV 与分析结果 CSV 导出（带 BOM，便于 Excel 打开）
- 全部状态持久化到浏览器 `localStorage`（键 `qpcr-demo-v4`，兼容旧键 `qpcr-demo-v3`）

## 技术栈与运行架构

- **技术栈**：原生 HTML + CSS + JavaScript（ES2020+ 语法，如 `replaceAll`、可选链、逻辑赋值 `||=`）。无框架、无打包器、无转译。
- **运行时**：完全在浏览器端运行。数据仅在本地计算，不会上传服务器；状态存 `localStorage`。
- **配置/清单文件**：**不存在** `package.json`、`pyproject.toml`、`Cargo.toml` 等任何配置或依赖清单文件，也没有 CI 配置。
- **缓存策略**：`index.html` 中通过查询串 `?v=4.1` 引用 `styles.css` 和 `app.js`，修改这两个文件后需同步提升该版本号以避免浏览器缓存。

## 本地运行与构建

无构建过程。本地预览任选其一：

- 直接用浏览器打开 `index.html`（注意：Clipboard API 需要安全上下文，`file://` 下“一键粘贴单列 Ct”可能不可用，会降级为手动粘贴）
- 或起一个静态服务器，例如在项目根目录运行 `python -m http.server` 后访问 `http://localhost:8000`

## 测试

- **项目没有测试框架、没有测试文件、没有 lint/格式化配置。**
- 验证方式：本地打开页面，人工走完四步流程（载入预设 → 应用到 Ct 数据表 → 粘贴示例/单列 Ct → 检查结果与 CSV 导出）。页面内置“示例 Ct 数据”按钮可用于快速自检。
- 修改 `app.js` 后至少应检查：浏览器控制台无报错、刷新后 localStorage 状态能正确恢复（`load()` 中所有字段都有兜底默认值，新增持久化字段时务必同样处理）。

## 代码组织（`app.js`）

单文件、按功能分段的函数式结构，无模块导入。关键区段：

- 顶部常量与 DOM 引用：`KEY`/`LEGACY_KEY`、`MAX_REPS`、`PLATES`、`els`、`presets`、`exampleRows`
- 工具函数：`clone`、`escapeHtml`、`fmt`、`mean`、`stats`
- 模板区块 CRUD：`renderBlocks` / `readBlocks` / `moveBlock` / `removeBlock` / `appendPreset` / `uniqueSampleName`
- 孔板布局：`generatePlacements`（核心排布算法）、`parseWell`、`renderPlate`、`applyPlateToRows`
- Ct 数据表：`renderRows` / `readRows` / `rowSlotCount` / `parseFullTable`（整表粘贴）
- 单列 Ct 粘贴：`parseCtColumn` / `applyCtColumnText` / `pasteCtColumnFromClipboard`
- 计算与结果：`calculate`（ΔCt/ΔΔCt/质控）、`renderResults`
- 导出：`resultsCsv` / `plateCsv` / `csvCell` / `downloadCsv`
- 底部：所有事件绑定与初始化调用（`refreshCoordinateSelects` → `load` → `renderBlocks` → `renderPlate` → `renderRows` → `calculate`）

全局可变状态只有三个：`blocks`（模板区块）、`rows`（Ct 数据行）、`latest` / `latestPlate`（最近一次计算结果）。典型数据流是「渲染函数重建 innerHTML → 给新元素绑定事件 → 输入事件触发 read* 函数把 DOM 读回状态 → 重新计算并 `save()`」。

## 代码风格约定

- `app.js` 开头 `'use strict';`，2 空格缩进、单引号、行尾分号，函数声明式（`function foo()`），箭头函数用于短回调。
- UI 文案、alert、CSV 表头均为**中文**；标识符（变量/函数名）为英文。`app.js` 中少量注释为英文，README 与页面文档为中文——新增面向用户的文案请用中文。
- 所有插入 `innerHTML` 的用户输入必须经 `escapeHtml()` 转义；新增渲染代码请沿用此约定。
- `styles.css` 为压缩风格（多条规则写在同一行），修改时保持该风格，不要重新格式化整个文件。
- 表单控件的事件监听通常同时绑 `input` 和 `change`；任何状态变更后调用 `save()` 持久化。

## 部署

静态资源直接上传即可（见 `README.txt`）：

- **Cloudflare Pages**：Workers & Pages → Create → Pages → Direct Upload，上传根目录（须直接包含 `index.html`、`styles.css`、`app.js`、`README.txt`）。
- **Cloudflare Workers 静态资源**上传同样可用（`workers.dev` 域名）。
- 无环境变量、无服务端代码、无构建产物目录。

## 安全与数据注意事项

- 数据不出浏览器：仅 `localStorage` 持久化，无任何网络请求。不要引入会上传数据的功能。
- 依赖浏览器 API：`navigator.clipboard`（需用户授权/安全上下文）、`URL.createObjectURL`。剪贴板读取失败有降级路径，改动时请保留。
- localStorage 读取有版本键迁移（v3 → v4）和 try/catch 兜底；修改存储结构时保持向后兼容或升级 `KEY`。
