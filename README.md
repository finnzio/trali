# Trali

轻量级桌面 AI 翻译器。基于 [Tauri 2](https://tauri.app/) 构建，支持流式翻译、语法检查、多服务商、术语表与多语言界面。

> Product name in app: **AI Translator** · Identifier: `com.aitranslator.desktop`

## Features

- **翻译 / 语法检查**  
  流式输出译文；语法检查模式会标出问题、给出修正与可选润色建议。
- **多服务商**  
  支持 OpenAI 兼容与 Anthropic 兼容 API；可配置端点、模型、API Key；连通性测试与模型列表拉取。
- **翻译风格（Styles）**  
  自定义提示词；每个风格可绑定独立服务商或继承默认服务商；支持多风格并行对比。
- **术语表（Glossary）**  
  按语种管理概念与术语，翻译时保持用词一致；支持 CSV 导入 / 导出。
- **系统级体验**  
  全局快捷键呼出、窗口置顶、边缘吸附（Windows / macOS）、关闭到托盘、系统语音朗读。
- **界面与外观**  
  10 种界面语言；亮/暗/跟随系统主题；主题色与圆角可调。
- **安全存储**  
  API Key 写入系统密钥环（keyring），不进入配置导出明文。

## Interface languages

| Code   | Language              |
|--------|-----------------------|
| `en`   | English               |
| `zh-CN`| 简体中文              |
| `zh-TW`| 繁體中文              |
| `ja`   | 日本語                |
| `ko`   | 한국어                |
| `es`   | Español               |
| `de`   | Deutsch               |
| `fr`   | Français              |
| `pt-BR`| Português (Brasil)    |
| `ru`   | Русский               |

翻译源/目标语种与上表一致。

## Tech stack

| Layer    | Stack |
|----------|--------|
| Shell    | Tauri 2, Rust |
| Frontend | React 19, TypeScript, Vite 7 |
| UI       | Tailwind CSS 4, Base UI, shadcn, Lucide |
| Package  | pnpm |
| HTTP     | reqwest (streaming) |
| Config   | TOML settings + CSV glossary |

## Project layout

```
├── src/                 # React frontend
│   ├── components/ui/   # UI primitives
│   └── lib/             # i18n, theme, Tauri API wrappers
├── src-tauri/           # Rust backend
│   ├── src/
│   │   ├── commands.rs  # Tauri commands
│   │   ├── generation.rs
│   │   ├── providers/   # OpenAI / Anthropic clients
│   │   ├── glossary.rs
│   │   ├── speech.rs
│   │   ├── edge_dock.rs
│   │   └── settings.rs
│   └── tauri.conf.json
└── package.json
```

## Requirements

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/)
- [Rust](https://www.rust-lang.org/) stable
- Tauri 平台依赖：见 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
  - Windows：WebView2（系统通常已预装）
  - macOS：Xcode Command Line Tools
  - Linux：`webkit2gtk` 等发行版依赖

## Getting started

```powershell
# Install frontend dependencies
pnpm install

# Desktop app (recommended)
pnpm tauri dev

# Frontend only (browser, limited native features)
pnpm dev
```

## Build

```powershell
# Frontend production bundle
pnpm build

# Desktop installers / binaries
pnpm tauri build
```

Rust-only checks:

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

## CI / multi-platform builds

GitHub Actions workflow: [`.github/workflows/build.yml`](.github/workflows/build.yml)

| Target | Runner | Notes |
|--------|--------|--------|
| Windows x64 | `windows-latest` | MSI + NSIS |
| macOS aarch64 | `macos-latest` | Apple Silicon DMG |
| macOS x64 | `macos-latest` | Intel DMG |
| Linux x64 | `ubuntu-22.04` | AppImage + deb |

**Triggers**

- Push / PR to `main` — build and upload workflow artifacts
- Manual run (`workflow_dispatch`)
- Tag `v*` (e.g. `v0.1.0`) — same builds, plus a **draft** GitHub Release with installers

```powershell
# Example: cut a draft release after bumping version in package.json / tauri.conf.json / Cargo.toml
git tag v0.1.0
git push origin v0.1.0
```

Artifacts appear on the Actions run page; release assets appear under the draft release when building from a tag.

> Repo Settings → Actions → General → Workflow permissions: enable **Read and write permissions** so release uploads work.

## Configuration

### Providers

In **Settings → Providers**:

1. Add a provider and choose type (`OpenAI-compatible` or `Anthropic-compatible`).
2. Set endpoint (e.g. `https://api.openai.com/v1` or a compatible gateway).
3. Save API key (stored in OS keyring).
4. Fetch models or enter a model name; optionally test connection.
5. Mark one provider as default.

### Styles

Define named prompts for tone/format. Each style can use the default provider or a specific one. Select one or more styles on the main screen for side-by-side results.

### Glossary

Add languages and concept rows. Base column follows the current UI language. Terms are applied during generation so domain vocabulary stays consistent.

### Preferences

- Interface language & default target language  
- Theme, color, corner radius  
- Global toggle shortcut (default `Ctrl/Cmd+Shift+Space`)  
- Edge docking, close-to-tray behavior  
- Import / export settings (TOML) and glossary (CSV)

## Data locations

Managed by the Tauri app config directory (platform-specific), typically including:

- `settings.toml` — app settings (no API secrets)
- `glossary.csv` — terminology table
- OS keyring entries for provider API keys (`com.aitranslator.desktop`)

## Development notes

- Prefer `pnpm` for JS; do not introduce npm/Yarn lockfiles.
- Frontend-only logic stays in `src/`; privileged work (HTTP to providers, filesystem, speech, keyring) lives in Rust and is exposed via narrow Tauri commands.
- Do not use native browser form controls in app code; use components under `src/components/ui/`.
- See `AGENTS.md` for agent/contributor conventions.

## License

No license file is present yet. All rights reserved unless a license is added later.
