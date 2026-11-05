# FocusNow - 番茄钟

跨平台桌面应用，基于 Electron + React。

## 技术栈与版本锁定

严格使用以下版本，不要升级或替换：

| 依赖 | 版本 | 说明 |
|------|------|------|
|------|------|------|
| electron | 41 | 桌面应用框架 |
| @electron-forge/cli | 7 | 官方脚手架（创建、开发、打包、分发） |
| react / react-dom | 19 | UI 库 |
| typescript | 5 | Forge 模板内置 |
| vite | 5 | Forge 模板内置，不要升级到 6+ |
| @vitejs/plugin-react | 4 | Vite 的 React 插件，必须用 v4 (v5+ 要求 Vite 6 +) |
| tailwindcss | 4 | 使用 `@tailwindcss/vite` 插件，CSS-first 配置，不需要 PostCSS |
| shadcn/ui | latest | 组件库，按需安装 |
| node:sqlite | 内置 | Node.js 24 内置 SQLite 模块，无需安装，打包零配置 |
| chart.js | 4 | 图表库 |
| react-chartjs-2 | 5 | Chart.js 的 React 封装 |

## 关键技术决策
- **数据库用 `node:sqlite`，不用 `Supabase` 也不用 `better-sqlite3**。这是桌面应用，数据存本地。`node:sqlite` 是 Node.js 24 内置模块，无需安装任何 npm 包，打包时不需要任何特殊配置，彻底避免了原生模块的编译和打包问题。
- **`node:sqlite` 的使用方式**：用动态 `require()` 加载，避免 Vite 静态分析时出错。在 `vite.main.config.ts` 中将 `node:sqlite` 加入 `external`：

```typescript
// vite.main.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['node:sqlite'],
    },
  },
});
```

```typescript



`electron-squirrel-startup` 处理 `--squirrel-install` 时需要异步创建快捷方式，  
不能对它也用 `process.exit(0)`，否则安装会失败。

## electron-store 的 ESM 处理

electron-store v10 是纯 ESM 包，在 Electron 主进程中不能用 `require()`，必须用  
动态导入：

使用单例模式 + schema 校验，避免重复导入：

```typescript
import type ElectronStore from 'electron-store';

let storeInstance: ElectronStore | null = null;

export async function getStore() {
  if (storeInstance) return storeInstance;
  const { default: Store } = await import('electron-store');
  storeInstance = new Store({
    schema: {
      workDuration: { type: 'number', default: 25 },
      shortBreakDuration: { type: 'number', default: 5 },
      longBreakDuration: { type: 'number', default: 15 },
      longBreakInterval: { type: 'number', default: 4 },
      soundEnabled: { type: 'boolean', default: true },
      soundVolume: { type: 'number', default: 0.7 },
      workEndSoundPath: { type: 'string', default: '' },
      breakEndSoundPath: { type: 'string', default: '' },
      alwaysOnTop: { type: 'boolean', default: false },
      autoLaunch: { type: 'boolean', default: false },
      dailyGoal: { type: 'number', default: 8 },
      celebrationDate: { type: 'string', default: '' },
}

// 错误：不能用 require
// const Store = require('electron-store');


所有使用 electron-store 的地方，调用 `getStore()` 获取实例，不要重复动态导入。
```


## 项目结构

src/
  main.ts                  – 主进程入口
  preload.ts               – 安全桥梁（contextBridge）
  renderer/
    icon.png               – 应用图标（从 resources 复制，供 Vite import）
    work-end.mp3           – 工作结束提示音（从 resources 复制，供 Vite import）
    break-end.mp3          – 休息结束提示音（从 resources 复制，供 Vite import）
    assets.d.ts            – 静态资源类型声明（.png、.mp3）
    Celebration.tsx        – 达标庆祝动画组件（撒花纸片）
    AchievementsPanel.tsx  – 成就墙页面
    AchievementToast.tsx   – 成就解锁提示组件
  main/
    database.ts            – SQLite 数据库管理
    settings.ts            – electron-store 设置管理
    tray.ts                – 系统托盘（图标、悬停状态、右键菜单、命令转发）
resources/
  icon.png                 – 应用图标（主进程使用）
  icon.ico                 – 应用图标（打包用）
  sounds/                  – 提示音文件（原始文件）

## 渲染进程静态资源加载

渲染进程中的图片、音频等静态资源必须通过 vite import 引入，不能使用相对路径（如
../../resources/xxx），因为打包后相对路径会失效。

做法：将资源文件复制一份到“src/renderer/”目录下，然后用 import 引入

    typescript
import appIcon from './icon.png';
import defaultWorkSound from './work-end.mp3';

// 在 JSX 中使用
<img src={appIcon} />

// 在 Howler 中使用
new Howl({ src: [defaultWorkSound] });

需要在 `src/renderer/assets.d.ts` 中声明模块类型：

    typescript
declare module '*.png' {
    const src: string;
    export default src;
}

declare module '*.mp3' {
    const src: string;
    export default src;
}

## 打包配置
`forge.config.ts` 中的关[?]配置
- `packagerConfig.icon`: 应用图标路径（不带扩展名，Electron 自动选择 `.ico` 或 `.icns`）
- `packagerConfig.extraResource`: 打包时需要复制到安装目录的额外文件（如 `icon.png`、`icon.ico`，供主进程运行时使用）
- `MakerSquirrel.setupIcon`: Windows 安装包图标



## 架构规范

- **主进程**负责：数据库操作、系统通知、托盘、文件对话框
- **渲染进程**负责：React 界面、用户交互、音频播放（Howler.js）
- **通信方式**：所有跨进程操作通过 IPC（ipcMain / ipcRenderer）+ preload.ts（contextBridge）
- **安全原则**：
  - BrowserWindow 必须显式设置 `contextIsolation: true`、`nodeIntegration: false`
  - 渲染进程不直接访问 Node.js API，必须通过 preload 暴露的接口
  - preload 只暴露必要的方法，不暴露整个模块
  - 主进程的 IPC handler 必须校验入参类型和合法性（如 id 必须是正整数、字符串长度不超限等），防止恶意参数

## 数据库设计

使用 node:sqlite 同步 API，数据库文件存放在 `app.getPath('userData') + '/focusnow.db'`。

主要数据表（分阶段创建，每张表在首次用到时通过 `CREATE TABLE IF NOT EXISTS` 创建）：
- `tasks` - 任务 (name, category, completed, completed_at, created_at) — 第 08 节创建
- `pomodoros` - 番茄钟记录 (task_id, duration (单位: 秒), type, started_at, ended_at) — 第 08 节创建
- `achievements` - 成就徽章 (name, description, icon, condition_type (枚举: total_pomodoros / consecutive_days / single_day_max / all_categories), condition_value, unlocked_at) — 第 26 节创建

所有 SQL 语句必须使用参数化查询 (`?` 占位符)，禁止字符串拼接。

需要创建的索引（建表后立即执行）：
- `CREATE INDEX idx_pomodoros_task_id ON pomodoros(task_id)`
- `CREATE INDEX idx_pomodoros_started_at ON pomodoros(started_at)`
- `CREATE INDEX idx_pomodoros_type ON pomodoros(type)`
- `CREATE INDEX idx_tasks_category ON tasks(category)`
- `CREATE INDEX idx_tasks_completed ON tasks(completed)`

## 代码规范

- 使用 TypeScript，启用严格模式
- React 组件使用函数组件 + Hooks
- 文件命名：组件用 PascalCase（如 `TimerPanel.tsx`），工具函数用 camelCase（如 `formatTime.ts`）
- 使用 Prettier 格式化代码