# ADR-0008：单 Studio 窗口、工作台覆盖层与可停靠面板

- 状态：Accepted
- 日期：2026-10-22

## 背景

MossStudio 已经有创作、终端、设备、实例、模型、训练等多个入口。独立窗口越多，用户越容易在多窗口之间丢失上下文；同时创作页本身被固定侧栏和项目管理器切碎，画布占比不足。

## 决策

1. **只保留两个 BrowserWindow**：`studio` 与 `trainer`。`studio` 使用较大的普通窗口（1600×1000 起始，不调用 OS 全屏）；`trainer` 仍单独保留。
2. **launcher / devices / terminal 不再是窗口**。设置、实例、模型与下载、设备、训练、画廊、诊断统一进入 Studio 左上角的“工作台”全屏覆盖层；终端变为 Studio 底部抽屉。
3. **创作页为三列**：左侧生成参数面板，中间画布与生成工具条，右侧图层/布局面板；AI Agent 是右下 320×300 的浮动小面板。
4. **面板可停靠**：面板头部可拖到左槽、右槽或画布悬浮层；停靠关系暂不持久化。
5. **项目管理器移除**：顶部直接显示可横向滚动、可拖动排序的画布 tabs；`+ 新建画布` 在 tabs 右侧，tab 显示名称和保存状态。
6. **画布交互**：滚轮缩放；`手型` 工具拖动平移；`画框/选择` 继续负责区域编辑。
7. **兼容入口映射**：旧的 `openWindow('launcher'|'creator'|'terminal'|'devices')` 调用被映射为 Studio 内的管理/抽屉意图，不再创建新窗口。

## 后果

- 启动即进入创作，管理面不再抢占主流程。
- Studio 的窗口状态更简单，但 Agent 浮窗会覆盖右下方面板，后续需要可折叠/可拖拽位置持久化。
- 管理页仍复用原页面组件，路由仍走同一 HashRouter。
- 训练 UI 保留独立窗口，因此“两个窗口”是 Studio + Trainer，不含系统级弹窗/模态。

## 验证

- `--scenario=windows` 只创建 Studio 和 Trainer。
- `pnpm typecheck`、`pnpm build`、`--smoke`、`pnpm test:ui` 通过。
- `--screenshot` 生成 Studio/管理页/Trainer 截图。
