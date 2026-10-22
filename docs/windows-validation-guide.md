# Windows 开发与验收手册

本文面向负责 Windows 开发、集成和实机验收的协作者。当前仓库有 Windows 平台代码分支，但**尚无 Windows 实机验证，也没有 Windows 安装包打包配置**。构建成功或 fake 场景通过，不等于 Windows 产品验收通过。

## 1. 当前边界

- 桌面应用基于 Electron；两个产品窗口共用 renderer：MossStudio（含工作台管理覆盖层与终端抽屉）、Kohaku Trainer。
- Windows 窗口标题栏、PowerShell 环境探测、Python/uv 路径及本机 Trainer `.cmd` / PowerShell 脚本有对应代码路径，仍需在真实 Windows 主机验证。
- SSH 远端流程面向 Linux host；Windows 桌面端使用系统 OpenSSH，远端命令仍依赖 Linux/POSIX shell。
- MOSS-Image 真实生成需要完整运行时与模型权重；Trainer 真实训练、导出和采样需要 NVIDIA CUDA 环境。
- Clover 工作台目前暂未开放；请勿把 Clover simulate/API 场景描述成真实生成完成。
- 当前 root scripts 有 `build`，但没有 NSIS、签名、公证或 Windows installer 目标。`pnpm build` 只验证 Electron/Vite 构建。

## 2. 开发环境

请记录实际环境，不要假定任一工具已由应用安装：

- Windows 版本、架构、显示缩放比例；
- Node.js、pnpm `9.14.2`、Git；
- Python 版本及来源（系统 Python、Python Launcher 或 uv）；
- NVIDIA 驱动、`nvidia-smi` 输出；
- OpenSSH 客户端版本（仅测试 SSH 时需要）；
- 磁盘剩余空间和模型目录位置。

项目根目录执行：

```powershell
corepack enable
corepack prepare pnpm@9.14.2 --activate
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

清除可能由测试 harness 设置的 Electron 环境变量，再运行 smoke：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
pnpm --filter @clover/desktop exec electron . --smoke
```

启动开发应用：

```powershell
pnpm dev
```

开发数据位于仓库根目录 `.dev-data/`。场景测试可能创建或改写其中的 fixtures、实例、训练版本与截图；不要清理用户已有数据，除非确认内容可删除。

## 3. 场景测试

界面回归可以单独运行，不需要启动另一个 Dev Server：

```powershell
node tools/test-settings-draft.mjs
node tools/test-ui.mjs --scaled
# 开发模式 React / StrictMode 生命周期检查
node tools/test-ui.mjs --development
# 可选：保存受控页面截图（此目录不入库）
node tools/test-ui.mjs --scaled --screenshots=docs/assets/ui-review
```

UI 检查使用临时构建、独立 Electron 配置目录和内存 IPC fixtures，不读写 `.dev-data/`。
覆盖控件计算样式、弹层焦点与 Escape、设置草稿、排序/折叠、动效偏好和 100%/150%/200% renderer 缩放；
包括退场中重开、内容保留、暂停动画的清理兜底、折叠中间高度、Toast 到期与上限、快速页面切换。
材质检查读取构建后的 CSS，核对四类玻璃表面的标准 `backdrop-filter`，并比较卡片后条纹的实际像素变化；
不能只检查源码中是否写了模糊属性。Electron 的 Chromium 不识别 `-webkit-backdrop-filter`，应使用标准属性，
避免优化器合并重复声明后只保留前缀版本。页面内模糊在 Windows 10 上也应生效；
Windows 原生 `backgroundMaterial: acrylic` 则仅支持 Windows 11 22H2 及以上，不能混作同一验收项。
这些检查不替代 §4 的操作系统 DPI、原生窗口以及真实任务验收。

先构建，再从仓库根目录运行。每条场景的最终退出码必须为 `0`；保存完整输出，不要只截取末尾。

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
pnpm --filter @clover/desktop exec electron . --scenario=windows
pnpm --filter @clover/desktop exec electron . --scenario=device-manager
pnpm --filter @clover/desktop exec electron . --scenario=trainer-deploy
pnpm --filter @clover/desktop exec electron . --scenario=trainer-job
pnpm --filter @clover/desktop exec electron . --scenario=queue-persist
pnpm --filter @clover/desktop exec electron . --scenario=release-parse
```

远端流程的 fake ssh / fake uv 场景用于检查编排，不证明真实 Windows OpenSSH 或 Linux host 可用：

```powershell
pnpm --filter @clover/desktop exec electron . --scenario=trainer-host
pnpm --filter @clover/desktop exec electron . --scenario=trainer-host-probe
pnpm --filter @clover/desktop exec electron . --scenario=trainer-remote-local
pnpm --filter @clover/desktop exec electron . --scenario=trainer-remote-env
pnpm --filter @clover/desktop exec electron . --scenario=trainer-remote-job
pnpm --filter @clover/desktop exec electron . --scenario=remote-instance
pnpm --filter @clover/desktop exec electron . --scenario=remote-gradio
```

`--scenario=trainer-job`、`trainer-remote-job` 与 `remote-gradio` 使用模拟输出或 fake ssh 时，只能记录为流程测试。不要将它们计为真实 CUDA、远端连接或真实生成通过。

完整 scenario 注册表和数据副作用见 [apps/README.md](../apps/README.md) 与 `apps/desktop/src/main/index.ts`。

## 4. Windows 实机验收

以下项目必须在真实 Windows 主机上手动执行，并附日志、截图或可重复步骤：

| 区域 | 验收动作 | 通过标准 |
| --- | --- | --- |
| 窗口与显示 | 打开五个窗口；检查标题栏、最小化/最大化/关闭、窗口聚焦、100%/150%/200% 缩放和最小尺寸 | 无白屏、裁切或标题栏按钮遮挡；重复打开聚焦既有窗口 |
| 环境探测 | 扫描 GPU、磁盘、Python、Git、uv、网络和端口；有多块 GPU 时核对设备列表 | 缺少工具可解释；路径含空格/中文时可正确探测；磁盘不足不误报通过 |
| 实例与运行时 | 创建实例、安装依赖、切换 commit；使用含空格及中文的仓库/缓存路径 | 运行时状态、日志和路径正确；失败有可读诊断；不会写入错误目录 |
| 模型下载 | 下载、暂停/继续、断网恢复、校验哈希；在空间不足时尝试下载 | 下载状态真实；损坏文件不标记为可用；空间不足有明确阻止或提示 |
| Gradio | 在具备权重与运行时的实例启动；测试自动/指定端口、系统浏览器和应用内窗口 | readiness、URL、停止行为一致；停止后无残留 Python/SSH 进程 |
| 本机 Trainer | 有 NVIDIA/CUDA 的机器安装 Trainer 环境；分别执行小数据集训练、导出、采样 | `.cmd` / PowerShell 流程在无 Bash 前提下成功；step/loss、输出路径和退出码可信；取消后无子进程残留 |
| SSH 主机 | 使用真实 Windows OpenSSH + Linux NVIDIA host；测试首次 host key、已知 host、错误密钥、断线、超时和取消 | 不绕过 host key；连接失败有诊断；远端进程/隧道可清理；日志明确标出 host |
| 远端 Instance/Gradio | 部署远端实例、选择同 host 设备、打开隧道、观察输出回传、停止并删除 | 设备过滤正确；URL 可达；输出只回传到预期本地目录；删除行为符合确认文案 |
| 持久化与恢复 | 保存 Case、重启应用、检查 queued/running 任务状态和 host 配置 | Case 可重载；任务不中断伪装为运行中；host 配置不会存储密码 |
| 更新 | 运行 parser/download 场景；实际 Windows 安装流程等 installer 配置完成后再测 | SHA-256 错误被拒绝；stable/beta 不混淆；未有安装包时明确报告阻塞，不宣称更新通过 |

本机没有真实模型权重或 CUDA 时，将对应项目记为 **Blocked / 未验收**，并记录原因；不能用 fake 数据替代真实验收。

## 5. 结果记录模板

每次提交验收结果时，复制并填写：

```text
日期：
应用 commit：
Windows 版本 / 架构：
显示分辨率 / 缩放：
CPU / RAM / GPU / NVIDIA Driver：
Node / pnpm / Python / Git / uv / OpenSSH：
执行命令与 scenario：
结果：Pass / Fail / Blocked
复现步骤：
日志路径：
截图路径：
遗留问题与责任人：
```

Pass 只用于该 Windows 机器上实际完成的步骤。类型检查、构建、截图、fake ssh、simulate 和解析测试分别记录，不要合并成“Windows 全量通过”。发现问题时附完整错误日志、相关主机环境和最短复现步骤；不要提交密钥、token、用户目录或真实训练数据。

## 6. 交付门槛

Windows 版本进入可交付状态前，还需要单独完成：

1. 真实 Windows x64 主机的环境、窗口、实例、runtime 与任务生命周期验收；
2. 有 NVIDIA 机器时完成真实 CUDA 训练/导出/采样；无机器时保留明确的 Blocked 状态；
3. 配置并验证 Windows 安装包目标、签名/SmartScreen 提示、升级与卸载；
4. 将可重复检查加入自动化；至少保证 Windows CI 覆盖类型、构建和无 GPU 的 smoke；
5. 更新 [status.md](status.md)、[roadmap.md](roadmap.md) 和发布公告，只把有证据的项目标记为已验收。
