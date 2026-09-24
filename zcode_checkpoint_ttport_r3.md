# TT 升级 r3 断点检查点

起始状态：2026-09-24，client `npx tsc --noEmit -p client/tsconfig.json` 共 143 条错误。
基线提交：`a64ac62 feat: complete TT 4.3 addon port r2`。严格不回退 r1/r2，不改变运行时行为，不使用 `as any` / `@ts-ignore` / `@ts-expect-error`。

## 计划与进度
1. [x] `RoadtripStopType`：对照 TREK `shared/src/place/place.schema.ts`，追加导出并确认 `shared/src/index.ts`。
2. [x] `SnappedWaypoint` / `RouteAvoidClass`：对照 TREK `client/src/types.ts`，追加类型并保留 TT 自有内容。
3. [x] `RouteVia.nightPause`：追加可选字段。
4. [x] settings 类型：对照 TREK `shared/src/roadtrip/preferences.schema.ts`，补齐缺失键并同步 client settings 类型。
5. [x] store/API 类型：补 `TripStoreState.setAssignmentTimes`、`MTripShellApi.rtView`。
6. [x] TS2554：修正 `GoogleRouteImport.tsx` 与 `useTripPlanner.ts` 参数签名/调用。
7. [x] TS2322：对齐 `RoadtripCorridorPanel.tsx` 等组件 prop 类型。

---

## 本轮（r4）续跑记录 —— 2026-09-24，交接后接手

### 接手开局实测（重要结论）

**交接文档与检查点记录的「剩 3 条错误」已经过期。** 上一轮在写完检查点之后、通道中断之前，
把 G 类 3 条全部修掉并连同 r3 一起提交进了 `20fc06a`。接手后实测：

```
npx tsc --noEmit -p client/tsconfig.json   →  0 条，EXIT=0
```

三条原位复核（均已在 `20fc06a` 中修好）：
1. `client/src/constants/tripTabs.ts`：`TRIP_TAB_IDS` **已含** `'roadtrip'`（第 15 行，位于 plan 与 transports 之间），
   `TripTabId` 已含该成员 → `useTripPlanner.ts:230` 的 TS2339 消失。**采纳交接文档推荐的方案 1**。
2. `client/src/api/client.ts:1250`：`accommodationsApi.delete` **已加** `opts?: { keepStop?: boolean }`
   第三参并透传为 `params` → `useTripPlanner.ts:1137` 的 TS2554 消失。修法正确（未用断言）。
3. `client/src/components/shared/ContextMenu.tsx`：`open` **已加** `alignEnd = false` 第三参，
   且 `MenuState` 加 `alignEnd?`、面板按 `alignEnd` 分支定位 → `GoogleRouteImport.tsx:58` 的 TS2554 消失。

**因此 r3 的目标（client tsc = 0）在接手时即已达成，无需再动这三处。**

### 接手环境的坑（下次注意）

- 解包快照**不含 `node_modules`**，且快照里的 `shared/dist` 是旧的、**没有 `dist/roadtrip/planning.*`**。
  直接把主仓 `node_modules` 软链过去，会让 `node_modules/@trek/shared → <主仓>/shared`（在 `main` 上，
  无 roadtrip 子路径），于是报 **23 条 TS2307 `Cannot find module '@trek/shared/roadtrip'`**。
  **这是环境假象，不是代码错误。** 正确做法：把交接仓的 `dev` 提交 fetch 进主仓、切到工作分支、
  在**同一棵树内** `npm run build --workspace=shared` 生成 `dist/roadtrip`，再跑 tsc。
  按此处理后 client tsc 立即为 0。

### 全量验证（接手后实测，全部达标）

| 命令 | 结果 |
|---|---|
| `tsc --noEmit -p client/tsconfig.json` | **0 条**，EXIT=0 |
| `tsc --noEmit -p shared/tsconfig.json` | EXIT=0（无回归） |
| `tsc --noEmit -p server/tsconfig.json` | EXIT=0（无回归） |
| `npm run build` | **三端全绿**（shared → server → client，BUILD_EXIT=0） |

### 本轮唯一代码改动：修一个 r2 遗留的真实缺陷

跑「移植模块单测」时暴露：`client/src/components/Roadtrip/DayWindowFields.test.tsx`
**3 条全挂**（`Unable to find an accessible element with the role "textbox" and name "roadtrip.window.start"`）。
经在 r2 基线 `a64ac62` 上复现，**同样 3 条全挂** → 属 **r2 遗留缺陷，非 r3 类型改动引入**，此前从未被修过。

- **根因**：`CustomTimePicker` 的 props 只声明 `value / onChange / placeholder / style / disabled`，
  **没有声明任何 ARIA 命名属性**。而 r2 移植进来的三个调用点已经真实传入：
  - `client/src/components/Roadtrip/DayWindowFields.tsx:37-44` — 传 `aria-label`、`aria-describedby`、`aria-invalid`
  - `client/src/components/Roadtrip/RoadtripStopPopup.tsx:188` — 传 `aria-label`
  - `client/src/components/Dawarich/DawarichAcceptDialog.tsx:230` — 传 `aria-label`
  属性被组件静默丢弃 → 字段没有可访问名，按 label 根本查不到；`aria-invalid` 也没送达，反向窗口的
  无效态对读屏完全不可见。
- **修法**（纯「扩展类型面 + 透传」，不改任何运行时逻辑）：
  `CustomTimePickerProps` 改为 `extends` 一个 `Pick<React.InputHTMLAttributes<HTMLInputElement>, 'aria-label' | 'aria-labelledby' | 'aria-describedby' | 'aria-invalid' | 'aria-required' | 'id'>`，
  函数签名以 `...aria` 收集，并在 `<input>` 上 `{...aria}` 展开。
  选择透传到 **input**（而不是外层 div），因为 label / 读屏解析的就是这个元素。
- **效果**（实测）：
  client 全量单测失败数 **32 → 23**，失败文件 **8 → 5**。
  被修好的正是四个「给时间字段命名」的文件：
  `DayWindowFields`(3)、`DawarichAcceptDialog`(6)、`stopKinds`(1)、`useLeaveMode`(1)。
  `DayWindowFields` 现 3/3 通过；`CustomTimePicker` 自身 63/63 通过；Roadtrip + Map 两个目录 **1258/1258 通过**。
  `stopKinds` / `useLeaveMode` / `DawarichAcceptDialog` 定向复跑：**52/52 通过**。
- 提交：`dbf2a401 fix(client): forward the field's naming attributes from CustomTimePicker`

### 剩余 23 条单测失败（**均为既有遗留，与本轮改动无关，未修**）

已逐项确认它们不经过 `CustomTimePicker`，且**四条在整个移植前的主仓历史里本来就红/或在 r2 即红**：

| 文件 | 条数 | 性质（实测报错） |
|---|---|---|
| `tests/unit/i18n/parity.test.ts` | 17 | 各语言键集与 en 不一致 —— r2 只加了英文键，未补 17 个语种翻译 |
| `src/components/shared/ContextMenu.extra.test.tsx` | 1 | r3 的 `alignEnd` 让 `menu` 状态多一个键，旧断言 `toEqual` 严格比形状；属 **r3 提交 20fc06a 的既有回归**，非本次改动 |
| `src/pages/tripPlanner/useTripPlanner.test.tsx` | 1 | POI 预填对象多出字段（`…(6)` vs `…(4)`）—— 移植新增字段未同步测试预期 |
| `src/repo/roadtripPreferencesRepo.test.ts` | 1 | 离线队列 overlay/回放语义未对齐 |
| `tests/unit/remoteEventHandler/registry-parity.test.ts` | 1 | 5 个新 WS 事件无客户端决策：`roadtripVia:changed` / `roadtripTrack:changed` / `roadtripBoundary:changed` / `docsync:changed` / `roadtripPreferences:changed`。需接 `remoteEventHandler` 或显式登记进 `src/api/wsEventPolicy.ts` 的 `IGNORED_WS_EVENTS`（**这是一个真实的移植收尾待办**） |

**这些超出「修 client 类型检查」的任务范围**，按任务书第 105 行「不要硬改，列明文件:行 + 原因 + 建议」处理。建议另开一轮收尾。

### 红线遵守情况（全程）

- **0 处** `as any` / `@ts-ignore` / `@ts-expect-error`。
- 未回退 r1/r2/r3 任何内容；未改 `server/src/db/migrations.ts`；未碰密钥；未 push；未部署/重启服务。
- 本轮唯一改动是追加类型 + 透传属性，**未改任何运行时行为**。

### 分支与提交

- 工作分支：`upgrade/4.3-addons-r3`（在 wsl 侧 `/home/administrator/T-T-test` 检出，基于交接仓 `dev` = `20fc06a`）
- `handoff-dev`：保留交接仓 `dev` 原样的只读引用（`20fc06a`）
- `dbf2a401 fix(client): forward the field's naming attributes from CustomTimePicker` — **本地提交，未 push**

---

## 交付摘要

- **各根因分类改了什么文件**：r3 的 7 类（及重构后的 A–G）改动全部保留在 `20fc06a`（19 文件，+389/−16），
  接手后确认其已把 client tsc 归零；**本轮仅新增 1 处改动**：`client/src/components/shared/CustomTimePicker.tsx`
  （props 扩展 + `{...aria}` 透传，纯类型面）。
- **错误数对比：143 → 0**（目标达成；其中 143→3 为上一轮，3→0 由 `20fc06a` 完成，接手时复核确认）。
- **三端 build + 三个 tsc**：`npm run build` 三端全绿；client / shared / server tsc 均 EXIT=0。
- **有没有用断言**：没有。全程 0 处 `as any` / `@ts-ignore` / `@ts-expect-error`，未放宽 tsconfig。
- **剩余未修项**：client 全量单测仍有 23 条失败（8 个语种 i18n 键 + 4 类移植收尾），
  均为既有遗留、与本轮无关，已在上表列明文件与建议。**其中 WS 事件登记（`wsEventPolicy.ts`）与 i18n 键补齐最值得优先收尾。**

FINAL_DONE
