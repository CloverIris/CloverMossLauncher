# MossStudio 0.1.0

> 本文件由 `node tools/release-md.mjs` 从 `release/manifest.json` 与
> `release/models.json` 生成；请勿直接手改。发布时把本文件作为 GitHub Release
> 的 `release.md` 资产上传。

- 通道：**stable**
- 发布：2026-10-19T02:00:00Z
- 最低版本：0.1.0
- 模型目录：2026-10-19T09:48:26Z · `sha256:73ecc164131b…`

## 安装包

_当前发布未附带安装包。_

## 模型目录

| ID | 名称 | 仓库 | 角色 | 精度 | 大小 | 许可 | 标签 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `moss-sft-dit` | MOSS-Image SFT | `OpenMOSS-Team/MOSS-Image-SFT` | dit | bf16 | 10.2 GB | Apache-2.0 | `official` `sft` |
| `moss-base-dit` | MOSS-Image Base | `OpenMOSS-Team/MOSS-Image-Base` | dit | bf16 | 10.2 GB | Apache-2.0 | `official` `base` |
| `moss-base-fp16-fixed` | MOSS-Image Base FP16-fixed (社区) | `KBlueLeaf/MOSS-Image-FP16-fixed` | dit | fp16 | 10.2 GB | Apache-2.0 | `community` `fp16` `fixed` `base` `diffusers` `2080ti` `v100` |
| `moss-sft-fp16-fixed` | MOSS-Image SFT FP16-fixed (社区) | `KBlueLeaf/MOSS-Image-FP16-fixed` | dit | fp16 | 10.2 GB | Apache-2.0 | `community` `fp16` `fixed` `sft` `diffusers` `2080ti` `v100` |
| `moss-base-fp16-fixed-comfy` | MOSS-Image Base FP16-fixed · ComfyUI (社区) | `KBlueLeaf/MOSS-Image-FP16-fixed` | dit | fp16 | 10.2 GB | Apache-2.0 | `community` `fp16` `fixed` `base` `comfyui` `2080ti` `v100` |
| `moss-sft-fp16-fixed-comfy` | MOSS-Image SFT FP16-fixed · ComfyUI (社区) | `KBlueLeaf/MOSS-Image-FP16-fixed` | dit | fp16 | 10.2 GB | Apache-2.0 | `community` `fp16` `fixed` `sft` `comfyui` `2080ti` `v100` |
| `qwen35-encoder` | Qwen3.5 · 文本编码器 | `OpenMOSS-Team/MOSS-Image-SFT` | text_encoder | bf16 | 16.8 GB | Apache-2.0 | `official` `shared` |
| `flux2-vae-small` | FLUX.2 VAE · Small | `OpenMOSS-Team/MOSS-Image-SFT` | vae | fp32 | 238 MB | Apache-2.0 | `official` `shared` |
| `moss-pipeline` | MOSS Pipeline | `OpenMOSS-Team/MOSS-Image-SFT` | support | mixed | 0 MB | Apache-2.0 |  |
| `moss-base-comfy-bf16` | MOSS BASE · BF16 | `Comfy-Org/MOSS-Image` | dit | bf16 | 10.2 GB | Apache-2.0 | `comfyui` |
| `moss-base-comfy-int8_convrot` | MOSS BASE · INT8_CONVROT | `Comfy-Org/MOSS-Image` | dit | int8 | 5.4 GB | Apache-2.0 | `comfyui` |
| `moss-sft-comfy-bf16` | MOSS SFT · BF16 | `Comfy-Org/MOSS-Image` | dit | bf16 | 10.2 GB | Apache-2.0 | `comfyui` |
| `moss-sft-comfy-int8_convrot` | MOSS SFT · INT8_CONVROT | `Comfy-Org/MOSS-Image` | dit | int8 | 5.4 GB | Apache-2.0 | `comfyui` |
| `qwen35-comfy-bf16` | Qwen3.5 · BF16 | `Comfy-Org/MOSS-Image` | text_encoder | bf16 | 19.3 GB | Apache-2.0 | `comfyui` |
| `qwen35-comfy-int8_convrot` | Qwen3.5 · INT8_CONVROT | `Comfy-Org/MOSS-Image` | text_encoder | int8 | 9.7 GB | Apache-2.0 | `comfyui` |
| `qwen35-comfy-w4a8_gptq` | Qwen3.5 · W4A8_GPTQ | `Comfy-Org/MOSS-Image` | text_encoder | w4a8 | 7.3 GB | Apache-2.0 | `comfyui` |
| `flux2-vae-comfy-small` | FLUX.2 VAE · Small | `Comfy-Org/MOSS-Image` | vae | fp32 | 238 MB | Apache-2.0 | `comfyui` |
| `flux2-vae-comfy-full` | FLUX.2 VAE · Full | `Comfy-Org/MOSS-Image` | vae | fp32 | 321 MB | Apache-2.0 | `comfyui` |

## 适配器

| ID | 名称 | 仓库 | 类型 | 基座 | 大小 | 许可 | 文件 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dmd8-sft` | 8-step DMD (SFT) | `lodestones/MOSS-Image-SFT-8-steps-dmd` | dmd | moss-sft | 1.3 GB | Apache-2.0 | `lora.safetensors` `time_embedding.safetensors` `dataspace.safetensors` |
| `dmd8-base` | 8-step DMD (Base) | `lodestones/MOSS-Image-Base-8-steps-dmd` | dmd | moss-base | 1.3 GB | Apache-2.0 | `lora.safetensors` `time_embedding.safetensors` `dataspace.safetensors` |

## 公告

### MossStudio 内测开始

> info · 2026-10-19T02:00:00Z

详见下方「发布说明」。

## 发布说明

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

```json clover-release
{
  "schema_version": 2,
  "app": {
    "name": "MossStudio",
    "channel": "stable",
    "version": "0.1.0",
    "min_supported": "0.1.0",
    "published_at": "2026-10-19T02:00:00Z",
    "notes_url": "https://github.com/CloverIris/MossStudio/releases"
  },
  "installers": [],
  "home": {
    "chapter": "万象初绘",
    "title": "一念落纸上，万象入画来。",
    "subtitle": "在 MossStudio 创作，引擎与模型在管理页准备。"
  },
  "catalog": {
    "updated_at": "2026-10-19T09:48:26Z",
    "models_url": "https://raw.githubusercontent.com/CloverIris/MossStudio/main/release/models.json",
    "models_sha256": "73ecc164131b30dda905be527af483735342d7677d8724b8e65e4b9419dc3941"
  },
  "announcements": [
    {
      "id": "2026-10-launch",
      "level": "info",
      "title": "MossStudio 内测开始",
      "body_url": "https://raw.githubusercontent.com/CloverIris/MossStudio/main/release/README.md",
      "starts_at": "2026-10-19T02:00:00Z",
      "ends_at": null,
      "dismissible": true,
      "pinned": true,
      "action": {
        "label": "查看更新",
        "kind": "check_update"
      }
    }
  ]
}
```
