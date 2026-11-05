import { app } from 'electron';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

// 自定义提示音的专属目录:userData/sounds/。设计要点:
// 1. 用户选中的文件会「复制副本」进来,设置里只存副本路径——用户原文件之后被
//    移动/改名/删除都不影响应用播放;
// 2. 副本文件名带毫秒时间戳(如 work-end-custom-1713123456789.mp3),每次选择
//    路径都不同,音频加载不会命中旧内容的缓存;
// 3. 加载(sound:load)只允许读这个目录——「复制进来 + 只准读这里」成对出现,
//    即使渲染进程被攻破,也无法借加载通道去读系统任意位置的文件
export function getSoundsDir(): string {
  return path.join(app.getPath('userData'), 'sounds');
}

// 提示音设置键 → 副本文件名前缀(设置键本身作为类别标识)
const SOUND_KIND_PREFIX = {
  workEndSoundPath: 'work-end-custom',
  breakEndSoundPath: 'break-end-custom',
} as const;

export type SoundKind = keyof typeof SOUND_KIND_PREFIX;

export function isSoundKind(kind: unknown): kind is SoundKind {
  return typeof kind === 'string' && Object.hasOwn(SOUND_KIND_PREFIX, kind);
}

async function ensureSoundsDir(): Promise<string> {
  const dir = getSoundsDir();
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

// sound:load 的安全闸门:校验路径确实落在专属目录内,返回归一化后的绝对路径。
// 用 realpath 归一化(展开相对路径、符号链接与 Windows 8.3 短文件名)后再比较,
// 防止以各种书写形式绕过目录前缀检查;文件不存在时 realpath 失败,同样拒绝
export async function assertInsideSoundsDir(filePath: string): Promise<string> {
  const real = await fsp.realpath(filePath).catch(() => null);
  if (real === null) throw new Error('音频文件不存在');
  const dir = await fsp.realpath(getSoundsDir()).catch(() => null);
  if (dir === null) throw new Error('音频路径不在应用专属目录内');
  // Windows 文件系统不区分大小写,比较前统一小写
  if (!real.toLowerCase().startsWith(dir.toLowerCase() + path.sep)) {
    throw new Error('音频路径不在应用专属目录内');
  }
  return real;
}

// 选择文件后调用:复制副本进专属目录(毫秒时间戳命名,每次路径都不同),
// 并清掉该类别此前留下的旧副本;返回副本路径与用户选择的原始文件名(界面显示用)
export async function importSoundFile(
  kind: SoundKind,
  sourcePath: string,
): Promise<{ path: string; name: string }> {
  const ext = path.extname(sourcePath).slice(1).toLowerCase();
  const dir = await ensureSoundsDir();
  const destPath = path.join(
    dir,
    `${SOUND_KIND_PREFIX[kind]}-${Date.now()}.${ext}`,
  );
  await fsp.copyFile(sourcePath, destPath);
  await clearSoundFiles(kind, destPath);
  return { path: destPath, name: path.basename(sourcePath) };
}

// 清理该类别在专属目录里的副本:删除所有本类别前缀、但不等于 keepPath 的文件。
// 导入新副本时传 keepPath(保留刚复制的),恢复默认时不传(该类别副本全部清掉)。
// 单个文件删除失败(被占用等)不阻断主流程,残留文件会在下次清理时再试
export async function clearSoundFiles(
  kind: SoundKind,
  keepPath?: string,
): Promise<void> {
  const dir = getSoundsDir();
  const prefix = SOUND_KIND_PREFIX[kind];
  const entries = await fsp.readdir(dir).catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter(
        (name) =>
          name.startsWith(`${prefix}-`) && path.join(dir, name) !== keepPath,
      )
      .map((name) =>
        fsp.rm(path.join(dir, name), { force: true }).catch(() => undefined),
      ),
  );
}
