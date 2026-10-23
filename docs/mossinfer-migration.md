# MossInfer 迁移状态

## 已完成

- 默认推理后端：`mossinfer`
- 引擎控制页（`/engines`）
  - 本机路径/状态
  - `hello` 探测
  - stable/dev 下载、bundled/system CUDA、CUDA 库安装
  - 下载进度/取消
  - SSH 主机列表（远端目标占位）
- 无 Instance 的引擎任务
  - `startEngineJob`：只接受模型绑定、设备、生成参数
  - 输出目录：`<userData>/outputs`
  - `/api/engine-jobs` 供桌面/WebUI 提交
  - `mossinfer-engine-job` 冒烟通过
- Studio
  - 移除实例选择、实例 URL、Project `instanceId` 写入
  - 改选模型 bundle + 设备
  - Project 记录 `modelBundleId`/`deviceId`
- UI fixture 改为验证无实例引擎 payload

## 下一阶段

1. 删除 `Instances`/`InstanceDetail`/`Home`/`Run` 页面与 App 路由残留
2. 删除推理 Worker：`git.ts`、`instances.ts`、`remoteInstances.ts`、`runtimes.ts` 的推理部分
3. 删除旧 `startJob`/runner Python 路径；所有推理只走 `startEngineJob`
4. 删除 `/api/instances`、`listInstances`、cases/launchQueue 旧数据
5. 远端：
   - SSH 启动 Linux sidecar
   - 远端 HF 权重下载
   - 远端输出 SCP 回传
6. Python/Git 检测只保留在 Trainer
7. 旧推理数据重置/归档
8. 真实 Windows/Linux NVIDIA 验收

## 注意

- 当前 macOS 开发机没有 MossInfer 二进制；只能跑 fake sidecar/管理 UI。
- GBC 仍是显式可选外部 Python 工具，不进入核心启动检测。
- Trainer 仍保留自己的 Python/Git 环境。
