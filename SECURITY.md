# Security Policy

## Supported versions

ThinkPilot is currently developed on the latest main branch. Security fixes are applied there first.

## Reporting a vulnerability

请不要通过公开 Issue 披露漏洞、密钥或用户数据。请使用 GitHub 仓库的 **Security advisories → Report a vulnerability** 私下报告，并提供：

- 受影响的组件或版本
- 可复现步骤
- 可能的影响
- 建议修复方式（如有）

维护者确认问题前，请避免公开利用细节。

## Secret handling

ThinkPilot reads service credentials from local environment files. Never commit `.env`、`web/.env.local`、运行数据库、日志或分享包。若密钥曾进入 Git 历史，请立即在服务提供商处吊销并轮换；仅从最新提交中删除文件并不能清除历史。

