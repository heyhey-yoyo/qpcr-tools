qPCR 网页 Demo（Cloudflare Pages / Workers 静态资源部署版）

本版新增：
- 96 孔板与 384 孔板切换
- 删除“9 孔目标 1 / 2 / 3”预设
- 保留 3 孔、9 孔（目标 1 / 目标 2 / 内参）、12 孔（NC / 处理）预设
- 模板可在现有布局后连续追加，不覆盖已有区块
- 可设置一次追加 1–24 份，样本编号自动递增
- 一键读取剪贴板中的罗氏单列 Ct / Cp / Cq
- 无法自动读剪贴板时，可手动粘贴后点击“填入当前数据表”
- 支持 Ct、Cq、Cp 表头和 Undetermined、No Ct、空行等缺失值
- Ct 值按照当前数据表及点板顺序依次填入
- 点板清单 CSV 与分析结果 CSV 导出
- ΔCt / ΔΔCt 和技术重复质控

部署：
1. 压缩包根目录应直接包含 index.html、styles.css、app.js 和 README.txt。
2. Cloudflare Pages：Workers & Pages → Create → Pages → Direct Upload。
3. Cloudflare Workers 静态资源上传也可运行，地址会是 workers.dev。
