# 足迹（内置引擎）——在 TT 内部记录你的位置历史

**Footprint（足迹）** 是 TT 自带的位置档案。手机追踪 App 把位置直接上报到 TT，TT 存下这些点、算出你在哪里停留，然后把结果画到行程地图上，并推荐为日志条目、地点与国家——与 [Dawarich](Dawarich) 对接所喂给的界面完全一样，但不需要再跑一台服务器。

它是 Dawarich 连接的内置一半：同一张卡片，不同的数据来源。

> **插件。** 请在 [管理：插件](Admin-Addons) 中同时启用 **Footprint** 与 **Dawarich**。Footprint 负责档案与上报端点；Dawarich 负责读取它的那些界面（轨迹图层、建议面板、Atlas 推荐）。

## 两个数据来源，一张卡片

**设置 → 集成 → Dawarich** 的开头是**数据来源**选择：

| 来源 | 含义 |
|---|---|
| **外部 Dawarich 实例** | TT 从你自建的 Dawarich 服务器读取停留与轨迹（见 [Dawarich](Dawarich)） |
| **TT 内置引擎** | 手机直接上报到 TT 本身，不涉及外部服务器 |

界面只显示与所选来源相关的字段。切到内置引擎会隐藏实例表单并保留其内容，切回来时不必重新填写。

## 配置内置引擎

1. 启用 **Footprint** 与 **Dawarich** 插件。
2. **设置 → 集成 → Dawarich** → 选择 **TT 内置引擎** → **保存**。
3. 点击 **生成上报凭据**。凭据**只显示一次**，请当场复制；服务端只保存它的哈希，因此凭据丢失只能重新生成（旧凭据会立即失效）。
4. 在追踪 App 中把上报地址设为卡片上显示的地址：

   ```
   https://<你的TT地址>/api/v1/points/ingest
   ```

   凭据按 App 支持的任意一种方式携带即可：

   | 携带方式 | 取值 |
   |---|---|
   | 请求头 | `Authorization: Bearer <token>` |
   | 请求头 | `X-Ingest-Token: <token>` |
   | URL 参数 | `?token=<token>` |
   | URL 参数 | `?api_key=<token>` —— 官方 Dawarich App 使用的写法 |

5. 打开某个行程的地图，点右下角的小药丸按钮打开轨迹图层。

卡片上还会显示档案概况（已记录点数、最新位置时间），一眼就能看出手机是否在上报。

## 哪些手机 App 可用

只要能把一段 JSON 位置 POST 到指定地址，就都能用。以下为已验证可用的：

| App | 平台 | 说明 |
|---|---|---|
| **Dawarich**（官方） | iOS、Android | 把地址填成上面的地址并带 `?api_key=<token>`。走 `POST /api/v1/points`，TT 以该 App 本来就发给真实 Dawarich 服务器的相同格式提供服务 |
| **OwnTracks** | iOS、Android | TT 原生支持的格式。HTTP 模式 → URL 带 `?token=<token>`。免费开源 |
| **Overland** | iOS | 原生支持自定义端点；它的上报格式与官方 App 相同 |
| **GPSLogger** | Android | 最灵活：可自定义 URL、自定义 `Authorization: Bearer <token>` 请求头、自定义上报间隔。常见搭配 |
| **Home Assistant 伴侣 App** | iOS、Android | 用自动化把 `device_tracker` 位置通过 HTTP POST 发出 |
| **iOS 快捷指令 / Tasker / MacroDroid** | iOS、Android | 任何能定时发 HTTP POST 的工具，自己拼 JSON |

### 示例请求体

通用上报路由（`/api/v1/points/ingest`）接受 OwnTracks JSON——单条记录、数组、`{"_type":"batch","data":[…]}` 信封，或 `{"points":[…]}`：

```json
{"_type":"location","lat":31.2304,"lon":121.4737,"tst":1758900000,"acc":12,"batt":80}
```

Dawarich App 兼容路由（`/api/v1/points`）接受官方 App 所用的 Overland 风格 GeoJSON：

```json
{
  "locations": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [121.4737, 31.2304] },
      "properties": {
        "timestamp": "2026-09-26T10:00:00.000Z",
        "horizontal_accuracy": 12,
        "battery_level": 0.8,
        "speed": 1.4,
        "altitude": 43
      }
    }
  ]
}
```

几个能省下一下午排查时间的要点：

- OwnTracks 路由的 **`tst` 是 unix 秒**，不是毫秒。Dawarich 兼容路由两者都接受（unix 秒或 ISO-8601 字符串）。
- GeoJSON 形式的坐标是 **`[经度, 纬度]`**，与口语习惯相反。
- GeoJSON 形式的 **`battery_level` 是 0–1 的小数**（Overland 约定）；大于 1 的值按百分比读取。
- `(0, 0)` 定位会在入口被丢弃，因此还没搜到星的追踪器不会在非洲西海岸种下一个点。
- **重复上报安全且无副作用**：点按（用户、时间戳、纬度、经度）去重，追踪器断网后重试整批也不会产生重复点。

## TT 拿这些记录做什么

点进来之后，TT 会在其上运行停留判定——与 Dawarich 相同的算法，逐阶段移植（时间序扫描聚类、静默桥接、链式合并，再做最短停留/最少点数过滤与置信度打分）。由此产出：

- **地图上的轨迹**——按天分段的线，画在行程地图与[旅程日志](Journey-Journal)上。由地图右下角的小药丸按钮开关，按钮本身也显示状态。
- **停留建议**——"你在这里待了 25 分钟"，在建议面板里推荐为日志条目、地点或国家，与外部实例完全一致。**在你确认之前不会添加任何内容。**
- **愿望清单匹配**——愿望清单扫描可以告诉你某次已记录的停留是否真的到过你想去的地方。
- **Atlas 推荐**——记录显示你去过的国家，推荐给[足迹](Atlas)（只推荐，从不自动应用）。

这里不会向任何外部服务回写——档案就在 TT 自己的数据库里，整个流程是它的读取方。

## 隐私与实用说明

- 点以 WGS-84 存储在 TT 自己的数据库中，带你的 user id——与其它行程数据同一个库。
- 上报凭据是**每用户一个**，且只存哈希；设置卡片最多显示其前缀，永远不显示凭据本身。
- 档案隶属于 Footprint 插件：关闭插件会停止相关端点与本地读取（点仍留在数据库中）。
- 上报的点与判定出的停留都是**按需重算**的——没有后台任务写入派生行，因此调整判定阈值会立刻改变结果。

## 判定算法的来源

停留判定是逐阶段移植自 **[Freika/dawarich](https://github.com/Freika/dawarich)**
的到访判定器——时间序扫描聚类、静默桥接、状态合并、策略常量与置信度打分都保留
了上游的命名与行为，因此此处判定出的停留与 Dawarich 实例判定出的同一次停留具有
相同的边界。这也是同一套界面能同时读取两个来源而不必关心是谁作答的原因。

它是到 TypeScript 的翻译，而不是对 Dawarich 的调用：不运行任何 Ruby，构建期与
运行期都不共享代码，TT 对该仓库没有任何依赖。上游的源文件清单见
`server/src/nest/footprint/detection/README.md`。

两个项目均以 **AGPL-3.0** 授权。原始算法及其实现的著作权仍归 Dawarich 的作者；
本移植在各文件头部保留来源标注，并按 TT 自身的 AGPL-3.0 条款分发。

## 相关

- [Dawarich](Dawarich)——本页所替代的外部实例方式，以及两者共同喂给的界面。
- [旅程日志](Journey-Journal)——被确认的停留会变成什么。
- [足迹图册](Atlas)——国家与城市那部分。
