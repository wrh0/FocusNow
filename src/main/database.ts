import type { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { app } from 'electron';
import type {
  Pomodoro,
  PomodoroInput,
  PomodoroType,
  Task,
  TaskCategory,
  TaskUpdates,
} from '../shared/types';

// 数据库单例。node:sqlite 是 Node.js 内置模块，用动态 require 加载，
// 避免 Vite 静态分析报错（同时在 vite.main.config.ts 中声明为 external）
let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (db) return db;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync: DatabaseSyncCtor } = require('node:sqlite') as {
    DatabaseSync: new (path: string) => DatabaseSync;
  };
  // 数据库文件放在应用的专属数据目录，由 Electron 决定路径
  db = new DatabaseSyncCtor(path.join(app.getPath('userData'), 'myfocusnow.db'));
  // 启用外键约束，让删除任务时 pomodoros.task_id 自动置 NULL
  db.exec('PRAGMA foreign_keys = ON;');
  createTables(db);
  return db;
}

// 应用启动时调用：建表和索引都是 IF NOT EXISTS，已存在就跳过，可安全重复执行
export function initDatabase(): void {
  getDb();
}

function createTables(database: DatabaseSync): void {
  // completed 用 INTEGER 0/1 存储（SQLite 没有布尔类型），读取时再转换为 boolean；
  // 时间统一存 ISO 8601 字符串（UTC），字典序与时间序一致，可直接做范围比较
  database.exec(`
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

// ---------- 数据库行 → 应用对象（snake_case → camelCase，并转换类型） ----------

interface TaskDbRow {
  id: number;
  name: string;
  category: string;
  completed: number;
  completed_at: string | null;
  created_at: string;
}

function toTask(row: TaskDbRow): Task {
  return {
    id: Number(row.id),
    name: row.name,
    category: row.category as TaskCategory,
    completed: row.completed === 1,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

interface PomodoroDbRow {
  id: number;
  task_id: number | null;
  duration: number;
  type: string;
  started_at: string;
  ended_at: string;
}

function toPomodoro(row: PomodoroDbRow): Pomodoro {
  return {
    id: Number(row.id),
    taskId: row.task_id === null ? null : Number(row.task_id),
    duration: Number(row.duration),
    type: row.type as PomodoroType,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

// ---------- 任务 ----------

export function listTasks(): Task[] {
  // 未完成的排前面，完成后的沉底；组内按创建时间先后（清单顺序）
  const rows = getDb()
    .prepare('SELECT * FROM tasks ORDER BY completed ASC, created_at ASC')
    .all() as unknown as TaskDbRow[];
  return rows.map(toTask);
}

export function createTask(name: string, category: TaskCategory): Task {
  const createdAt = new Date().toISOString();
  const result = getDb()
    .prepare(
      'INSERT INTO tasks (name, category, completed, completed_at, created_at) VALUES (?, ?, 0, NULL, ?)',
    )
    .run(name, category, createdAt);
  return {
    id: Number(result.lastInsertRowid),
    name,
    category,
    completed: false,
    completedAt: null,
    createdAt,
  };
}

export function updateTask(
  id: number,
  updates: TaskUpdates,
): Task | null {
  // SET 子句的字段名来自代码内白名单（不是用户输入），值全部走参数化
  const setClauses: string[] = [];
  const params: (string | number | null)[] = [];

  if (updates.name !== undefined) {
    setClauses.push('name = ?');
    params.push(updates.name);
  }
  if (updates.category !== undefined) {
    setClauses.push('category = ?');
    params.push(updates.category);
  }
  if (updates.completed !== undefined) {
    setClauses.push('completed = ?');
    params.push(updates.completed ? 1 : 0);
    // 标记完成时自动记录完成时间，取消完成时清空
    setClauses.push('completed_at = ?');
    params.push(updates.completed ? new Date().toISOString() : null);
  }

  if (setClauses.length === 0) return getTaskById(id);

  params.push(id);
  getDb()
    .prepare(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = ?`)
    .run(...params);
  return getTaskById(id);
}

function getTaskById(id: number): Task | null {
  const row = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as
    | TaskDbRow
    | undefined;
  return row ? toTask(row) : null;
}

export function deleteTask(id: number): void {
  // 关联的番茄钟记录通过外键 ON DELETE SET NULL 保留，仅清空 task_id
  getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

// ---------- 番茄钟记录 ----------

export function addPomodoro(input: PomodoroInput): Pomodoro {
  const result = getDb()
    .prepare(
      'INSERT INTO pomodoros (task_id, duration, type, started_at, ended_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(input.taskId, input.duration, input.type, input.startedAt, input.endedAt);
  return { id: Number(result.lastInsertRowid), ...input };
}

// 本地时区中 date 所在一天的 [start, end) ISO 时间范围（左闭右开）
// 用 Date 日期分量自动处理跨月/跨年
function localDayRange(date: Date): { start: string; end: string } {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

// 范围为左闭右开 [startISO, endISO)，按 started_at 走索引
export function getPomodorosByRange(startISO: string, endISO: string): Pomodoro[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM pomodoros WHERE started_at >= ? AND started_at < ? ORDER BY started_at ASC',
    )
    .all(startISO, endISO) as unknown as PomodoroDbRow[];
  return rows.map(toPomodoro);
}

export function getPomodorosToday(): Pomodoro[] {
  const { start, end } = localDayRange(new Date());
  return getPomodorosByRange(start, end);
}

// 今天完成的任务数：按 completed_at 落在今天来判断
export function getCompletedTaskCountToday(): number {
  const { start, end } = localDayRange(new Date());
  const row = getDb()
    .prepare(
      'SELECT COUNT(*) AS count FROM tasks WHERE completed = 1 AND completed_at >= ? AND completed_at < ?',
    )
    .get(start, end) as { count: number };
  return Number(row.count);
}
