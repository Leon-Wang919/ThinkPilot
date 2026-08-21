# Contributing to ThinkPilot

感谢你愿意改进 ThinkPilot。

## 开发流程

1. Fork 仓库并从主分支创建功能分支。
2. 复制 `.env.example` 为 `.env`，只在本地填写密钥。
3. 安装后端、前端及开发依赖。
4. 为行为变更补充或更新测试。
5. 在提交 Pull Request 前运行：

```bash
python scripts/dev.py lint
python scripts/dev.py test
cd web && npm run build
```

## 提交约定

- 每个 Pull Request 聚焦一个明确问题。
- 说明变更动机、实现方式和验证结果。
- UI 变更请附截图或录屏。
- 不要提交 API Key、用户数据、数据库、日志、模型文件或构建产物。
- 新增依赖时说明用途，并放入最合适的依赖分组。

## 代码风格

Python 使用 Ruff 与 Black，前端使用 ESLint 与 Prettier。可以运行 `pre-commit install` 在本地启用提交前检查。

