# Open-Prism（中文部署说明）

开源 AI 驱动的 LaTeX 写作工作台，提供实时预览与智能辅助写作。

![Open-Prism Screenshot](./assets/OpenPrism.png)

## 功能特性

- **AI 辅助写作** - 基于 assistant-ui 的智能 LaTeX 助手
- **实时 PDF 预览** - 文档编译后即时预览
- **CodeMirror 编辑器** - LaTeX 语法高亮
- **本地存储** - 浏览器 IndexedDB 自动保存
- **深色/浅色主题** - 自动主题切换

## 快速开始

```bash
# 克隆仓库
git clone https://github.com/assistant-ui/open-prism.git
cd open-prism

# 安装依赖
pnpm install

# 复制环境变量
cp apps/web/.env.example apps/web/.env.local

# 编辑 apps/web/.env.local，配置以下变量：
# - OPENAI_API_KEY: OpenAI API Key
# - LATEX_API_URL: LaTeX 编译服务地址
# - KV_REST_API_URL: Upstash REST API URL（用于限流）
# - KV_REST_API_TOKEN: Upstash REST API Token

# 启动开发服务
pnpm dev:web
```

## 项目结构

```
open-prism/
├── apps/
│   ├── web/          # Next.js 前端应用
│   └── latex-api/    # LaTeX 编译 API（Hono + TeX Live）
├── packages/         # 共享包（如有）
├── biome.json        # Biome 代码规范配置
└── turbo.json        # Turborepo 配置
```

### apps/web

Next.js 16 应用：

- assistant-ui 用于 AI 对话
- CodeMirror 用于 LaTeX 编辑
- react-pdf 用于 PDF 预览
- Upstash Redis 进行限流

### apps/latex-api

LaTeX 编译 API：

- 接收 LaTeX 资源（tex + 图片）
- 使用 TeX Live (pdflatex) 编译
- 返回 PDF 二进制

## Linux 云端部署

部署分为两部分：前端 Web 与后端 LaTeX API。建议先部署 LaTeX API，再部署 Web。

### 1. 环境准备

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y curl git

# 安装 Node.js 20+（示例使用 NodeSource）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 启用并安装 pnpm
corepack enable
corepack prepare pnpm@10.28.2 --activate
```

### 2. 安装 TeX Live（LaTeX 编译器）

latex-api 需要本地 TeX Live。下面为与 Dockerfile 一致的常用安装组合。

```bash
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  texlive \
  texlive-latex-extra \
  texlive-pictures \
  texlive-fonts-recommended \
  texlive-science

# 验证安装
pdflatex --version
```

### 3. 部署 LaTeX API（推荐先部署）

#### 方式 A：直接运行（推荐）

```bash
# 进入项目根目录
cd open-prism

# 安装依赖
pnpm install

# 构建 latex-api
pnpm --filter @open-prism/latex-api build

# 启动服务（默认端口 3001）
cd apps/latex-api
PORT=3001 node dist/index.js
```

验证服务：

```bash
curl -X POST http://localhost:3001/builds/sync \
  -H "Content-Type: application/json" \
  -d '{"compiler":"pdflatex","resources":[{"main":true,"content":"\\documentclass{article}\\begin{document}Hello\\end{document}"}]}'
```

#### 方式 B：Docker 部署

```bash
cd open-prism/apps/latex-api
docker build -t open-prism-latex-api .
docker run -p 3001:3001 open-prism-latex-api
```

### 4. 部署 Web 前端

```bash
# 进入项目根目录
cd open-prism

# 安装依赖
pnpm install

# 准备环境变量
cp apps/web/.env.example apps/web/.env.local

# 编辑 apps/web/.env.local
# 关键示例：
# OPENAI_API_KEY=xxx
# LATEX_API_URL=http://<你的服务器公网IP或域名>:3001
# KV_REST_API_URL=xxx
# KV_REST_API_TOKEN=xxx

# 构建 Web
pnpm --filter @open-prism/web build

# 启动 Web（默认 3000）
cd apps/web
pnpm start
```

至此：

- Web 服务默认在 3000 端口
- LaTeX API 默认在 3001 端口
- Web 会通过 LATEX_API_URL 调用 LaTeX 编译服务

## 贡献指南

详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## License

[MIT](./LICENSE)
