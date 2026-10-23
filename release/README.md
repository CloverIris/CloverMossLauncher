# MossStudio 0.1.0 开发版

这是 MossStudio 的开发版发布说明。MossStudio 是 MOSS-Image 的桌面创作工作台；推理由 **MossInfer sidecar** 执行，不再通过官方 Gradio、官方 MOSS-Image 仓库 worktree 或推理 Python 环境启动。

> 开发版能力边界以 [docs/status.md](../docs/status.md) 为准。代码路径存在但未在真实 NVIDIA/Windows/Linux 环境验收的功能会明确标为未验收。

## 现在可以做什么

- **MossStudio 工作台**：三列布局、画布 tabs、区域框内提示词、图层列表、可调整/可收起面板、Agent 面板。
- **引擎页**：MossInfer 引擎状态、下载、`hello` 探测；默认 system-cuda，缺 cuBLASLt 时可下载 bundled 或用原生 NVIDIA wheel 补库。
- **模型库**：组件化模型、HF 缓存、推荐组合、本地导入；Project 直接选择模型/设备。
- **本机生成**：`startEngineJob` 不依赖 Instance/Python runtime，输出到本地 outputs。
- **Linux SSH 远端**：远端安装 bundled 引擎、准备 HF 权重、通过 SSH sidecar 出图并回传。
- **Agent**：多 Provider、历史、提示词分段/确认、润色/翻译/拆段。
- **GBC**：可选外部 `gbc` 解析图像图并导入画布。
- **Trainer**：独立窗口；训练侧 Python/Git 环境保留在 Trainer 范围。
- **画廊/诊断/设置/设备/训练**：通过 Studio 底部页面切换。

## 安装与运行

1. 在「引擎」页安装 MossInfer。
2. 在「模型」页准备 MOSS-Image 权重。
3. 在「创作」选择模型、引擎、设备，写提示词并生成。

本机推理需要 Windows/Linux x86_64 + NVIDIA 驱动。macOS 可以运行 UI、Project、Trainer 管理和 fake sidecar 测试，但**不能运行本地 MossInfer**。

## 迁移说明

- 推理任务不再使用 Instance；旧 `instances/runtimes/git` 数据首次启动归档到 `legacy-inference-*`。
- 旧 Project 的 `instanceId` 会被忽略；模型/设备改用 `modelBundleId`/`deviceId`。
- 不向前兼容旧推理链路。

## 当前验证边界

- 本机开发环境为 macOS，无 NVIDIA；真实 CUDA 生成未验收。
- 远端仅 fake SSH 场景通过，真实 Linux GPU host 未验收。
- 引擎 zip 解压仍有 Python 兜底；远端每 job 一个 SSH 进程，持久单引擎队列待补。
- 没有 Windows 安装包、签名或公证产物。

## 发布与更新（维护者）

`release/release.md` 由 `release/manifest.json`、`release/models.json` 和本文件生成；发布时作为 GitHub Release 的 `release.md` 上传。

```bash
pnpm release:md
pnpm release:md:check
```

安装包、签名与更新通道按 [docs/release-and-updates.md](../docs/release-and-updates.md) 执行。
