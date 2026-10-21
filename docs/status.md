# 实现状态

- 快照日期：2026-10-20
- 应用版本：`0.1.0`（开发版）
- 设计与文档修订：v0.4
- 验证机器：Apple M3 / 16 GB / macOS 15.7.7
- 对应计划：[roadmap.md](roadmap.md)
- 文档索引：[README.md](README.md)

> 这是本项目**唯一的事实来源**。README、公告、架构文档里的能力描述如与本文冲突，
> 以本文为准。标记规则见 [docs/README.md](README.md#2-状态标记)。

## 1. 当前能跑什么

```bash
pnpm install
pnpm dev                 # 启动器 1180×760
pnpm build
pnpm typecheck
```

Harness/CI 若设置了 `ELECTRON_RUN_AS_NODE=1`，需临时去掉：

```bash
env -u ELECTRON_RUN_AS_NODE pnpm --filter @clover/desktop exec electron . --smoke
```

开发数据在 `.dev-data/`（已忽略）；不会写真实用户目录。

## 2. 完成度总表

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| Electron 应用壳 | ✅ | 五窗口（每 kind 单例）、居中标题栏、深色/亚克力；MossStudio 改名/WebUI 未实现 |
| IPC + zod | ✅ | preload 白名单、主进程校验、统一错误 |
| 环境报告 | ✅ | 系统/GPU/内存/磁盘/Python/git/uv/网络/端口 + 推荐档位 |
| 公告/更新检查 | ✅ | release.md/公告/缓存与版本比较；下载/安装见下方更新行 |
| 实例 | 🟡 | 本机 mirror/worktree/固定 SHA/删除/隔离；远端 placement/mirror/worktree/venv/删除/切版本（fake ssh）；真实 host 未验收 |
| 远端实例部署 | 🟡 | SSH mirror/worktree/venv、删除/切版本、远端模型缓存检查；fake ssh 验证，真实 host 未验收 |
| 运行时 | 🟡 | 共享/独立/远端 venv、lock hash、uv/pip、安装日志；PyTorch auto/CPU/CUDA 选择已接，Windows CUDA 实机未验收 |
| 模型/适配器 | 🟡 | 目录/下载/HF 缓存、Range 续传、暂停/继续/取消；支持 `files` 子集；适配器绑定已接；Windows 断点/重启恢复未验收 |
| 画廊 | ✅ | 全局入口、自定义根、分页、元数据、`clover://` |
| 通知 | 🟡 | 应用内单矩形；桌面通知（任务完成/失败、发现更新）与测试入口已接；真实任务触发/Windows 未验收 |
| OOBE | ✅ | 单页三行、每次启动检查、可本次跳过 |
| 启动条/运行栈 | 🟡 | Case/实例/设备/档位/Case 设置；旧 Gradio 工作台退役中 |
| Gradio 启动参数 | ⛔ | UI/侧滑面板/独立窗口/IPC/类型/启动模式/runner launcher 已删除；旧 Case/队列读取时迁移 |
| MossStudio 桌面 | 🟡 | 改名/Home 启动入口/旧 Case 迁移已完成；Project IPC 已补；生成与真实权重待验收 |
| Agent / Provider | 🟡 | 右侧 Agent、OpenAI-compatible/Anthropic/Gemini/Ollama、密钥隔离、对话记录、写入 Prompt 前红绿确认/逐段勾选已接；真实模型调用与 Web Agent 未验收 |
| 提示词分段 | 🟡 | 拆分、着色、固定、排序、删除、合并已接；逐段 Agent diff 已接；标签库/翻译未做 |
| 系列/分页 | 🟡 | Project seriesId/page、上一页/下一页/复制新页、桌面/Web 保存已接；页间上下文引用未做 |
| MossStudio WebUI | 🟡 | 移动优先 Web shell、首页外部 UI 面板、实例绑定、端口/token、二维码、Layout 编辑器、Project layers/打开、画廊缩略图已接；PIN/真实手机/真实生成未验收 |
| 设备枚举 | ✅ | MPS / CUDA / CPU |
| 设备管理器 | 🟡 | 第五窗口；本机/SSH host、GPU 库存、测试、路径；fake ssh 验证，真实 host 未验收 |
| 设备维护 | 🟡 | 设置内启用/禁用/重命名，启动条过滤；未做完整验收 |
| 训练并发 | 🟡 | 每 host 1 训练；本地训练时推理排队；强制并发/显存配额未做 |
| Case 配置 | 🟡 | `cases.json` 持久化；`backend→workspace`、`port/extraArgs→gradio` 迁移；未单独做保存/重载端到端验收 |
| 队列落盘 | 🟡 | `launch-queue.json`；queued 保留、starting/running 重启标 failed；未做完整重启验收 |
| 队列运行 | 🟡 | 同设备默认 1 个；持久化行已接；强制并发未做 |
| 官方 Gradio | ⛔ | 正式产品入口退役；代码路径已删除，仅保留历史文档/迁移说明 |
| 远端 Gradio 隧道 | ⛔ | 随 Gradio 退役；远端生成改走 Clover runner，真实 host 未验收 |
| xterm 终端 | ✅ | 推理/训练共用，stdout/stderr/stdin、停止/重启 |
| Supervisor | ✅ | spawn、readiness、取消、进程组、失败分类、日志 |
| runner | ✅ | NDJSON + `--simulate`；真实权重未验收 |
| 解析/诊断 | ✅ | tqdm/ANSI/下载条/规则/去重/toast 预算 |
| 创作台 | ✅ | Studio、画布、layout 编译、插入 Prompt |
| Studio 后端 | 🟡 | utilityProcess HTTP/WS、token、RPC、静态 Web root；health/WS/Job/Studio API/static 已验；真实生成与手机验收未做 |
| 创作生成 | 🟡 | 已通过 backend `/api/jobs` 提交 Supervisor；缺权重/运行时预检仍拦截 |
| Project/图层 | 🟡 | `projects/<id>/project.json` + assets、自动保存、图层 visible/lock/opacity；未做完整 UI 验收 |
| 四窗口 UI v0.4 | ✅ | 启动器/创作/终端/训练；全局背景（历史阶段） |
| 五窗口 UI v0.5 | 🟡 | 新增设备管理器；工作台/Gradio 参数；真实 host/权重未验收 |
| Kohaku Trainer 仓库 | ✅ | runtime clone、bare mirror、commit/worktree |
| Trainer 环境管理 | 🟡 | 本机/远端 venv、lock hash、install、doctor 代码路径；fake uv 验证，真实 CUDA 未 |
| 训练窗口 | ✅ | 表单、命令预览、doctor、状态卡 |
| 训练 Job | 🟡 | 本机/远端 `startTrainingJob` + step/loss + 终端；**fake ssh/模拟验证**，真实 CUDA 未跑 |
| 训练数据入口 | 🟡 | 检查/文本/潜变量缓存命令已拼装；未真实运行 |
| 训练导出/采样 | 🟡 | 本机/远端执行代码已接；fake 导出验证；真实 CUDA 未跑 |
| Windows 本机导出/采样 | 🟡 | 本地脚本使用 PowerShell；类型检查通过，尚未在 Windows / CUDA 主机实测 |
| 训练产物登记 | 🟡 | 自动收集 export 文件、登记本地适配器；fake 验证；大文件/真实产物未验收 |
| SSH 主机探测 | ✅ | `trainer:host-test` 通过 fake ssh 验证 uname/git/uv/python/GPU/root |
| 远端仓库/版本 | 🟡 | 远端 mirror/worktree 创建/删除通过 fake ssh 验证；真实 host 未接 |
| 远端训练/导出 | 🟡 | 系统 ssh 训练/导出/取消代码已接；fake ssh 验证 step/loss/产物；真实 host 未接 |
| SSH host | ✅ | CRUD/测试 + `hosts.json`（旧 `training-hosts.json` 自动迁移）；不存密码 |
| SSH 远端执行 | 🟡 | 系统 ssh + 密钥、host probe、远端 mirror/worktree/venv/train/export 代码已接；只有 fake ssh 验证，无真实 host |
| 系统工具链 | ⬜ | ADR-0006 设计已确认；当前仅扫描系统 Git/Python，未做安装引导/PATH 接管 |
| Release 发布文档 | 🟡 | `release.md` 解析/生成/本地+远程+缓存回退；支持首页篇章名/标题/副标题；真实 GitHub Release 资产未验收 |
| 更新提示与下载 | 🟡 | 更新弹窗/按版本稍后/sha256 下载/打开安装包；真实签名安装包未验收 |
| 应用内更新安装 | ⬜ | 静默安装/electron-updater/打包签名未做 |
| 打包/公证 | ⬜ | 未做 |
| Windows 实机 | ⬜ | 未验证；按 [Windows 开发与验收手册](windows-validation-guide.md) 执行 |

> Clover Creator 浏览器版不做（[ADR-0004](decisions/0004-workspaces-remote-devices.md)），
> 因此不作为完成度项；HTTP/WS 后端只作为 Job/API 层。

## 3. 验证证据

以下结果来自本机实际运行，不是“代码里看起来有”。

| 验证 | 方式 | 结果 |
| --- | --- | --- |
| 构建/类型 | `pnpm build` / `pnpm typecheck` | 通过 |
| 自检 | `--smoke` | 退出码 0；M3 / 16 GB / 网络镜像；本次环境项报告 `disk:error`（空闲空间低于 30 GB） |
| 窗口创建 | `--scenario=windows` 与 `--screenshot` | 创作/终端/训练/设备管理器窗口均可渲染 |
| 训练器部署 | `--scenario=trainer-deploy` | clone trainer mirror、创建 `kohaku-3bcd751` worktree |
| 训练 Job | `--scenario=trainer-job` | `succeeded`，step 5、loss 0.1、5 行日志 |
| SSH host | `--scenario=trainer-host` | 保存/读取/删除成功（before 2 / after 1） |
| SSH 探测 | `--scenario=trainer-host-probe` | fake ssh 下 os/git/uv/python/root 解析成功 |
| 远端仓库/版本 | `--scenario=trainer-remote-local` | 远端 mirror、1 个分支、3 个提交、worktree 创建/删除 |
| 远端环境 | `--scenario=trainer-remote-env` | fake uv：runtime=ready，doctor=true |
| 远端训练 | `--scenario=trainer-remote-job` | fake ssh 下 succeeded，step 5、loss 0.1 |
| 远端产物 | `--scenario=trainer-remote-artifact` | 导出 Job succeeded，适配器自动登记 provider=local |
| 队列落盘 | `--scenario=queue-persist` | queued 行写入/读取/删除；旧 `backend`/`port`/`extraArgs` 启动时迁移为 `workspace`/`gradio` |
| Gradio 参数构造 | `--scenario=gradio-config` | 模型/目录/档位/输出/监听/端口/引号额外参数顺序正确；自动端口预览为 `<自动>` |
| Gradio 面板 UI | `--screenshot` | 侧滑面板可渲染；启动条显示模型/档位/端口与打开方式摘要 |
| Gradio Case 持久化 | `--scenario=case-gradio` | workspace/gradio profile/port/openMode/extraArgs 保存后读取一致 |
| Gradio 应用内窗口 | `--scenario=gradio-window` | 独立 BrowserWindow 加载本地 URL，标题正确 |
| 设备管理器库存 | `--scenario=device-manager` | fake ssh 探测出远端 GPU；本机 MPS/CPU 与远端设备同列；instanceRoot/modelsRoot 持久化 |
| 设备管理器 UI | `--screenshot` | 第五窗口、host 列表、设备卡、测试/使用入口渲染 |
| FP16-fixed 目录 | `--scenario=model-catalog-fp16` | 4 个 dit/fp16 条目（diffusers/ComfyUI）、files 子集、10.16 GB 声明 |
| Release 解析 | `--scenario=release-parse` | `json clover-release` 块、semver/prerelease、平台 installer 与正文解析 |
| Release 首页文案 | `--scenario=release-parse` | 首页篇章文案可读取；缺少可选字段的旧文档仍能解析 |
| 更新下载校验 | `--scenario=update-download` | 本地测试 HTTP 包下载完成，sha256 与源一致 |
| 桌面通知 | `--scenario=notification-test` | macOS Notification supported/shown；测试通知可显示 |
| 更新弹窗 | `--scenario=update-dialog` | 9.9.9 预览数据渲染更新弹窗、平台安装包摘要与发布说明 |
| Release 文档生成 | `pnpm release:md:check` | manifest/models 生成 `release.md` 且可重复校验 |
| 缺权重预检 | 首页点击启动 | 生成 `E_MODEL` 诊断 + toast，不误下载 |
| 远端实例部署 | `--scenario=remote-instance` | fake ssh 下 mirror/worktree/venv；placement=ssh、runtime=created、远端 GPU 可被发现；切版本后 remote HEAD 一致；删除后远端 worktree 与本地记录清理 |
| 远端 Gradio 隧道 | `--scenario=remote-gradio` | fake ssh 下远端 fake Gradio 启动，本地隧道 URL 可访问；远端输出 scp 到本地实例 outputs；取消后隧道关闭、Job=canceled |
| layout 编译器 | Node 直接跑 `layout.ts` | 与官方示例逐字段一致 |
| 画廊 | `--screenshot` | 全局入口、分页、详情、背景交接 |
| 终端 | `--screenshot` | xterm 显示推理/训练日志，标题显示 step/loss |
| 训练 UI | `--screenshot` | training 页 + trainer 窗口 + 状态卡 |

截图：

![OOBE](assets/oobe.webp)
![启动器首页](assets/home.webp)
![创作](assets/studio.webp)
![画廊](assets/gallery.webp)
![终端](assets/terminal.webp)
![诊断](assets/diagnostics.webp)
![设置](assets/settings.webp)
![实例](assets/instances.webp)
![训练页](assets/training.webp)
![训练窗口](assets/trainer.webp)

## 4. 已确认的边界

1. **真实生成未验收**：本机没有 27 GB SFT 权重；MossStudio 只有代码路径和
   缺权重预检。真实 runner 生成也未跑过。
2. **真实 CUDA 训练未验收**：训练 Job/loss 是用 fake ssh/模拟 Python 输出验证的；
   `startTrainerRun` 的 CUDA/`kogine` 路径没有在 NVIDIA 机器执行。
3. **Trainer 环境安装未验收**：venv/uv/pip/doctor 代码存在，但本机没有安装
   CUDA 版依赖，也没有运行 trainer。
4. **SSH 只有 fake ssh 验证**：真实 host 的 host key/连接/远端 mirror/worktree/
   venv/远端 Instance/Gradio 隧道没有验收；当前代码路径已接。
5. **导出/采样真实 CUDA 未验收**：代码已接，fake 导出/登记通过；真实 `kogine` 未跑。
6. **Clover 后端/生成只验证 simulate**：独立 HTTP/WS 与 RPC 已通；真实 runner 生成缺权重/运行时。
7. **Project/图层仅基础**：JSON+assets、自动保存、visible/lock/opacity 已接；未做完整 UI 回放/资产重链。
8. **队列落盘未完整验收**：`launch-queue.json` 已接，queued 保留、starting/running
   重启标 failed；渲染层重启与自动重排还需要真实验收。
9. **官方 Gradio 未真实启动**：没有权重，未验证端口/readiness/浏览器显示；远端隧道只在 fake ssh 下验证。
10. **Windows/Linux 未实机验证**：目前只在 macOS arm64 测试。
11. **更新为分阶段**：release.md/公告/弹窗/下载/sha256/打开安装包已接；真实 GitHub Release 资产、beta tag、签名/公证、electron-updater 静默安装未验收。
12. **开发 CSP 仍允许 `unsafe-eval`**：打包前必须收紧。
13. **浅色主题已移除**：设置 schema 里仍有 `theme`，UI 固定深色；属于迁移残留。
14. **终端保留已完成任务**：便于回看日志，不是只显示运行中。
15. **桌面通知未全平台验收**：macOS 测试通知可显示；任务完成/失败触发、Windows/Linux、系统权限拒绝路径未验收。
15. **工具链仍依赖系统**：Git/Python/uv 只做扫描与报错；官方安装引导、PATH 接管、OOBE 运行环境行仍是 ADR-0006 待实现设计。
15. **远端模型下载未实现**：远端 Instance 会检查默认 SFT 缓存，但不会自动下载/上传 27 GB；需预先准备或改用自定义模型。
16. **远端结果回传只验证官方 Gradio 目录同步**：fake ssh 下 `find + scp` 到本地实例 outputs；远端 runner 结果回传、真实 host 大文件同步未验收。

## 5. 明确没做（不是“下一轮顺手”）

- Clover Creator 浏览器版（不做，ADR-0004；HTTP/WS 仅 Job/API）；
- 静默自动安装/签名验收；
- 系统 Git/Python 工具链检测、安装引导与 OOBE 运行环境（ADR-0006）；
- 托管 Python；
- 设备维护完整验收/强制并发/显存配额；
- DMD 8 步采样器（当前 profile 只透传，仍走官方 pipeline）；
- 真实 SSH host / 真实 CUDA 验收；
- 打包、公证、Windows 安装器；
- 自研推理引擎（V2）。

## 6. 下一轮

按 [roadmap.md](roadmap.md) 的 P0 顺序：

1. 真实 SSH host 验收（host key/权限 → 远端 mirror/worktree/venv → 远端 Job/日志/取消）；
2. 真实 CUDA 训练验收 + 数据缓存/导出/采样；
3. Clover 生成真实权重验收、Project/图层 UI 收尾；
4. 远端 Instance 真实 host 验收、远端模型下载、远端 runner 结果回传；
5. 队列完整重启验收、Gradio/27 GB、设备维护；
6. 真实签名安装包/electron-updater、打包。
