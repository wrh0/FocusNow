import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, screen } from 'electron';
import path from 'node:path';
import { promises as fsPromises } from 'node:fs';
import started from 'electron-squirrel-startup';
import {
  addPomodoro,
  createTask,
  deleteTask,
  getCompletedTaskCountToday,
  getPomodorosByRange,
  getPomodorosToday,
  initDatabase,
  listTasks,
  updateTask,
} from './main/database';
import { createTray } from './main/tray';
import { getAppIconPath } from './main/paths';
import { getSettings, getStore, setSetting } from './main/settings';
import {
  assertInsideSoundsDir,
  clearSoundFiles,
  importSoundFile,
  isSoundKind,
} from './main/sound-files';
import {
  enterMiniMode,
  exitMiniMode,
  getMiniTimerState,
  reassertMiniAlwaysOnTop,
  updateMiniTimerState,
} from './main/mini';
import {
  POMODORO_TYPES,
  TASK_CATEGORIES,
  type MiniTimerPhase,
  type MiniTimerState,
  type PomodoroInput,
  type PomodoroType,
  type TaskCategory,
  type TaskUpdates,
} from './shared/types';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Windows 的系统通知需要 AppUserModelId 才能正确归属到应用显示,
// 与 electron-forge 打包的默认 appId 保持一致(com.electron.<package name>)
app.setAppUserModelId('com.electron.my-focus-now');

// ---------- IPC 入参校验（渲染进程传来的参数一律不可信） ----------

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`参数不合法：${message}`);
}

const isPositiveInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0;

const isISODateString = (v: unknown): v is string =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v));

const isTaskCategory = (v: unknown): v is TaskCategory =>
  typeof v === 'string' && (TASK_CATEGORIES as readonly string[]).includes(v);

const isPomodoroType = (v: unknown): v is PomodoroType =>
  typeof v === 'string' && (POMODORO_TYPES as readonly string[]).includes(v);

// 任务名：去除首尾空格后 1~100 字符
function assertTaskName(name: unknown): string {
  assert(typeof name === 'string', '任务名必须是字符串');
  assert(name.trim().length > 0, '任务名不能为空');
  assert(name.length <= 100, '任务名不能超过 100 个字符');
  return name;
}

function assertTaskUpdates(updates: unknown): TaskUpdates {
  assert(typeof updates === 'object' && updates !== null, 'updates 必须是对象');
  const { name, category, completed } = updates as Record<string, unknown>;
  const result: TaskUpdates = {};
  if (name !== undefined) result.name = assertTaskName(name);
  if (category !== undefined) {
    assert(isTaskCategory(category), '分类必须是 work/study/life 之一');
    result.category = category;
  }
  if (completed !== undefined) {
    assert(typeof completed === 'boolean', 'completed 必须是布尔值');
    result.completed = completed;
  }
  return result;
}

function assertPomodoroInput(input: unknown): PomodoroInput {
  assert(typeof input === 'object' && input !== null, '番茄钟记录必须是对象');
  const { taskId, duration, type, startedAt, endedAt } = input as Record<string, unknown>;
  assert(taskId === null || isPositiveInt(taskId), 'taskId 必须是正整数或 null');
  assert(
    isPositiveInt(duration) && duration <= 24 * 60 * 60,
    'duration 必须是 1~86400 的整数（秒）',
  );
  assert(isPomodoroType(type), 'type 必须是 work/short_break/long_break 之一');
  assert(isISODateString(startedAt), 'startedAt 必须是合法的时间字符串');
  assert(isISODateString(endedAt), 'endedAt 必须是合法的时间字符串');
  return { taskId, duration, type, startedAt, endedAt };
}

// 通知文案：标题/内容都必须是有内容的字符串，长度在合理范围内（防异常数据）
const NOTIFICATION_TITLE_MAX = 100;
const NOTIFICATION_BODY_MAX = 500;

function assertNotificationText(text: unknown, label: string, max: number): string {
  assert(typeof text === 'string', `${label}必须是字符串`);
  assert(text.trim().length > 0, `${label}不能为空`);
  assert(text.length <= max, `${label}不能超过 ${max} 个字符`);
  return text;
}

// 迷你窗口的计时状态:阶段必须是已知枚举,时间必须是 MM:SS 格式,running 必须是布尔值。
// 分钟位可为 2~3 位——专注最长 120 分钟,formatTime 会产出 "120:00";
// 校验失败返回 null:上报是每秒一次的高频事件,单次非法静默丢弃,
// 绝不让渲染端的异常参数以未捕获异常的形式杀死主进程
const MINI_PHASES: readonly string[] = ['focus', 'break', 'paused', 'break-wait', 'idle'];
const MINI_TIME_PATTERN = /^\d{2,3}:[0-5]\d$/;

const isMiniPhase = (v: unknown): v is MiniTimerPhase =>
  typeof v === 'string' && MINI_PHASES.includes(v);

function parseMiniTimerState(state: unknown): MiniTimerState | null {
  if (typeof state !== 'object' || state === null) return null;
  const { phase, timeText, running } = state as Record<string, unknown>;
  if (
    !isMiniPhase(phase) ||
    typeof timeText !== 'string' ||
    !MINI_TIME_PATTERN.test(timeText) ||
    typeof running !== 'boolean'
  ) {
    return null;
  }
  return { phase, timeText, running };
}

// ---------- 数据库 IPC：渲染进程不直接访问 SQLite，统一由主进程中转 ----------

ipcMain.handle('db:tasks:list', () => listTasks());

ipcMain.handle('db:tasks:create', (_event, name: unknown, category: unknown) => {
  assert(isTaskCategory(category), '分类必须是 work/study/life 之一');
  return createTask(assertTaskName(name), category);
});

ipcMain.handle('db:tasks:update', (_event, id: unknown, updates: unknown) => {
  assert(isPositiveInt(id), 'id 必须是正整数');
  return updateTask(id, assertTaskUpdates(updates));
});

ipcMain.handle('db:tasks:delete', (_event, id: unknown) => {
  assert(isPositiveInt(id), 'id 必须是正整数');
  deleteTask(id);
});

ipcMain.handle('db:pomodoros:add', (_event, record: unknown) =>
  addPomodoro(assertPomodoroInput(record)),
);

ipcMain.handle('db:pomodoros:today', () => getPomodorosToday());

ipcMain.handle('db:tasks:completed-count-today', () => getCompletedTaskCountToday());

ipcMain.handle('db:pomodoros:range', (_event, startISO: unknown, endISO: unknown) => {
  assert(isISODateString(startISO), 'startISO 必须是合法的时间字符串');
  assert(isISODateString(endISO), 'endISO 必须是合法的时间字符串');
  assert(startISO < endISO, 'startISO 必须早于 endISO');
  return getPomodorosByRange(startISO, endISO);
});

// 桌面通知：渲染进程不直接碰 Notification，统一由主进程弹出；
// 点击通知把窗口带到最前（最小化则先从任务栏恢复）
ipcMain.handle('notification:show', (event, title: unknown, body: unknown) => {
  const safeTitle = assertNotificationText(title, '通知标题', NOTIFICATION_TITLE_MAX);
  const safeBody = assertNotificationText(body, '通知内容', NOTIFICATION_BODY_MAX);
  const win = BrowserWindow.fromWebContents(event.sender);
  const notification = new Notification({
    title: safeTitle,
    body: safeBody,
    icon: getAppIconPath(),
  });
  notification.on('click', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  notification.show();
});

// 窗口控制 IPC：渲染进程通过 preload 暴露的 windowControls 调用
ipcMain.handle('window:minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.handle('window:maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
});

ipcMain.handle('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

// 进入迷你模式:主窗口标题栏的迷你按钮触发(托盘菜单也走 enterMiniMode)
ipcMain.handle('window:enter-mini-mode', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  enterMiniMode(() => win);
});

// ---------- 迷你窗口 IPC:只服务三件事——接收状态、切换计时、关闭迷你窗口 ----------
// 计时逻辑仍在主窗口渲染进程,迷你窗口只是显示端

// 主窗口渲染进程每秒上报计时状态:主进程校验后缓存并转发给迷你窗口;
// 非法上报静默丢弃(与托盘的 on 型 handler 同策略)——拒绝这一次数据,
// 但不能让渲染端的异常参数以未捕获异常的形式杀死主进程
ipcMain.on('mini:update-state', (_event, state: unknown) => {
  const parsed = parseMiniTimerState(state);
  if (parsed) updateMiniTimerState(parsed);
});

// 迷你窗口读取当前计时状态(打开瞬间的第一帧,来自主进程缓存)
ipcMain.handle('mini:get-timer-state', () => getMiniTimerState());

// 迷你窗口的播放/暂停:转发与托盘「开始/暂停」相同的命令给主窗口,
// 由主窗口的计时器决定实际行为(开始专注/暂停/继续/开始休息)
ipcMain.on('mini:toggle-timer', () => {
  mainWindow?.webContents.send('tray:command', 'toggle');
});

// 迷你窗口的关闭按钮:回主窗口
ipcMain.on('mini:close', () => {
  exitMiniMode(() => mainWindow);
});

// 全局设置 IPC：读写同一份 electron-store 持久化配置（标题栏图钉与设置页共用）
ipcMain.handle('settings:get', () => getSettings());

// 设置项写入后的窗口外副作用：主进程统一应用（渲染进程只管写存储）
function applySettingSideEffects(key: unknown, value: unknown): void {
  if (key === 'alwaysOnTop') {
    // 图钉/设置页之外可能存在其他窗口,统一应用到全部窗口
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.setAlwaysOnTop(value === true);
    });
    // 迷你窗口层级高于主窗口置顶,主窗口置顶变化后重申它的层级
    reassertMiniAlwaysOnTop();
  } else if (key === 'autoLaunch') {
    // 开机自启：写当前用户的登录启动项（注册表 HKCU\...\Run）。
    // 注：Squirrel 打包后 exe 路径带版本号，应用更新后需重新开关一次该设置
    app.setLoginItemSettings({ openAtLogin: value === true });
  }
}

ipcMain.handle('settings:set', async (event, key: unknown, value: unknown) => {
  // key/value 的类型与合法性在 setSetting 内校验，这里只负责应用副作用
  const settings = await setSetting(key, value);
  applySettingSideEffects(key, value);
  // 广播给所有窗口：任何一处改动（设置页/图钉/主进程）后，
  // 所有订阅设置的界面都从同一份广播拿到最新值，不会出现 A 改了 B 还显示旧值
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.webContents !== event.sender) {
      win.webContents.send('settings:changed', settings);
    }
  }
  return settings;
});

// ---------- 提示音文件：选择(复制副本进专属目录) + 加载(只准读专属目录) ----------

const SOUND_EXTENSIONS = ['mp3', 'wav', 'ogg'];
// 自定义提示音大小上限：音频文件几 MB 足够，限制读取大小防止异常大文件拖垮内存
const SOUND_FILE_MAX_BYTES = 20 * 1024 * 1024;

const SOUND_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
};

// 选择自定义提示音:系统对话框选文件 → 复制副本进 userData/sounds/(毫秒时间戳
// 命名,每次路径都不同) → 清掉该类别旧副本。返回副本路径与原始文件名;
// 取消返回 null。副本路径由渲染进程写入设置
ipcMain.handle('sound:pick', async (event, kind: unknown) => {
  assert(isSoundKind(kind), '未知的提示音类别');
  const options: Electron.OpenDialogOptions = {
    title: '选择提示音文件',
    filters: [{ name: '音频文件', extensions: SOUND_EXTENSIONS }],
    properties: ['openFile'],
  };
  const win = BrowserWindow.fromWebContents(event.sender);
  // 对话框依附主窗口(模态表现),窗口已销毁时退化为独立对话框
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return null;
  return importSoundFile(kind, result.filePaths[0]);
});

// 恢复默认:清掉该类别在专属目录里的全部副本(设置由渲染进程另行清空)
ipcMain.handle('sound:clear', (_event, kind: unknown) => {
  assert(isSoundKind(kind), '未知的提示音类别');
  return clearSoundFiles(kind);
});

// 把自定义提示音副本读成 dataURL 供渲染进程用 Howler 播放。
// 安全:只允许读 userData/sounds/ 专属目录(assertInsideSoundsDir 用 realpath
// 归一化后做前缀检查,相对路径穿越/符号链接/8.3 短文件名都绕不过),
// 渲染进程无法借这个通道读系统其他位置的文件
ipcMain.handle('sound:load', async (_event, filePath: unknown) => {
  assert(typeof filePath === 'string' && filePath.length > 0, '音频路径必须是字符串');
  const safePath = await assertInsideSoundsDir(filePath);
  const ext = path.extname(safePath).slice(1).toLowerCase();
  assert(
    SOUND_EXTENSIONS.includes(ext),
    `只支持 ${SOUND_EXTENSIONS.join('/')} 格式的音频文件`,
  );
  const stat = await fsPromises.stat(safePath).catch(() => null);
  assert(stat !== null && stat.isFile(), '音频文件不存在或已被删除');
  assert(stat.size > 0 && stat.size <= SOUND_FILE_MAX_BYTES, '音频文件为空或超过 20MB');
  // 每次调用都从磁盘重新读取,不经过任何内存缓存 —— 与时间戳命名一起构成
  // 防缓存双保险,即使路径凑巧相同,拿到的也一定是磁盘上的最新内容
  const buffer = await fsPromises.readFile(safePath);
  return {
    dataURL: `data:${SOUND_MIME[ext]};base64,${buffer.toString('base64')}`,
    name: path.basename(safePath),
  };
});

// 主窗口引用:托盘菜单、通知点击都要能找到它(窗口可能先于托盘创建)
let mainWindow: BrowserWindow | null = null;
// 是否处于真正的退出流程:区分「点 × 隐藏到托盘」和「托盘菜单退出番茄钟」。
// app.quit() 会先触发 before-quit,在这里解除拦截,close 事件放行
let isQuitting = false;

app.on('before-quit', () => {
  isQuitting = true;
});

const createWindow = async () => {
  // 按屏幕可用区域（排除任务栏）的比例计算初始尺寸
  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.round(workArea.width * 0.6);
  const height = Math.round(workArea.height * 0.95);

  // Create the browser window.
  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: width,
    minHeight: height,
    center: true,
    title: '番茄钟',
    icon: getAppIconPath(),
    // 去掉系统标题栏，但保留窗口边框、阴影和缩放能力
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // 关闭后台节流：窗口最小化/被遮挡/托盘收起时，倒计时 tick 与提示音播放
      // 不被系统省电策略推迟（Web Audio 播放本身由音频线程驱动，这里是双保险）
      backgroundThrottling: false,
    },
  });

  // 点标题栏 × 不退出:隐藏窗口到托盘,应用继续在后台计时;
  // 真正退出(托盘菜单「退出番茄钟」→ app.quit() → before-quit)时放行
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  // 恢复上次的窗口置顶状态(图钉/设置页共用同一份持久化设置)
  mainWindow.setAlwaysOnTop((await getStore()).get('alwaysOnTop'));

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
  // 启动时初始化数据库（建表 + 索引均为 IF NOT EXISTS，已存在则跳过）
  initDatabase();
  // 彻底移除应用菜单栏：按 Alt 也不会弹出
  Menu.setApplicationMenu(null);
  void createWindow();
  // 系统托盘:窗口引用用函数注入,托盘拿到的永远是最新的主窗口
  createTray(() => mainWindow);
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
