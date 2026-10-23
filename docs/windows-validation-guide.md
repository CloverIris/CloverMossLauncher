# Windows 开发与验收手册

本文面向 Windows 实机开发与验收。当前仓库有 Windows 代码路径，但**尚未提供 Windows 安装包/签名，也未完成真实 NVIDIA Windows 出图验收**。

## 1. 当前边界

- 两个窗口：MossStudio（创作 + 底部管理页 + 终端抽屉）、Kohaku Trainer。
- 推理：MossInfer `moss-server`，Windows x86_64 + NVIDIA。
- 不再需要官方 MOSS 仓库、推理 Python、Instance 或 runtime。
- Trainer 仍需要 Python/Git；这些检测只在 Trainer 范围。
- 远端 sidecar 只支持 Linux x86_64 + NVIDIA。
- 没有 NSIS、签名、公证或自动安装器；`pnpm build` 只验证 Electron/Vite 构建。

## 2. 环境记录

请记录：

- Windows 版本、架构、DPI；
- Node.js、pnpm、Git；
- NVIDIA 驱动、`nvidia-smi`；
- CUDA Toolkit / `cublasLt64_*.dll` 位置；
- 模型/引擎/输出目录；
- 磁盘剩余空间。

## 3. 构建与测试

```powershell
corepack enable
corepack prepare pnpm@9.14.2 --activate
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
pnpm --filter @clover/desktop exec electron . --smoke
```

UI：

```powershell
pnpm test:ui
```

MossInfer fake sidecar：

```powershell
pnpm --filter @clover/desktop exec electron . --scenario=mossinfer-engine-job
pnpm --filter @clover/desktop exec electron . --scenario=mossinfer-remote-job
```

## 4. 验收矩阵

| 项目 | 操作 | 通过标准 |
| --- | --- | --- |
| 启动 | `pnpm dev` | 只出现 Studio；Trainer 由训练页打开 |
| 引擎预检 | 引擎页选择 system-cuda | 正确识别 `cublasLt64_*.dll` / 缺失 |
| 缺库回退 | 没有系统库时安装 | 弹窗可选 bundled；下载后 `hello` 成功 |
| 原生 CUDA wheel | 选择“下载 system + 解压 CUDA 库” | 不调用 Python/uv/pip；lib/bin 出现 DLL |
| 模型 | 模型库下载/导入 | 组件完整，Project 可选 |
| 生成 | 选择模型/设备，开始生成 | PNG 输出到 outputs；取消/失败有日志 |
| 引擎控制台 | 终端抽屉切本机/远端 | 只显示 engine 聚合视图；无每个 Case 一个终端 |
| 远端 | Linux SSH host 安装引擎/准备模型/生成 | SSH sidecar 出图，PNG 回传 |
| Trainer | 打开 Trainer | Python/Git 检测只在 Trainer 内 |

## 5. 已知风险

- Windows wheel 解压后的 DLL 搜索路径需要实机确认。
- 系统 CUDA Toolkit 版本必须与引擎 cu12/cu13 匹配。
- 引擎 zip 解压仍有系统 Python 兜底，尚未改原生。
- 真实远端 UDP/SSH 网络、路径空格、中文路径、非 ASCII 用户名需实测。
- 打包/签名/更新未实现。

## 6. 失败记录

记录至少包含：

- 复现步骤、截图/日志路径；
- `nvidia-smi`、cuBLASLt 路径；
- 引擎版本/包类型；
- 模型路径；
- 是否 fake/真实；
- 是否已回退到 bundled。
