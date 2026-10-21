# 发布源、模型目录与更新

- 状态：代码路径已接；真实 GitHub Release 资产、签名安装包、electron-updater 未验收
- 决策：[ADR-0005](decisions/0005-release-channel-and-updates.md)
- 应用版本：`0.1.0`

> 截图为 `9.9.9` 测试数据，只展示交互，不是真实发布版本。

## 1. 发布源

> 发布源是**项目 GitHub Release 页面**，不是应用内另建一套 release 元数据；
> 本地 `release/` 只是开发/离线回退。

稳定版默认读取 GitHub Release 的 latest 资产：

```
https://github.com/CloverIris/MossStudio/releases/latest/download/release.md
```

读取顺序：

1. 开发模式：本地 `release/release.md`（`CLOVER_RELEASE_FILE` 可指向测试文件）；
2. 打包模式：latest 资产 → raw `main/release/release.md` → jsDelivr 镜像；
3. `cache/release-v2-<channel>.json` 的最后一次成功文档；
4. 本地 `release/release.md`；
5. 旧 `manifest.json` + `models.json` + `README.md` 的只读回退。

Beta 通道先读 `releases/download/beta/release.md`，不存在时回退 latest/raw。
设置里可选「稳定版 / Beta」。

## 2. 文件职责

| 文件 | 角色 |
| --- | --- |
| `release/release.md` | GitHub Release 页面正文 + `json clover-release` 机器块；版本、安装包、首页文案、公告、模型表镜像 |
| `release/manifest.json` | 应用版本/通道/首页文案/公告/安装包元数据的维护源 |
| `release/models.json` | **模型/适配器下载目录的机器源**；应用仍从这里取下载数据 |
| `release/README.md` | 人可读发布说明；生成器会去掉维护者章节 |
| `tools/release-md.mjs` | 从 manifest + models + README 生成 release.md |

`release.md` 中的模型表是发布页镜像，不是第二下载数据源。生成器会校验
`apps/desktop/package.json` 与 `manifest.app.version` 一致，不一致直接失败。修改模型后运行：

```bash
pnpm release:md
pnpm release:md:check
```

## 3. release.md 契约

正文给人看；末尾固定一个机器块：

````markdown
```json clover-release
{
  "schema_version": 2,
  "app": {
    "name": "MossStudio",
    "channel": "stable",
    "version": "0.2.0",
    "min_supported": "0.1.0",
    "published_at": "2026-10-20T00:00:00Z",
    "notes_url": "https://github.com/CloverIris/MossStudio/releases/tag/v0.2.0"
  },
  "home": {
    "chapter": "万象初绘",
    "title": "一念落纸上，万象入画来。",
    "subtitle": "选好工作台、实例与设备，开始今天的创作。"
  },
  "installers": [
    {
      "platform": "darwin",
      "arch": "arm64",
      "kind": "dmg",
      "url": "https://github.com/.../MossStudio-0.2.0-arm64.dmg",
      "sha256": "…64 hex…",
      "size_bytes": 123456789
    }
  ],
  "catalog": {
    "updated_at": "2026-10-20T00:00:00Z",
    "models_url": "https://raw.githubusercontent.com/CloverIris/MossStudio/main/release/models.json",
    "models_sha256": "…64 hex…"
  },
  "announcements": [
    {
      "id": "2026-10-release",
      "level": "info",
      "title": "0.2.0 已发布",
      "body_markdown": "……",
      "starts_at": "2026-10-20T00:00:00Z",
      "ends_at": null,
      "dismissible": true,
      "pinned": true,
      "action": { "label": "查看更新", "kind": "check_update" }
    }
  ]
}
```
````

解析器只接受 `schema_version: 2`；URL 必须是 HTTPS，installer 必须带 64 位 hex sha256。
应用解析器在 `apps/desktop/src/shared/release.ts`。

`home` 是可选字段，用于远程更新启动器首页的篇章名、主标题和副标题。字段值按纯文本渲染，不支持 HTML；各项长度由 schema 限制。开发时编辑 `release/manifest.json`，再运行 `pnpm release:md` 生成发布文档。旧版 release 缺少 `home` 时，首页使用应用内置文案；清空字段可回退至默认值，不会影响启动器或公告加载。

## 4. 版本与更新流程

1. 应用版本取 `app.getVersion()`；发布版本取 `release.md.app.version`；
2. semver 比较包含 prerelease（`0.2.0-beta.1 < 0.2.0`）；
3. `autoCheckUpdates` 开启时，启动检查；设置页可手动检查；
4. 发现新版本：LauncherShell 弹出 UpdateDialog，公告里也保留入口；
5. 用户点「稍后」写入 `dismissedUpdateVersion`，同版本不再自动弹；版本再变重新提示；
6. 用户点「下载并安装」：
   - 选择当前 platform/arch 的 installer；
   - 下载到 `downloads/updates/<version>/`，显示进度/速度/取消；
   - 校验 sha256；失败删除 `.part` 并报错；
   - 校验通过后打开安装程序（测试模式 `CLOVER_UPDATE_TEST=1` 不打开）；
7. 用户完成安装。应用不会静默重启。

网络/文件服务的实现见 `apps/desktop/src/main/services/release.ts` 与
`updateDownload.ts`；UI 见 `components/UpdateDialog.tsx`。

## 5. 发布检查清单

1. 改 `apps/desktop/package.json` 与 `release/manifest.json` 的 `app.version`；
2. 在 `manifest.installers` 写安装包（platform/arch/kind/url/sha256/size_bytes）；
3. 更新 `release/models.json`，运行 `pnpm release:md`；
4. 确认 `pnpm release:md:check`、`pnpm typecheck`、`pnpm build`；
5. 创建 GitHub Release（如 `v0.2.0`），上传 `release/release.md` 命名为 `release.md`
   以及安装包；
6. Beta 发布使用 prerelease + 固定 `beta` tag/资产；stable 才走 `latest`。

## 6. 已知限制

- 当前没有 electron-builder/electron-updater，也没有签名/公证产物；更新是
  “用户批准 → 下载 → 校验 → 打开安装包”，不是静默后台安装；
- 真实 GitHub Release 资产未验收；本地测试覆盖解析、semver、下载与面板渲染；
- macOS 未签名 DMG / Windows 未签名 NSIS 会被系统拦截或警告；
- `rules.json` 仍在旧文件，不随 `release.md` 迁移；
- 模型表由生成器镜像 models.json；如果只改 release.md 表格，应用下载目录不会变化。

## 7. 验证

```bash
pnpm release:md:check
pnpm typecheck
pnpm build
env -u ELECTRON_RUN_AS_NODE pnpm --filter @clover/desktop exec electron . --scenario=release-parse
env -u ELECTRON_RUN_AS_NODE pnpm --filter @clover/desktop exec electron . --scenario=update-download
env -u ELECTRON_RUN_AS_NODE pnpm --filter @clover/desktop exec electron . --scenario=update-dialog
```
