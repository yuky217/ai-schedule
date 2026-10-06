# AI 日程（工作目录名 `ai-schedule`）

> AI 辅助的个人日程与任务系统。**第一目的：① 省事；② 做完事。**
> 本文档只讲"工程怎么落地"。产品层面的定论以《项目主文档》为准。

---

## 一、技术栈

| 项 | 选择 | 说明 |
|---|---|---|
| 框架 | Expo SDK 57 + React Native 0.86 | 跨平台，一套代码出双端 |
| 语言 | TypeScript（`strict: true`） | 领域层零 `any`，类型即文档 |
| 路由 | `expo-router`（文件式路由） | `src/app/` 下的目录结构就是路由表 |
| 本地库 | `expo-sqlite`（异步 API） | 纯本地优先，离线完全可用；web 端走 wa-sqlite（OPFS） |
| 状态 | `zustand` + `AsyncStorage` 持久化 | 设置持久化、数据状态集中 |
| 时间 | `date-fns`（中文 locale） | —— |
| 手势/动画 | `react-native-gesture-handler` + `react-native-reanimated` | Expo Go 内置。**禁止手写 `PanResponder`**（与滚动/点击/翻页互抢，必踩坑） |
| 单测 | `vitest` | 只覆盖 `domain/`（纯逻辑、零 RN 依赖），node 环境运行，不装 jest-expo |

## 二、快速开始

```bash
cd ai-schedule
npm install
npm start          # 扫码用 Expo Go 打开
npm run android    # 或 npm run ios / npm run web
```

类型检查、单测与打包自检：

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run —— domain 纯逻辑层
npm run test:watch

# 打包自检：产物输出到**项目外**的临时目录
npx expo export --platform android --output-dir ../_verify/android
npx expo export --platform web     --output-dir ../_verify/web
```

> **改完 `domain/` 必须先跑 `npm test`**，再跑 `typecheck`。
> 纯逻辑层的用例是唯一能挡住"口径悄悄变味"的东西。

> **产物目录不要建在项目内，也不要在项目内建校验目录。**
> 目录里的文件数一旦超过安全删除的批量阈值（50），`expo export` 写盘前清空输出目录的动作会被拦下，
> 表现为"导出莫名失败"。每次用一个**全新**的输出目录最省事。

### 版本管理

仓库已 `git init`（分支 `main`）。首次提交后，较大的改动建议各成一次提交，
提交信息写清"改了什么 + 为什么"。仓库是**纯本地**的，尚未配置远端。

提交身份目前是仓库级配置（`艾粤希 <aiyuexi@localhost>`）——若要推到 GitHub，
先改成你账号绑定的邮箱，否则贡献记录不会归属到你的账号：

```bash
git config user.email "你的邮箱"
```

### 本机踩过的坑

项目根 `.env` 已固化 `EXPO_NO_METRO_LAZY=1` 与 `EXPO_NO_TELEMETRY=1`（Expo CLI 启动时自动读取，**勿删**）。
注意 `npm_config_cache`、`HOME`/`USERPROFILE` 必须在 shell 层设置（npm 与 CLI 早期启动就要用，
`.env` 加载前已读取）；遇到第 1、2 条报错时按提示手动带上。

1. **`npm install` 报 `[safe-delete] 操作失败` / `EPERM`**
   本机的回收站机制会拦截 npm 的清理动作。指定一个普通目录当缓存即可：
   ```bash
   npm_config_cache="D:/艾粤希/.npm-cache" npm install
   ```
2. **Expo CLI 报 `EPERM ... .expo\state.json`**
   CLI 往用户目录写遥测文件被拦。把 HOME 指到可写位置：
   ```bash
   HOME="D:/艾粤希/.expo-home" USERPROFILE="D:\\艾粤希\\.expo-home" \
     EXPO_NO_TELEMETRY=1 npx expo start
   ```
3. **装完后 `tsc` 报一堆 "Could not find a declaration file for module 'expo-router'"**
   部分包的 `.d.ts` 在安装过程中丢失（只剩 `.d.ts.map`）。修复方式：把官方
   tarball 直接覆盖解压回 `node_modules/<pkg>`（不删文件、只补缺）。
4. **web 打包报 "Unable to resolve module ./wa-sqlite/wa-sqlite.wasm"**
   Metro 默认不把 `.wasm` 当资源解析。已通过根目录 `metro.config.js` 修复：
   `assetExts.push('wasm')` + 开发服务器加 COOP/COEP 响应头
   （`expo-sqlite` 的 web 端依赖 SharedArrayBuffer）。该文件是必须保留的。
5. **web dev 首屏报 "Metro error: Worker chunk not found for: expo-sqlite/web/worker.ts"**
   根因：Metro 默认 lazy bundling（dev 端 web 首次构建的图不含异步模块），
   而 expo-sqlite 的 web worker 恰是异步模块，序列化时断言"必须为 worker 单独出 chunk"失败。
   已通过项目根 `.env` 的 `EXPO_NO_METRO_LAZY=1` 修复（关掉 lazy，worker 进图）。
   静态导出（`expo export`）不走 lazy，不受此问题影响。
6. **`vitest.config.ts` 报 "ESM syntax in a file loaded as CommonJS"**
   配置文件**必须叫 `vitest.config.mts`**。也**不要**给 `package.json` 加 `"type": "module"`——那会搞坏 Expo。
   另外 `@` 别名要在 vitest 的 `resolve.alias` 里**再配一遍**：vitest 不读 tsconfig 的 `paths`。

## 三、目录结构（三层架构的物理映射）

```
src/
├── app/                        # 页面装配层：只负责"拼界面 + 调状态"，不写业务规则
│   ├── _layout.tsx             #   根布局：主题 + 拉起本地库 + 路由注册
│   ├── (tabs)/
│   │   ├── _layout.tsx         #   底部五个 Tab
│   │   ├── index.tsx           #   首页：快速记录 + 今日 + 专注/回顾/设置入口
│   │   ├── inbox.tsx           #   收集箱（中档待规划，长按拖拽排序）
│   │   ├── calendar.tsx        #   日历（月/周/日三视图，长按拖拽改期）
│   │   ├── projects.tsx        #   项目/目标/文件夹（含甘特图视图）
│   │   └── ideas.tsx           #   想法库
│   ├── task/[id].tsx           #   任务详情（所有编辑动作在这里；列表行只做"看一眼 + 勾一下"）
│   ├── container/[id].tsx      #   容器详情（含甘特图）
│   ├── habits.tsx              #   习惯打卡（不占 Tab，首页一张卡进）
│   ├── marks.tsx               #   纪念日（不占 Tab）
│   ├── review.tsx              #   「回」回顾与统计
│   ├── capture.tsx             #   快速记录（模态，入口层）
│   ├── focus.tsx               #   专注界面（模态）
│   └── settings.tsx            #   设置（提醒 / 高级功能 / 数据 / 备份）
│
├── domain/                     # 【纯逻辑】不依赖 React Native / Expo，可单测
│   ├── enums.ts                #   任务类型、状态、时间属性、完成判定、优先级…
│   ├── task.ts / idea.ts / container.ts / focus.ts / checkins.ts / marks.ts
│   ├── base.ts                 #   公共字段（含同步预留字段）
│   ├── factory.ts              #   实体工厂，默认值只有一份定义
│   ├── routing.ts              #   ★ 两档分流：灵感 vs 待办 → 想法库/收集箱/日历
│   ├── scheduling.ts           #   ★ 优先级打分、自动填充输入、时长/频率自动完成
│   ├── parse-schedule.ts       #   从一句话里解析时间（纯本地启发式，无需 AI）
│   ├── schedule-presets.ts     #   时间预设 + 自定义时间构造
│   ├── repeat-next.ts          #   重复规则 → 下一次该排的时间
│   ├── subtask-progress.ts     #   子任务进度与父任务完成态推导
│   ├── focus-link.ts           #   专注 ↔ 任务：按完成判定分流
│   ├── container-stats.ts      #   容器进度（只算直属任务，不递归子容器）
│   ├── gantt.ts                #   甘特图纯布局 + 改期纯函数
│   ├── calendar-window.ts      #   日历数据窗口（月视图按整周网格 + 两端 7 天余量）
│   ├── review.ts               #   ★「回」的全部口径
│   ├── ordering.ts             #   排序次关键字（保证行序确定）
│   └── *.test.ts               #   vitest 用例，与源文件同目录
│
├── data/                       # 【数据层】本地优先，预留同步
│   ├── db/schema.ts            #   DDL 与索引（当前 SCHEMA_VERSION = 3）
│   ├── db/client.ts            #   连接单例 + 迁移 + 事务封装
│   ├── db/mappers.ts           #   行 ←→ 领域对象（唯一知道列名的地方）
│   ├── db/sql.ts               #   INSERT/UPDATE 语句拼装
│   ├── db/touch.ts             #   写入前统一打时间戳、synced → dirty
│   ├── repositories/           #   界面唯一被允许触碰数据的入口
│   └── backup/                 #   导出 / 导入（JSON 信封，带 schemaVersion）
│
├── capabilities/               # 【能力层】AI，可开关，默认全关
│   ├── types.ts                #   六项能力 + 闸门（CapabilityGate）
│   ├── client.ts               #   调用契约与守卫（尚未接真实模型）
│   └── desensitize.ts          #   调用前脱敏：手机号/邮箱/身份证/银行卡
│
├── entry/                      # 【入口层】所有记录入口最终都汇到这里
│   ├── quick-capture.ts        #   记 → 分 → 落 的唯一实现
│   └── notifications.ts        #   有时间才排提醒，失败不影响记录
│
├── state/                      # 客户端状态
│   ├── app-store.ts            #   inbox / today / ideas / 生长秒数 / dataVersion
│   └── settings-store.ts       #   高级开关、AI 能力开关、接口配置（持久化）
│
├── components/                 # 通用组件（screen / card / task-row / calendar-* / gantt-chart /
│                               #   focus-bars / checkin-heatmap / choice-sheet / date-time-picker …）
├── constants/theme.ts          #   颜色、字体、间距（模板自带，沿用）
├── hooks/                      #   useTheme；use-cross-day-drag（跨天拖拽的唯一入口）
└── utils/                      #   id 生成、日期时间格式化

vitest.config.mts               # 单测配置（必须是 .mts）
metro.config.js                 # wasm 资源解析 + COOP/COEP 头（expo-sqlite web 必需）
```

## 四、主流程 ↔ 代码位置

| 主流程 | 落点 |
|---|---|
| **记** | `components/capture-input.tsx`（首页/想法库内联）、`app/capture.tsx`（模态，可带时间） |
| **分** | `domain/routing.ts` → `decideRoute()`：灵感进想法库；有时间进日历；没有进收集箱 |
| **落** | `entry/quick-capture.ts` → 写库 +（有时间才）排提醒 |
| **行** | `app/focus.tsx`：进入即计时，退出即结束；`domain/scheduling.ts` 决定"先做谁"；`domain/focus-link.ts` 把专注时长回写到任务 |
| **完** | `taskRepository.complete()`；时长/习惯型由 `isCompletionSatisfied()` 自动判定；子任务由 `domain/subtask-progress.ts` 推导父任务完成态 |
| **回** | `app/review.tsx` + `domain/review.ts`（口径只有一份，含确定性排序）；备份见 `data/backup/`；AI 复盘能力待接入 |

## 五、几条必须守住的约定

1. **界面不直接碰数据库。** 一律走 `repositories`；跨页面的数据联动统一由 `app-store.refresh()` 完成。
2. **软删除。** 删除只写 `deleted_at`，所有查询自动带 `deleted_at IS NULL`。删掉的东西要能同步出去。
3. **同步预留字段。** 每张表都有 `updated_at / deleted_at / remote_id / sync_state`。现在完全当纯本地用，将来升级"本地优先 + 云同步"不用改表、不用迁移。
4. **只涨不落。** 专注界面的"小东西"用 `growth_seconds`，取 `max(历史, 本次)`，暂停、中断、提前结束都不会缩水——不惩罚是这个产品的底线。
5. **AI 默认关闭，且关闭时产品完整可用。** 日历、清单、收集箱不依赖任何 AI 能力；能力关闭时自动降级到 `domain/routing.ts` 的本地启发式。
6. **脱敏在调用前。** 任何走云端的文本都先过 `capabilities/desensitize.ts`，并把遮蔽数量如实告诉用户。
7. **产品要最简。** 高级功能一律藏在 `settings.advancedEnabled` 之后，默认不开。
8. **排序必须确定性。** 分组/列表排序不能只按数量降序就收工——数量相同时先后会取决于数据读出来的顺序，
   界面行序会莫名跳动。必须补一个固定的次关键字（见 `domain/review.ts` 的 `KIND_ORDER`）。
9. **完成动作只由明确的勾选触发。** 点行/点块 = 进详情，长按 = 拾起拖拽。
   任何"点一下就算做完"的设计都算误触，禁止。
10. **页面不能因为数据为空就整页 early return。** 空态只能替换内容区，导航（工具栏、翻页）必须一直在
    ——日历就踩过：空月份里连翻页按钮都没了。

## 六、数据库

七张业务表 + 一张元信息表：`tasks` / `ideas` / `containers` / `task_chains` / `marks` / `focus_sessions` / `task_checkins` / `app_meta`。

- 嵌套属性（`time`、`progress`、`repeat`、`tags`、`steps`）以 JSON 列存放，领域层看起来仍是嵌套对象，映射细节只在 `data/db/mappers.ts`。
- 索引按真实查询路径建：状态、截止、开始、所属容器，且都带 `deleted_at`。
- 升级表结构时递增 `SCHEMA_VERSION`；备份文件里也带这一版号，便于写迁移。
- **当前 `SCHEMA_VERSION = 3`。** v3 引入：`tasks.parent_task_id`（子任务，只允许一层）、
  `tasks.sort_order`（手工排序，NULL 视为 0）、`task_checkins`（打卡记录）。
- 列表查询一律带 `parent_task_id IS NULL`（仓储里的 `TOP_LEVEL` 常量）；
  排序一律 `ORDER BY COALESCE(sort_order,0) ASC, created_at DESC`（新任务在最上面）。

### 子任务 / 打卡的语义边界（别混）

- **子任务** → 父任务完成态**自动推导**（全完成 = 完成，取消一个 = 打回待办）。
- **打卡** → **不**改任务状态（除"每周 N 次"这类频率型达标）。
  习惯的"做完"是"今天做了"，明天还得出现；"今天做没做"看打卡表，"这件事还做不做"看 `task.status`。

### 日历数据是"按可见范围查"的

日历**不**从全局 store 拿全部任务：个人日程攒上几年就是几千条，而屏幕上永远只有一个月。
窗口算法在 `domain/calendar-window.ts`，查询走 `taskRepository.listScheduledBetween`
（判据是**时间窗重叠**，用 `COALESCE(start_at, due_at)` / `COALESCE(due_at, start_at)` 两端夹，
不是比单一锚点——只比 `start_at` 会漏掉"上个月开始、下周截止"的任务）。
页面自己 load，并以 store 的 **`dataVersion`**（每次 `refresh` 自增）作为失效信号。

## 七、备份与恢复

- **导出**：`exportBackup()` → 写入 `document/backups/`，再唤起系统分享面板。用户可以存网盘或发给自己。
- **导入**：`restoreFromPicker('replace')` → 选文件、校验格式、整库事务内覆盖写入；失败整体回滚。
- 备份存的是**数据库原始行**，目标是原样恢复，不是给人看的漂亮 JSON。

## 八、当前状态与后续路线

**主流程「记 → 分 → 落 → 行 → 完 → 回」已全链路打通。**

- **记 / 分 / 落**：一句话记录（`capture-input`），自动识别时间（`parse-schedule`，纯本地启发式），
  按两档分流落到想法库 / 收集箱 / 日历；有时间就自动排提醒。
- **收集箱**：长按拖拽排序；点条目弹出高频时间预设（今天 / 明天 / 今晚），安排后自动落日历并重排提醒。
- **日历**：月（网格 + 圆点密度）/ 周（7 天列 × 小时轴网格）/ 日（时间轴）三视图。
  - 月视图：长按任意一行拖到日期格上改期（保留原时刻）。
  - 周视图：长按任务块**横拖换天 + 纵拖换时刻**（一次手势两轴），跨天落下自动切到那天的日视图。
  - 日视图：长按任务块上下拖改时刻（吸 15 分钟刻度）。
- **项目 / 目标 / 文件夹**：容器是唯一实体，**甘特图只是视图**（`domain/gantt.ts` 纯布局）。
  任务条可长按拖拽改期（整天平移、保留时分）；容器条不给拖——它是框架，拖它就该连成员一起推，那是另一件事。
- **行**：专注界面（正计时 / 倒计时 / 番茄钟），小东西随专注时长生长（只涨不落），
  时长按 `domain/focus-link.ts` 分流回任务；**勾选型任务只累计时长、不自动完成**（不替用户下结论）。
- **完**：勾选完成；子任务自动推导父任务；习惯打卡独立计数。
- **回**：`app/review.tsx`。区间切换（本周 / 本月 / 近 7 天 / 近 30 天）→ 小结 → 三个大数字 →
  专注趋势（自绘柱状图，不引图表库）→ 完成情况（按类型 / 按清单）→ 习惯热力图。
  立场：**只报做到了什么，不盘点没做到什么**。
- **其他**：习惯打卡页、纪念日、子任务、备份导出 / 恢复、AI 能力层契约（默认全关）。

**下一步（按优先级）**：

1. **入口层**：悬浮窗 / 语音 / 截图 / 转发——把"记录无感"真正做出来（主文档里的入口层）。
2. **提醒的可靠性**：重复提醒（习惯型按 `repeat` 排期）、到点后的沉淀。
3. **链（模板 / 工作流）**：完成 A 自动生成 B 的触发器。
4. **能力层接真实模型**：把 `capabilities/client.ts` 里的 `performRemoteCall()` 换成真实请求；
   上线「理解」「语义检索」两项先行。
5. **想法库 + 语义检索**：可能成为与"待办"并列的第二条大腿。
6. **小东西的动效与白噪音**：目前是静态圆形，按生长量缩放。
7. **桌面小组件**：日程组件 + 多种日历视图 + 专注组件。

## 九、已知限制

- **提醒（2026-10-06 更正）**：`expo-notifications` 从 SDK 53 起**只有远程推送**被移出 Expo Go，
  **本地通知仍然可用**（官方文档原话："Local notifications (in-app notifications) remain available in Expo Go"）。
  因此 `entry/notifications.ts` 只挡 web 端，不再因 `isExpoGo()` 一刀切禁用。
  惰性动态加载（禁止顶层 import）保留，但它是**打包链的兜底**，不是平台判断。
  设置页有「提醒」卡：显示真实状态 + 一键试发 5 秒后的提醒。
  `app.json` 已加 `SCHEDULE_EXACT_ALARM`（Android 12+ 精确闹钟，为 development build 预备）。
  > **教训：别把某次打包报错误判成平台限制。**
- 日历三视图与甘特图的拖拽改期均已可用。
- 识别日程为启发式规则（覆盖今天/明天/周X/M月d日/时刻/相对时间/截止"前"），
  复杂表达（如"下下下周"、"农历"）不在覆盖范围，识别不出就进收集箱，不会瞎猜。
- 能力层是契约与守卫，未发起真实网络请求。
- 专注界面暂未绑定"从哪个任务进入"的选择器（`focus.tsx` 已支持 `taskId` 参数，缺入口）。
- 备份恢复默认整库覆盖，"合并导入"（`importBackup(envelope, 'merge')`）已实现但缺 UI 入口。
- 优先级**不出现在界面上**（`Priority` 字段保留给将来的自动填充）。
