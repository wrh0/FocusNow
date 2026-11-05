# FocusNow · 番茄钟

一款基于 Electron + React 的桌面番茄钟应用。开始专注，记录每一个番茄，按时休息。

## 功能特性

- **专注计时** — 番茄钟/短休息/长休息自动流转，挂钟基准计时，休眠唤醒后依然精确
- **任务管理** — 按工作/学习/生活分类，为任务记录今日专注的番茄数，完成自动沉底
- **迷你悬浮窗** — 一键切到屏幕角落的小窗，只显示倒计时与播放/暂停
- **系统托盘** — 悬停实时显示剩余时间（图标上直接画数字），托盘菜单可开始/暂停/跳过
- **自定义提示音** — 专注/休息结束提示音可换成自己的音频文件（mp3/wav/ogg），音量可调
- **数据统计** — 今日番茄数、累计专注时长、完成任务数
- **设置同步** — 图钉置顶、开机自启、时长配置等全部设置跨窗口即时同步

## 技术栈

| 分类 | 技术 |
|------|------|
| 应用框架 | Electron 45（electron-forge 脚手架） |
| 界面 | React 19 + TypeScript 5 + Tailwind CSS 4 + shadcn/ui |
| 构建 | Vite 5（forge vite 插件，主进程/两个预加载/两个渲染分别构建） |
| 本地数据 | SQLite（Node.js 内置 `node:sqlite`，零原生依赖） |
| 设置存储 | electron-store 10 |
| 音频 | Howler.js |

## 开发

```bash
# 安装依赖（需要 Node.js 24+）
npm install

# 启动开发模式（主窗口 + 迷你窗口各配独立 dev server）
npm start

# 类型检查 / 代码检查
npx tsc --noEmit
npm run lint

# 打包（生成 out/ 目录下的免安装产物）
npm run package

# 生成分发格式（Windows 为 Squirrel 安装包 Setup.exe）
npm run make
```

## 数据存储

所有数据保存在本地，不上传任何服务器：

- 数据库：`%APPDATA%/FocusNow/myfocusnow.db`（任务、番茄钟记录）
- 设置：`%APPDATA%/FocusNow/config.json`
- 自定义提示音副本：`%APPDATA%/FocusNow/sounds/`

## 许可证

[MIT](LICENSE)
