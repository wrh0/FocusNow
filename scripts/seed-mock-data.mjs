// 往 FocusNow 的 SQLite 数据库写入模拟数据，方便测试统计页面。
// 完全脱离 Electron 运行：直接用 Node 内置的 node:sqlite 打开应用的数据文件，
// 不走应用接口，应用没启动时也能执行。
//
// 用法：
//   node scripts/seed-mock-data.mjs                    # 追加写入应用默认数据库
//   node scripts/seed-mock-data.mjs --clear            # 先清空任务和番茄钟，再写入
//   node scripts/seed-mock-data.mjs --db D:\tmp\a.db   # 指定其他数据库文件
//   FOCUSNOW_DB=D:\tmp\a.db node scripts/seed-mock-data.mjs
//
// 默认数据库位置（与 Electron app.getPath('userData') 一致）：
//   Windows: %APPDATA%\my-focus-now\myfocusnow.db
//   macOS:   ~/Library/Application Support/my-focus-now/myfocusnow.db
//   Linux:   ~/.config/my-focus-now/myfocusnow.db
//
// 生成的数据规则：
//   - 10 个任务，分布在工作/学习/生活三种分类
//   - 最近 65 天的番茄钟：工作日每天 0-8 个专注，周末每天 0-3 个
//   - 每天从早上 8 点开始排（带 0-15 分钟随机偏移），22:00 后不再记录
//   - 每 4 个专注后安排一次长休息，其余为短休息
//   - 两成专注是自由专注（不关联任何任务）

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const APP_DIR_NAME = 'my-focus-now';
const DB_FILE_NAME = 'myfocusnow.db';

// 时长（秒），与 src/main/database.ts 的应用默认设置保持一致
const WORK_SEC = 25 * 60;
const SHORT_BREAK_SEC = 5 * 60;
const LONG_BREAK_SEC = 15 * 60;

const DAYS = 65; // 生成最近 65 天（含今天）的数据
const FREE_RATIO = 0.2; // 两成专注为自由专注
const DAY_START_HOUR = 8; // 每天 8 点开始排
const DAY_END_HOUR = 22; // 22 点后不再记录
const MIN_GAP_MIN = 1; // 相邻两段之间的随机空隙
const MAX_GAP_MIN = 10;
const MAX_START_JITTER_MIN = 15; // 第一段在 8 点后的随机偏移

const TASKS = [
  { name: '写周报', category: 'work' },
  { name: '客户需求评审', category: 'work' },
  { name: '重构登录模块', category: 'work' },
  { name: '回复邮件', category: 'work' },
  { name: '读《深入浅出 React》', category: 'study' },
  { name: '刷算法题', category: 'study' },
  { name: '英语听力练习', category: 'study' },
  { name: '跑步 30 分钟', category: 'life' },
  { name: '整理房间', category: 'life' },
  { name: '买菜做饭', category: 'life' },
];

// ---------- 命令行参数 ----------

function usage() {
  console.log(`往 FocusNow 数据库写入模拟数据（${DAYS} 天番茄钟记录 + ${TASKS.length} 个任务）

用法：
  node scripts/seed-mock-data.mjs [选项]

选项：
  --db <路径>   指定数据库文件路径（默认用应用的数据文件，也可用环境变量 FOCUSNOW_DB）
  --clear       写入前先清空已有的任务和番茄钟记录
  -h, --help    显示本帮助`);
}

function parseArgs(argv) {
  const args = { db: process.env.FOCUSNOW_DB || null, clear: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--db') {
      if (i + 1 >= argv.length) fail('--db 后面需要一个路径');
      args.db = argv[++i];
    } else if (arg.startsWith('--db=')) {
      args.db = arg.slice('--db='.length);
    } else if (arg === '--clear') {
      args.clear = true;
    } else if (arg === '-h' || arg === '--help') {
      usage();
      process.exit(0);
    } else {
      fail(`未知参数：${arg}（用 --help 查看用法）`);
    }
  }
  return args;
}

function fail(message) {
  console.error(`错误：${message}`);
  process.exit(1);
}

// 应用平时使用的数据文件位置（Electron userData 目录，按 package.json 的 name 命名）
function defaultDbPath() {
  switch (process.platform) {
    case 'win32':
      return path.join(
        process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
        APP_DIR_NAME,
        DB_FILE_NAME,
      );
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', APP_DIR_NAME, DB_FILE_NAME);
    default:
      return path.join(
        process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'),
        APP_DIR_NAME,
        DB_FILE_NAME,
      );
  }
}

// ---------- 工具 ----------

// [min, max] 内的随机整数（含两端）
function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function countOf(db, table) {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
  return Number(row.count);
}

// 建表语句与 src/main/database.ts 完全一致（指定 --db 指向新文件时也需要）
function createTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('work', 'study', 'life')),
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pomodoros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      duration INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('work', 'short_break', 'long_break')),
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pomodoros_task_id ON pomodoros(task_id);
    CREATE INDEX IF NOT EXISTS idx_pomodoros_started_at ON pomodoros(started_at);
    CREATE INDEX IF NOT EXISTS idx_pomodoros_type ON pomodoros(type);
    CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);
    CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completed);
  `);
}

// ---------- 主流程 ----------

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db ?? defaultDbPath());
const dbExisted = fs.existsSync(dbPath);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
// 应用开着时也能写入：锁冲突最多等 5 秒再报错
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA foreign_keys = ON;');
createTables(db);

const existingTasks = countOf(db, 'tasks');
const existingPomodoros = countOf(db, 'pomodoros');

if (!dbExisted) {
  console.log(`数据库文件不存在，已新建：${dbPath}`);
}
if (args.clear) {
  db.exec('DELETE FROM pomodoros; DELETE FROM tasks;');
  // 重置自增 id 让编号从 1 开始；表从未插入过数据时 sqlite_sequence 不存在，忽略即可
  try {
    db.exec("DELETE FROM sqlite_sequence WHERE name IN ('tasks', 'pomodoros')");
  } catch {
    // 忽略
  }
  console.log(`已清空旧数据（${existingTasks} 个任务 / ${existingPomodoros} 条番茄钟）`);
} else if (existingTasks > 0 || existingPomodoros > 0) {
  console.log(
    `[提示] 数据库已有 ${existingTasks} 个任务 / ${existingPomodoros} 条番茄钟，本次为追加写入` +
      `（如需重置请加 --clear）`,
  );
}

const insertTask = db.prepare(
  'INSERT INTO tasks (name, category, completed, completed_at, created_at) VALUES (?, ?, ?, ?, ?)',
);
const insertPomodoro = db.prepare(
  'INSERT INTO pomodoros (task_id, duration, type, started_at, ended_at) VALUES (?, ?, ?, ?, ?)',
);

const now = new Date();
const nowMs = now.getTime();

db.exec('BEGIN;');
try {
  // ---------- 任务 ----------
  // 创建时间分布在 60-70 天前；约一半标记为已完成，完成时间落在创建之后到今天之间
  const taskIds = [];
  const categoryCounts = { work: 0, study: 0, life: 0 };
  let completedTaskCount = 0;
  for (const task of TASKS) {
    const createdAtMs = nowMs - randInt(60, 70) * 24 * 60 * 60 * 1000;
    const completed = Math.random() < 0.5;
    const completedAtMs = createdAtMs + Math.random() * (nowMs - createdAtMs);
    const result = insertTask.run(
      task.name,
      task.category,
      completed ? 1 : 0,
      completed ? new Date(completedAtMs).toISOString() : null,
      new Date(createdAtMs).toISOString(),
    );
    taskIds.push(Number(result.lastInsertRowid));
    categoryCounts[task.category]++;
    if (completed) completedTaskCount++;
  }

  // ---------- 番茄钟 ----------
  // 从今天往前共 65 天；时间统一转成 ISO 8601 UTC 字符串（与应用存储格式一致）
  let workCount = 0;
  let shortBreakCount = 0;
  let longBreakCount = 0;

  for (let offset = DAYS - 1; offset >= 0; offset--) {
    const year = now.getFullYear();
    const month = now.getMonth();
    const date = now.getDate() - offset;
    const isWeekend = [0, 6].includes(new Date(year, month, date).getDay());
    const focusCount = isWeekend ? randInt(0, 3) : randInt(0, 8);
    if (focusCount === 0) continue;

    const dayStartMs = new Date(year, month, date, DAY_START_HOUR, randInt(0, MAX_START_JITTER_MIN)).getTime();
    const dayEndMs = new Date(year, month, date, DAY_END_HOUR, 0).getTime();

    let cursorMs = dayStartMs;
    let workDone = 0; // 当天已完成的专注数，用于决定第 4 个之后是长休息

    for (let i = 0; i < focusCount; i++) {
      // 今天的段落不能排到未来时刻；每天 22 点后不再记录
      if (cursorMs >= Math.min(nowMs, dayEndMs)) break;

      const workStartMs = cursorMs;
      const workEndMs = workStartMs + WORK_SEC * 1000;
      if (workEndMs > dayEndMs) break; // 剩余时间放不下一个专注

      // 两成自由专注不关联任务，其余随机挑一个
      const taskId = Math.random() < FREE_RATIO ? null : pick(taskIds);
      insertPomodoro.run(
        taskId,
        WORK_SEC,
        'work',
        new Date(workStartMs).toISOString(),
        new Date(workEndMs).toISOString(),
      );
      workCount++;
      workDone++;

      // 专注之间的随机空隙（摸鱼时间），之后是休息
      cursorMs = workEndMs + randInt(MIN_GAP_MIN, MAX_GAP_MIN) * 60 * 1000;

      const isLongBreak = workDone % 4 === 0; // 每 4 个专注后一次长休息
      const restSec = isLongBreak ? LONG_BREAK_SEC : SHORT_BREAK_SEC;
      const restEndMs = cursorMs + restSec * 1000;
      if (restEndMs > dayEndMs) break; // 太晚了，这段休息也不记录

      insertPomodoro.run(
        null,
        restSec,
        isLongBreak ? 'long_break' : 'short_break',
        new Date(cursorMs).toISOString(),
        new Date(restEndMs).toISOString(),
      );
      if (isLongBreak) longBreakCount++;
      else shortBreakCount++;

      cursorMs = restEndMs + randInt(MIN_GAP_MIN, MAX_GAP_MIN) * 60 * 1000;
    }
  }

  db.exec('COMMIT;');

  const totalPomodoros = workCount + shortBreakCount + longBreakCount;
  console.log(`\n写入完成 ✅`);
  console.log(`数据库：${dbPath}`);
  console.log(
    `任务：${TASKS.length} 个` +
      `（工作 ${categoryCounts.work} / 学习 ${categoryCounts.study} / 生活 ${categoryCounts.life}` +
      `，其中 ${completedTaskCount} 个已完成）`,
  );
  console.log(
    `番茄钟：${totalPomodoros} 条` +
      `（专注 ${workCount} / 短休息 ${shortBreakCount} / 长休息 ${longBreakCount}）`,
  );
} catch (error) {
  db.exec('ROLLBACK;');
  throw error;
} finally {
  db.close();
}
