# qPCR 孔板模板设计与 ΔΔCt 分析工具

一个**纯前端静态网页**：qPCR（实时荧光定量 PCR）孔板模板设计与 ΔCt / ΔΔCt 相对表达分析工具。数据完全在浏览器本地计算，无需后端、无需构建、无需安装。

## 主要功能

### 孔板模板设计
- **96 孔板**（8×12）与 **384 孔板**（16×24）切换
- 横向/纵向点板，可选起始孔位置
- 预设模板：3 孔（目标1/目标2/内参）、9 孔、12 孔（NC/处理）
- 模板可在现有布局后**连续追加**（样本编号自动递增），不覆盖已有区块
- 孔位排布可视化预览，点击空孔可设为模板起点

### Ct 数据录入
- **一键读取剪贴板**中的罗氏单列 Ct / Cp / Cq 数据
- 手动粘贴后点击"填入当前数据表"作为降级路径
- 支持 Ct、Cq、Cp 表头，兼容 Undetermined、No Ct、空行等缺失值

### 数据分析
- ΔCt / ΔΔCt 自动计算
- 2^-ΔΔCt / 2^-ΔCt 相对表达量
- **技术重复质控**（Ct 最大差值阈值检测）

### 导出与持久化
- 点板清单 CSV 导出
- 分析结果 CSV 导出（带 BOM，兼容 Excel）
- 全部状态自动保存到浏览器 localStorage

## 技术栈

原生 HTML + CSS + JavaScript（ES2020+），无框架、无打包器、无 npm 依赖，仅 4 个文件：

| 文件 | 用途 |
|------|------|
| `index.html` | 页面结构，中文 UI，4 步卡片流程 |
| `app.js` | 全部应用逻辑（约 880 行，单文件） |
| `styles.css` | 全部样式 |
| `README.md` | 本文件 |

## 本地运行

无需构建。任选其一：

- 直接用浏览器打开 `index.html`
- 或起静态服务器：`python -m http.server 8000` → 访问 `http://localhost:8000`

> ⚠️ Clipboard API 需要安全上下文（HTTPS 或 localhost），`file://` 协议下一键粘贴 Ct 将降级为手动粘贴。

## 部署

静态资源直接上传：

1. 确保根目录包含 `index.html`、`styles.css`、`app.js`、`README.md`
2. **Cloudflare Pages**：Workers & Pages → Create → Pages → Direct Upload
3. **Cloudflare Workers 静态资源**也可运行（`workers.dev` 域名）

## 数据与隐私

- 所有数据仅在浏览器本地处理，**不会上传至任何服务器**
- 状态仅存储在 `localStorage`，可随时清除
- 无任何网络请求或远程依赖

---

> 🤖 AI 编程代理请阅读 [AGENTS.md](./AGENTS.md) 了解代码架构、测试策略与开发约定。

---

## AI 维护提醒

> **⚠️ 任何修改此项目的 AI 代理（Claude Code、Cursor、Copilot 等）都必须同步更新本文件与 AGENTS.md。**
>
> - 新增功能 → 在 README 的"主要功能"章节中添加说明
> - 新增/删除文件 → 更新本文和 AGENTS.md 中的文件清单
> - 修改架构 → 更新 AGENTS.md 的架构说明
> - 部署方式变更 → 同步更新本文部署章节
> - 保持 **README 面向人类用户**，**AGENTS.md 面向 AI 代理**，两份文件不可互相替代
