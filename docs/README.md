# MossStudio 文档索引

本目录描述 MossStudio 的**当前产品设计、当前实现和下一阶段计划**。
文档只记录可以核对的事实；代码路径存在但未在目标设备验证的能力，会明确标为
“代码路径 / 未验收”，不写成“已完成”。

## 1. 事实来源顺序

发生冲突时，按以下顺序取信：

1. **代码与运行结果**：`apps/desktop/`、`runner/`、`release/`；
2. **[status.md](status.md)**：当前完成度、验证证据、已知限制；
3. **[architecture.md](architecture.md)**：当前代码结构、数据流、持久化；
4. **[product-design.md](product-design.md)**：产品形态、交互与视觉规范；
5. **[roadmap.md](roadmap.md)**：下一阶段计划与验收条件；
6. **ADR / research / future 文档**：当时的设计依据或未来方案，不代表已实现。

README、公告（`release/README.md`）是面向用户的摘要，不替代 status。

## 2. 状态标记

| 标记 | 含义 |
| --- | --- |
| ✅ | 已实现，且有本机可重复的验证证据 |
| 🟡 | 已实现代码路径，但未在目标硬件/真实数据上验收，或只完成一部分 |
| ⬜ | 未实现，只有设计或占位 |
| ⏳ | 已排期，尚未开始 |

## 3. 版本与修订号

- 应用包版本：`package.json` / `release/manifest.json` 的 `0.1.0`；
- 设计与文档修订号：**v0.4**（2026-10-19）；UI v0.5、ADR-0005（发布/更新）与 ADR-0006（系统工具链）是同日增量；
- UI v0.2 / v0.3 / v0.4 / v0.5、Trainer v0.4 是**设计与交付批次名**，不是应用 semver；
- 公告里的“开发版 0.1.0”指应用包版本。

## 4. 文档地图

| 文档 | 作用 | 当前性 |
| --- | --- | --- |
| [../README.md](../README.md) | 项目总览、MossStudio、快速开始、能力矩阵 | 当前 |
| [product-design.md](product-design.md) | 产品定位、MossStudio、桌面/Web 两种呈现、边界 | 当前（2026-10 方向变更） |
| [architecture.md](architecture.md) | 当前代码结构、数据模型、持久化、IPC、训练/推理链路 | 当前（含目标架构） |
| [status.md](status.md) | 完成度、证据、未做事项、下一轮入口 | **事实来源** |
| [roadmap.md](roadmap.md) | 下一阶段工作流、优先级、验收条件 | 当前计划 |
| [layout-schema.md](layout-schema.md) | 官方 layout JSON 与编辑器字段规范 | 稳定契约 |
| [backend-and-project.md](backend-and-project.md) | Clover HTTP/WS、token、Project JSON/图层 | 当前 |
| [release-and-updates.md](release-and-updates.md) | GitHub Release 发布源、release.md 契约、更新下载 | 当前 |
| [toolchain-and-onboarding.md](toolchain-and-onboarding.md) | 系统 Git/Python 扫描、安装引导、OOBE 工具链准备 | 设计已确认，未实现 |
| [agent-and-prompt.md](agent-and-prompt.md) | Agent、AI Provider、提示词分段/确认、数据边界 | 当前基座 |
| [model-notes.md](model-notes.md) | MOSS-Image 模型结构、预算、采样约定 | 参考资料 |
| [research/upstream-survey.md](research/upstream-survey.md) | 上游项目调研 | 立项参考 |
| [research/upstream-2026-10-20.md](research/upstream-2026-10-20.md) | 2026-10-20 上游 MOSS/Trainer 复查与兼容结论 | 当前研究 |
| [future-inference-engine.md](future-inference-engine.md) | V2 自研推理引擎设想 | **未排期** |
| [benchmarks/v2-mnn-spike.md](benchmarks/v2-mnn-spike.md) | V2 MNN spike | **未排期** |
| [decisions/](decisions/) | ADR：为什么这样选；发布/更新 ADR-0005、工具链 ADR-0006、MossStudio ADR-0007 | 历史依据 |
| [../apps/README.md](../apps/README.md) | 开发者手册：目录、窗口、自检命令 | 当前 |
| [windows-validation-guide.md](windows-validation-guide.md) | Windows 开发环境、场景测试与人工验收记录 | 当前验收手册 |
| [../runner/README.md](../runner/README.md) | 薄 runner 协议与模拟模式 | 当前 |
| [../release/README.md](../release/README.md) | 面向用户的公告/发布说明；发布时生成 release.md | 当前公告 |

## 5. 维护规则

1. 新功能先更新 `status.md`，再更新 README/公告；
2. “代码路径存在”只能标 🟡，等目标硬件/真实数据验证后再改 ✅；
3. 不把未来设计写进“现在能做什么”；未来方案放 roadmap 或 future 文档；
4. 截图统一由 `--screenshot` 生成，放入 `docs/assets/`；截图中的 dev 数据可以清理；
5. 术语以 [product-design.md §3](product-design.md) 为准：
   Instance、Case、Project、Job、Runtime、TrainerVersion、TrainingHost 不混用；
6. 修改窗口/路由/尺寸/IPC 时，同时检查 README、product-design、architecture、
   apps/README 四处，避免窗口/路由数量再次不一致；
7. ADR 记录当时的决策，不改写历史；如决策变化，新增“修订”章节。

## 6. 本机验证环境

| 项 | 值 |
| --- | --- |
| 机器 | Apple M3 / 16 GB |
| 系统 | macOS 15.7.7 |
| 应用数据 | `.dev-data/`（已忽略） |
| 27 GB SFT 权重 | 未下载 |
| NVIDIA CUDA | 无 |
| Windows | 未实机验证 |

因此，涉及 CUDA、真实权重、Windows 的结论只能标 🟡 或 ⬜。
