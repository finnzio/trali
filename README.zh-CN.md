<p align="center">
  <img src="./public/trali.png" width="112" alt="Trali" />
</p>

<h1 align="center">Trali</h1>

<p align="center">
  轻量级桌面 AI 翻译器与语法检查器，支持自定义模型供应商。
</p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="#download">Windows</a>
  ·
  <a href="#download">macOS</a>
  ·
  <a href="#download">Linux</a>
</p>

---

## 它是什么

Trali 是一个**轻量级的桌面 AI 翻译器和写作助手**。你自带模型供应商，选择风格，即可获得流式结果——没有臃肿的聊天工作台，没有账号墙，也没有广告。

它面向日常办公：消息、邮件、技术文档。快捷键呼出，输入，拿到结果，关掉窗口。它会继续待在托盘里，直到你再次需要。

---

## 为什么做它

日常工作里，我需要面对不同角色、不同地区的同事、leader、外部客户，也要写技术文档。同一件事，往往需要不同的表达方式——简短的 IM、谨慎的邮件、精确的技术文档。

我需要一个能自定义不同风格的工具。找了一圈，却总是这些让人烦的东西：

- 安装包动辄上 100MB，启动迟缓
- 在 AI Token 已经很便宜的今天，仍要高昂的订阅费
- 有的软件允许自定义供应商，但不开放源码，很难确认 API Key 是否被妥善保管
- 风格提示词难以真正由自己掌控
- 广告、绑定，或粗糙的界面

找不到合适的工具之后，我决定自己动手。于是有了这个项目。

---

## 功能

1. **极度轻量**  
   没有任何推广，没有账号门槛。启动很快；翻译速度完全取决于你选择的模型。

2. **精心打磨的界面**  
   作为产品经理，我对界面很挑剔。Trali 经过认真打磨，并支持主题、颜色、圆角、快捷键、关闭到托盘等多项自定义。

3. **术语**  
   这对我很重要。和客户沟通时，我不希望同一个概念每次都用不同的词。术语表帮你把人名、产品名和专业词汇固定下来。

4. **语法与表达**  
   在翻译之外，也支持语法检查模式。当你自己写作时，可以获得语法和表达建议。

5. **自由的风格设置**  
   面向不同对象设置不同风格——IM、邮件、技术文档等。AI 也可以根据少量线索和几个问题，帮你优化风格提示词。

6. **多平台与设置迁移**  
   支持 Windows、macOS、Linux。设置和术语可以导出导入，把同一套工具带到不同设备。API Key 留在本机，不会随设置导出。

7. **安全性**  
   API Key 保存在操作系统凭据库中，由系统加密与访问控制。Trali 不会把 Key 上传到任何地方；请求从你的电脑直接发往你配置的服务商。

**此外还支持：** 流式输出、多风格并行、常用语言对与一键交换、全局快捷键与托盘、Windows / macOS 朗读，以及 English、简体中文、繁體中文、日本語、한국어、Español、Deutsch、Français、Português (Brasil)、Русский 等界面语言。

---

## 下载

安装包见 **[GitHub Releases](https://github.com/finnzio/trali/releases)**：

| 平台 | 包格式 |
|------|--------|
| Windows | MSI、NSIS `.exe` |
| macOS | Apple Silicon 与 Intel `.dmg` |
| Linux | `.AppImage`、`.deb` |

> **Important:** 如果 macOS 提示“Trali 已损坏，无法打开”，并且你确认应用来自可信的 Trali 下载源，请先将应用拖入“应用程序”，然后打开“终端”执行：
>
> ```bash
> sudo xattr -dr com.apple.quarantine /Applications/Trali.app
> ```
>
> 输入 Mac 登录密码后，再从“应用程序”打开 Trali。这个命令会移除 macOS 为网络下载文件添加的隔离标记，让系统允许应用启动；它不会修复真正损坏的文件，也不会为应用签名，请只对可信来源的应用使用。

你需要自备 API Key，并能访问所选服务商。

### Code signing policy

带版本标签发布的 Windows NSIS 安装包由 [SignPath.io](https://signpath.io) 免费签名，证书由 [SignPath Foundation](https://signpath.org) 签发。详见 [Code signing policy](./CODE_SIGNING.md)。

### 第一次使用

1. 打开 **设置 → 服务商**
2. 添加 **OpenAI 兼容** 或 **Anthropic 兼容** 服务商
3. 填写接口地址、模型和 Key
4. 测试连接，并设为默认
5. 在主界面输入即可翻译，或切换到语法检查模式

支持自定义 API 地址，官方接口与兼容协议的服务均可使用。

---

## 架构

Trali 是一个小巧的桌面应用：界面用 Web 技术，需要权限的工作放在 Rust 里。

| 层级 | 技术 |
|------|------|
| 桌面壳 | Tauri 2 |
| 原生核心 | Rust、Tokio、流式 HTTP |
| 界面 | React 19、TypeScript、Vite、Tailwind CSS、Base UI / shadcn |
| 配置 | TOML 设置、CSV 术语表 |
| 密钥 | 操作系统凭据库（`keyring`） |

前端不会拿着 Key 直接请求服务商。生成由 Rust 流式推到界面；多种风格可以并行请求；输入变化时会取消过时请求，避免旧结果盖住新内容。

---

## 隐私与安全

- 没有 Trali 账号，也没有 Trali 自己的 API 中转
- API Key 只存在操作系统凭据库（如 Windows 凭据管理器、macOS 钥匙串）
- Key 不会写入 `settings.toml`
- 导出设置时不会带上 Key
- 网络请求只从你的设备发往你配置的服务商
- 服务商如何处理文本，仍取决于对方的隐私政策

---

## 从源码开发

需要：

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/)
- [Rust stable](https://www.rust-lang.org/tools/install)
- 对应平台的 [Tauri 2 前置依赖](https://v2.tauri.app/start/prerequisites/)

```powershell
pnpm install
pnpm tauri dev
```

仅前端（无托盘、全局快捷键、系统凭据库、系统语音等）：

```powershell
pnpm dev
```

生产构建可用 `pnpm build` 与 `pnpm tauri build`。

---

## 社区

Trali 首先是我给自己工作流做的工具，如果也能帮到别人，我会很高兴。

- 有问题或需求，欢迎提 Issue
- 欢迎 Pull Request——请尽量聚焦，并与现有代码风格保持一致
- 如果喜欢这个项目，欢迎点个 Star

---

## License

[GNU General Public License v3.0](./LICENSE)（GPLv3）。

---

<sub>大部分实现由 AI 编程工具产出。产品概念、设计决策与代码审核由作者完成。</sub>
