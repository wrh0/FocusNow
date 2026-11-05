import type ElectronStore from 'electron-store';
import type { Schema } from 'electron-store';
import type { AppSettings } from '../shared/types';

// 各设置项的 JSON Schema：只声明类型和默认值，合法性校验在 assertSettingUpdate 中做。
// Schema<AppSettings> 要求键与 AppSettings 的字段一一对应，新增设置项时两处同步维护
export const SETTINGS_SCHEMA: Schema<AppSettings> = {
  alwaysOnTop: { type: 'boolean', default: false },
  workDuration: { type: 'number', default: 25 },
  shortBreakDuration: { type: 'number', default: 5 },
  longBreakDuration: { type: 'number', default: 15 },
  longBreakInterval: { type: 'number', default: 4 },
  soundEnabled: { type: 'boolean', default: true },
  soundVolume: { type: 'number', default: 0.7 },
  workEndSoundPath: { type: 'string', default: '' },
  workEndSoundName: { type: 'string', default: '' },
  breakEndSoundPath: { type: 'string', default: '' },
  breakEndSoundName: { type: 'string', default: '' },
  autoLaunch: { type: 'boolean', default: false },
  dailyGoal: { type: 'number', default: 8 },
  celebrationDate: { type: 'string', default: '' },
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`参数不合法：${message}`);
}

// 数字型设置项的取值范围（与设置页 UI 的滑块/下拉范围一致），
// 主进程按范围二次校验，越界值一律拒绝写入
const NUMBER_RANGES: Partial<
  Record<keyof AppSettings, { min: number; max: number; integer?: boolean }>
> = {
  workDuration: { min: 1, max: 120 },
  shortBreakDuration: { min: 1, max: 30 },
  longBreakDuration: { min: 1, max: 60 },
  longBreakInterval: { min: 2, max: 5, integer: true },
  soundVolume: { min: 0, max: 1 },
  dailyGoal: { min: 1, max: 100, integer: true },
};

// 一条已通过校验的设置更新：key 是判别属性，value 类型随之确定
export type SettingUpdate = {
  [K in keyof AppSettings]: { key: K; value: AppSettings[K] };
}[keyof AppSettings];

// 校验设置项的键：必须是 schema 中已声明的字段，通过后收窄为 keyof AppSettings
export function assertKnownSettingKey(key: unknown): asserts key is keyof AppSettings {
  assert(
    typeof key === 'string' &&
      Object.prototype.hasOwnProperty.call(SETTINGS_SCHEMA, key),
    `不支持的设置项：${String(key)}`,
  );
}

// 校验一条设置更新：key 必须是已声明的设置项，value 类型必须与 schema 一致。
// 渲染进程传来的参数一律不可信，通过校验的值才能进入持久化
export function assertSettingUpdate(key: unknown, value: unknown): SettingUpdate {
  assertKnownSettingKey(key);
  // json-schema-typed 的 JSONSchema 是宽联合（含 boolean 等），这里只关心
  // 我们 schema 中实际用到的字符串 type 声明；缺失时由最后的 throw 兜底
  const schemaType = (SETTINGS_SCHEMA[key] as { type?: string }).type;
  if (schemaType === 'boolean') {
    assert(typeof value === 'boolean', `设置项 ${key} 的值必须是布尔值`);
    return { key, value } as SettingUpdate;
  }
  if (schemaType === 'number') {
    assert(
      typeof value === 'number' && Number.isFinite(value),
      `设置项 ${key} 的值必须是数字`,
    );
    const range = NUMBER_RANGES[key];
    if (range) {
      assert(
        value >= range.min && value <= range.max,
        `设置项 ${key} 的值必须在 ${range.min} ~ ${range.max} 之间`,
      );
      if (range.integer) {
        assert(Number.isInteger(value), `设置项 ${key} 的值必须是整数`);
      }
    }
    return { key, value } as SettingUpdate;
  }
  if (schemaType === 'string') {
    assert(
      typeof value === 'string' && value.length <= 1024,
      `设置项 ${key} 的值必须是长度不超过 1024 的字符串`,
    );
    return { key, value } as SettingUpdate;
  }
  throw new Error(`设置项 ${key} 缺少类型声明`);
}

// electron-store 实例单例：electron-store v10 是纯 ESM 包，主进程不能用 require()，
// 必须动态导入；单例避免重复创建实例（多个实例写同一文件会互相覆盖）
let storeInstance: ElectronStore<AppSettings> | null = null;

export async function getStore(): Promise<ElectronStore<AppSettings>> {
  if (storeInstance) return storeInstance;
  const { default: Store } = await import('electron-store');
  storeInstance = new Store<AppSettings>({
    // 文件名与路径用默认值：userData/config.json
    schema: SETTINGS_SCHEMA,
  });
  return storeInstance;
}

// 读取全部设置（schema 保证每个字段都有默认值）
export async function getSettings(): Promise<AppSettings> {
  return (await getStore()).store;
}

// 校验并写入一条设置，返回写入后的完整设置对象
export async function setSetting(key: unknown, value: unknown): Promise<AppSettings> {
  const update = assertSettingUpdate(key, value);
  const store = await getStore();
  // 校验已保证 value 与 key 匹配，这里收窄类型以通过 store.set 的检查
  store.set(update.key as string, update.value);
  return store.store;
}
