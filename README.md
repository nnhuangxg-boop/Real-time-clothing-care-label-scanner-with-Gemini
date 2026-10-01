# 衣签 · 洗护扫描

手机浏览器实时扫描衣服洗护标签，通过 Gemini 识别文字和符号。中文 / 英文界面，无需拍照，无需注册；支持用户临时填写自己的 Gemini API Key。

## 本地运行

需要 Node.js 24。复制 `.env.example` 为 `.env.local`，填写服务端 Gemini Key，然后运行：

```sh
npm ci
npm run dev
```

打开 `http://127.0.0.1:4317/`。本地使用 SQLite，统计页为 `/admin`，仅接受本机连接。手机摄像头需要 HTTPS。

## Vercel + Neon

`api/index.mjs` 为 Vercel 入口，`scripts/postgres-store.mjs` 保存额度和统计。Neon 与 Vercel Function 都放在美国东部。部署设置见 `vercel.json`。

生产环境变量：`GEMINI_API_KEY`、`GEMINI_MODEL`、`DATABASE_URL`、`IDENTITY_SECRET`（随机至少 32 字符）、`ADMIN_PASSWORD`（随机至少 32 字符）。全部由服务端读取，不能放进前端或公开仓库。密码和身份签名密钥应设为 Vercel Secret。预览环境应连接独立测试数据库。

首次部署前，在已安全加载环境变量的终端运行 `node scripts/migrate.mjs` 初始化表。之后运行 `vercel --prod`。正式后台位于 `/admin`，用户名 `admin`，密码为 `ADMIN_PASSWORD`。

## 额度与隐私

浏览器累计 10 次、IP 每日 30 次、全站每日 200 次；按 UTC 重置每日额度。数据库事务和全局事务锁避免并发超发。确认 Gemini 超时后退回浏览器次数，IP / 全站仍记录实际请求。用户自带 Key 不受这三档限制。

只记录匿名浏览器标识、加密散列 IP、调用来源、结果状态、耗时、模型与 token 用量。不保存用户 Key、标签图片或识别原文。用户 Key 仅存在当前页面内存中，经服务端转发给 Google；刷新即清除。

## 验证与发布准备

运行 `npm test`。密钥、本地数据库、调试输出和运行环境分别被 `.gitignore` 与部署白名单 `.vercelignore` 排除。开源前仍应检查暂存文件与 Git 历史；本项目当前未发布到公共 GitHub 仓库。模型结果可能误判，不能把“未识别禁止”解释为“允许”。
