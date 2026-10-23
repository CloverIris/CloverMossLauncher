# 前置条件与首次运行

## 1. MossStudio 本机

- Windows/Linux x86_64 + NVIDIA
- 驱动可用
- `moss-server`（引擎页安装或手动机路径）
- MOSS-Image 权重（模型页）

macOS 可运行 UI/项目/Trainer 管理，但**不能运行本机 MossInfer**。

## 2. 首次运行

1. 底部「引擎」：安装 MossInfer
   - 默认检查系统 cuBLASLt
   - 缺库时选择 bundled 或 system + NVIDIA wheel
2. 底部「模型」：准备 MOSS-Image
3. 底部「创作」：选择模型/引擎/设备，生成

Onboarding 只检查：

- 引擎
- 模型

不再检查 Instance/Python runtime。

## 3. 引擎包

| 变体 | 说明 |
| --- | --- |
| system-cuda | 小；依赖系统 cuBLASLt |
| bundled | +700MB；自带 CUDA 库 |

- 系统预检：Linux `ldconfig`/find；Windows CUDA Toolkit/System32/PATH。
- 缺库不会静默 pip 安装。
- 原生 wheel：`cudaWheels.ts` 下载 nvidia-cublas/nvidia-cuda-runtime wheel，用 JS 解压 DLL/so。

## 4. 远端 Linux

要求：

- Linux x86_64 + NVIDIA
- SSH
- `curl`、`tar`
- `engineRoot`（默认 `~/.mossstudio/engine`）
- `outputRoot`（默认 `~/.mossstudio/outputs`）

引擎页：

- 检测
- 安装 bundled 引擎
- 准备默认 HF 模型

## 5. Trainer

Trainer 保留自己的前置条件：

- Python 3.10+
- Git
- 训练器版本/环境

这些检测只在 Trainer 范围内使用，不属于 MossStudio 推理启动。

## 6. GBC

可选：

- 外部 `gbc`
- 独立 Python 环境
- 缺失只影响 GBC 解析，不影响创作/生成
