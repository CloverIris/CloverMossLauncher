# 后端与 Project

## 1. 进程

`src/backend/index.ts` 是 Electron utility process：

- 本机 HTTP/WS，供 Studio/LAN WebUI 使用
- 通过 RPC 调用主进程服务
- token 校验；token 由主进程生成

## 2. HTTP API（当前）

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/jobs` | 任务列表 |
| GET | `/api/jobs/:id` | 单个任务 |
| POST | `/api/engine-jobs` | 提交无 Instance 的 MossInfer 任务 |
| POST | `/api/jobs/:id/cancel` | 取消 |
| GET | `/api/projects` | Project 列表 |
| POST | `/api/projects` | 保存 Project |
| GET/DELETE | `/api/projects/:id` | 读取/删除 |
| GET | `/api/models` | 模型 catalog |
| GET | `/api/gallery` | 画廊分页 |
| GET | `/api/gallery/file` | 画廊文件 |
| GET | `/api/studio/bootstrap` | Studio 启动数据；`instances` 仅为空兼容字段 |

旧 `/api/jobs` 提交、`/api/instances` 已移除。

## 3. Engine Job

```json
{
  "modelBinding": { "bundleId": "...", "dit": "...", "textEncoder": "...", "vae": "..." },
  "modelName": "MOSS-Image SFT",
  "deviceId": "cuda:0",
  "prompt": "...",
  "width": 1024,
  "height": 1024,
  "steps": 8,
  "cfg": 1,
  "seed": 42,
  "profile": "dmd8",
  "hostId": "ssh-...",
  "remoteModelPath": "~/.mossstudio/models/..."
}
```

- 本地：`modelBinding` → bundle 路径。
- 远端：`hostId + remoteModelPath`；本地模型绑定可省略。
- 输出：本地 `<userData>/outputs/`；远端回传后落到同一目录。

## 4. WebSocket

`/ws?token=...` 广播任务/日志事件，用于 WebUI 状态同步。

## 5. Project

```text
projects/<project-id>/
  project.json
  assets/<background>
```

`project.json` 关键字段：

- `schemaVersion`
- `id/name/width/height/summary/layers`
- `prompt/negative/seed/steps/cfg`
- `modelBundleId/deviceId`
- `seriesId/page`
- `backgroundPath`
- `createdAt/updatedAt`

旧 `instanceId` 字段不再写入；读取到也忽略。

## 6. 数据边界

- Project 只引用模型/引擎/设备，不引用 Instance。
- 模型文件不复制进 Project。
- 训练数据在 `trainer/`，不进入 Project。
- 删除 Project 不删除模型/输出（输出由画廊管理）。
