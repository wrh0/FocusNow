import { useCallback, useEffect, useRef, useState } from 'react';
import { Howl } from 'howler';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import breakEndSound from './break-end.mp3';
import workEndSound from './work-end.mp3';
import { updateSetting, useSettings } from './use-settings';

// ---------- 主题化样式(与首页卡片/任务面板的视觉语言一致) ----------

// 滑块:浅灰轨道(组件默认) + 主题红填充 + 主题渐变手柄,样式经 data-slot
// 子选择器从使用处注入,组件本身保持中立
const SLIDER_CLASS = [
  '[&_[data-slot=slider-range]]:bg-app-primary',
  '[&_[data-slot=slider-thumb]]:border-0',
  '[&_[data-slot=slider-thumb]]:bg-linear-to-b',
  '[&_[data-slot=slider-thumb]]:from-app-primary',
  '[&_[data-slot=slider-thumb]]:to-app-primary-dark',
  '[&_[data-slot=slider-thumb]]:shadow-md',
  '[&_[data-slot=slider-thumb]]:shadow-app-primary/40',
  '[&_[data-slot=slider-thumb]]:hover:ring-app-primary/20',
].join(' ');

// 输入框/下拉框:清晰的灰色边框 + 聚焦柔和主题色(与任务面板输入框同风格)
const FIELD_CLASS =
  'border-gray-300 focus-visible:border-app-primary/60 focus-visible:ring-app-primary/15';

// ---------- 通用布局 ----------

// 设置卡片:精致卡面(纯白背景 + 多层柔和阴影) + 顶部彩色装饰线 + 同色区域标题,
// 出现时从下方淡入(animate-fade-in-up,多卡用 animationDelay 做轻微瀑布感)
function SettingsCard({
  icon,
  title,
  description,
  accentClass,
  titleClass,
  animationDelay,
  children,
}: {
  icon: string;
  title: string;
  description?: string;
  // 顶部装饰线的颜色类(如 bg-app-primary)
  accentClass: string;
  // 区域标题的文字颜色类(如 text-app-primary),与装饰线同色
  titleClass: string;
  animationDelay?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="card-refined relative animate-fade-in-up overflow-hidden rounded-2xl p-6"
      style={animationDelay ? { animationDelay } : undefined}
    >
      {/* 顶部细装饰线 */}
      <span className={cn('absolute inset-x-0 top-0 h-0.5', accentClass)} />
      <header className="mb-5">
        <h2 className={cn('flex items-center gap-2 text-base font-bold', titleClass)}>
          <span className="leading-none">{icon}</span>
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-xs text-gray-400">{description}</p>
        )}
      </header>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}

// 开关行:左侧标签与说明,右侧开关
function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <Label>{label}</Label>
        {description && (
          <p className="mt-0.5 text-xs text-gray-400">{description}</p>
        )}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="shrink-0 data-[state=checked]:bg-app-primary"
      />
    </div>
  );
}

// ---------- 番茄钟设置 ----------

// 时长设置行:滑块 + 数字输入框。拖动/输入在本地实时互相同步(拖动→数字变,
// 输入→滑块动),提交时才写入设置(滑块拖动结束、输入框失焦或回车),
// 避免拖动/打字过程高频写盘
function DurationSetting({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  // 当前持久化的值(分钟)
  value: number;
  min: number;
  max: number;
  onCommit: (minutes: number) => void;
}) {
  // 滑块的实时预览值(null 表示未在交互,显示持久值);拖动与输入预览共用
  const [previewValue, setPreviewValue] = useState<number | null>(null);
  // 数字输入框的本地文本
  const [text, setText] = useState(String(value));

  // 外部值变化(初始加载/其他窗口广播)时重置本地状态
  useEffect(() => {
    setPreviewValue(null);
    setText(String(value));
  }, [value]);

  // 提交:clamp 到合法范围并取整;与当前值相同则只还原显示。
  // 输入框可能拿到非数字(清空后失焦/乱输入),此时不提交,还原为当前值
  const commit = (raw: number) => {
    setPreviewValue(null);
    if (!Number.isFinite(raw)) {
      setText(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, Math.round(raw)));
    setText(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  // 输入过程中把合法数字实时预览到滑块(只动滑块,不提交)
  const handleTextInput = (raw: string) => {
    setText(raw);
    const parsed = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(parsed)) {
      setPreviewValue(Math.min(max, Math.max(min, Math.round(parsed))));
    }
  };

  const display = previewValue ?? value;

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <Label>{label}</Label>
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            min={min}
            max={max}
            value={text}
            onChange={(e) => handleTextInput(e.target.value)}
            onBlur={() => commit(Number(text))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            className={cn(FIELD_CLASS, 'h-8 w-20 px-2 text-center tabular-nums')}
          />
          <span className="text-xs text-gray-400">分钟</span>
        </div>
      </div>
      <Slider
        className={cn('mt-3', SLIDER_CLASS)}
        min={min}
        max={max}
        step={1}
        value={[display]}
        onValueChange={([v]) => {
          // 拖动时数字输入框实时跟随滑块(双向同步的另一半)
          setPreviewValue(v);
          setText(String(v));
        }}
        onValueCommit={([v]) => commit(v)}
      />
      <p className="mt-1.5 text-xs text-gray-400" aria-hidden="true">
        {min} ~ {max} 分钟
      </p>
    </div>
  );
}

// 长休息间隔下拉行
function LongBreakIntervalSetting({ value }: { value: number }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <Label>长休息间隔</Label>
        <p className="mt-0.5 text-xs text-gray-400">
          连续完成几个番茄钟后，安排一次较长的休息
        </p>
      </div>
      <Select
        value={String(value)}
        onValueChange={(v) => updateSetting('longBreakInterval', Number(v))}
      >
        <SelectTrigger
          className={cn(FIELD_CLASS, 'w-40 shrink-0 data-[state=open]:border-app-primary/60')}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[2, 3, 4, 5].map((n) => (
            <SelectItem key={n} value={String(n)}>
              每 {n} 个番茄钟
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ---------- 提示音设置 ----------

// 提示音文件行:显示当前音频名,支持选择自定义音频、试听(▶️/■ 切换)、恢复默认。
// 试听实例由父组件统一管理(整页互斥),本组件只负责展示与发起
function SoundFileSetting({
  kind,
  nameKey,
  label,
  path,
  name,
  disabled,
  playing,
  loading,
  onTogglePreview,
  onStopPreview,
}: {
  // 对应的设置项(workEndSoundPath / breakEndSoundPath)
  kind: 'workEndSoundPath' | 'breakEndSoundPath';
  // 原始文件名对应的设置项(界面显示用,播放走 path 指向的时间戳副本)
  nameKey: 'workEndSoundName' | 'breakEndSoundName';
  label: string;
  // 当前持久化的副本路径,空串表示使用默认提示音
  path: string;
  // 用户选择的原始文件名(副本文件名是时间戳,原始名才对用户有意义)
  name: string;
  disabled?: boolean;
  // 本行是否试听中(父组件的互斥状态)
  playing: boolean;
  // 本行是否正在加载音源(按钮禁用,防止重复点击)
  loading: boolean;
  onTogglePreview: () => void;
  // 「选择」「恢复默认」前先停掉整页所有试听
  onStopPreview: () => void;
}) {
  // 「选择」对话框打开期间禁用相关按钮(加载音源的 loading 由父组件管)
  const [picking, setPicking] = useState(false);

  const handlePick = async () => {
    onStopPreview(); // 停掉正在响的试听,用户可自由选择任何文件(包括另一边在用的)
    setPicking(true);
    try {
      // 主进程:对话框 → 复制时间戳副本进专属目录 → 清旧副本
      const picked = await window.sound.pick(kind);
      if (picked) {
        updateSetting(kind, picked.path);
        updateSetting(nameKey, picked.name);
      }
    } finally {
      setPicking(false);
    }
  };

  const handleReset = () => {
    onStopPreview();
    updateSetting(kind, ''); // 先清设置(界面立即回默认),副本由主进程随后删除
    updateSetting(nameKey, '');
    void window.sound
      .clear(kind)
      .catch((err) => console.error('清理自定义提示音文件失败:', err));
  };

  const busy = picking || loading;

  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-2 flex items-center gap-2">
        {/* 当前音频展示区:默认音显示固定文案,自定义音显示用户选择的原始文件名 */}
        <div className="flex h-9 min-w-0 flex-1 items-center rounded-md border border-gray-300 bg-gray-50/60 px-3">
          <span
            className={cn('truncate text-sm', path ? 'text-gray-600' : 'text-gray-400')}
            title={path || undefined}
          >
            {path ? name : '默认提示音'}
          </span>
        </div>
        {/* 试听切换按钮:▶️ 开始 / ■ 停止,自然播完由父组件的 end 回调恢复 ▶️ */}
        <Button
          variant="outline"
          size="icon-sm"
          disabled={disabled || busy}
          aria-label={playing ? '停止试听' : '试听提示音'}
          title={playing ? '停止试听' : '试听提示音'}
          className={cn(
            'border-gray-300 transition-colors hover:border-app-primary/50 hover:text-app-primary/80',
            playing && 'border-app-primary text-app-primary',
          )}
          onClick={onTogglePreview}
        >
          {playing ? '■' : '▶️'}
        </Button>
        {/* 选择:主题色渐变主按钮,悬停微放大、点击缩小,与计时器主按钮同手感 */}
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          className="bg-linear-to-b from-app-primary to-app-primary-dark text-white shadow-md shadow-app-primary/40 transition-all duration-200 hover:scale-105 hover:brightness-110 hover:text-white active:scale-95"
          onClick={() => void handlePick()}
        >
          选择
        </Button>
        {path && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={handleReset}>
            恢复默认
          </Button>
        )}
      </div>
    </div>
  );
}

// 音量设置行:滑块(0~100)+ 实时百分比;提示音开关关闭时整行灰掉。
// 拖动中通过 onLiveChange 实时上报(试听音量立即跟随),拖完才提交持久化
function VolumeSetting({
  volume,
  disabled,
  onLiveChange,
  onCommit,
}: {
  // 当前持久化音量(0~1)
  volume: number;
  disabled?: boolean;
  // 拖动中实时回调(0~1),松手提交前试听音量也跟随这个值
  onLiveChange?: (volume: number) => void;
  onCommit: (volume: number) => void;
}) {
  // 拖动中的百分比(拖完才提交,但显示与试听音量实时跟随)
  const [dragPercent, setDragPercent] = useState<number | null>(null);
  const percent = dragPercent ?? Math.round(volume * 100);

  // 外部值变化(提交成功/其他窗口广播)时结束拖动状态,并把实时值对齐外部值
  useEffect(() => {
    setDragPercent(null);
    onLiveChange?.(volume);
  }, [volume, onLiveChange]);

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <Label>提示音音量</Label>
        <span
          className={cn(
            'w-12 text-right text-sm tabular-nums text-gray-600',
            disabled && 'text-gray-300',
          )}
        >
          {percent}%
        </span>
      </div>
      <Slider
        className={cn('mt-3', SLIDER_CLASS)}
        min={0}
        max={100}
        step={1}
        disabled={disabled}
        value={[percent]}
        onValueChange={([v]) => {
          setDragPercent(v);
          onLiveChange?.(v / 100);
        }}
        onValueCommit={([v]) => {
          setDragPercent(null);
          onCommit(v / 100);
        }}
      />
    </div>
  );
}

// ---------- 页面 ----------

// 提示音文件行的设置键(副本路径存在这里;原始文件名按 nameKey 一一对应另存)
type SoundFileKind = 'workEndSoundPath' | 'breakEndSoundPath';

// 展示名:优先用户选择的原始文件名,旧数据只有路径时退回路径文件名
function soundDisplayName(name: string, path: string): string {
  return name || path.split(/[\\/]/).pop() || '';
}

export default function SettingsPanel() {
  const settings = useSettings();
  // 音量滑块拖动中的实时值(0~1):尚未提交持久化,但试听音量要立即跟随;
  // null 表示不在拖动,试听音量就用持久化值
  const [liveVolume, setLiveVolume] = useState<number | null>(null);
  // 当前生效音量(拖动中=拖动值,否则=持久值)
  const effectiveVolume = liveVolume ?? settings?.soundVolume ?? 0.7;

  // —— 试听互斥管理(整页唯一):同一时间最多一个提示音在响 ——
  // 用令牌(token)防"晚到的结束回调搞乱状态":每次启动播放领取新令牌,
  // 旧播放的 onend 触发时令牌对不上就被忽略,不会误清新播放的"正在播放"状态
  const previewRef = useRef<{
    howl: Howl;
    kind: SoundFileKind;
    token: number;
  } | null>(null);
  const tokenRef = useRef(0);
  const [playingKind, setPlayingKind] = useState<SoundFileKind | null>(null);
  const [loadingKind, setLoadingKind] = useState<SoundFileKind | null>(null);

  // 停止试听:先摘掉 end 回调再销毁实例——晚到的旧 onend 从根源上无从触发;
  // 任何新播放/选择/恢复默认前都会先调它
  const stopPreview = useCallback(() => {
    const cur = previewRef.current;
    if (cur) {
      cur.howl.off('end');
      cur.howl.stop();
      cur.howl.unload();
      previewRef.current = null;
    }
    setPlayingKind(null);
    setLoadingKind(null);
  }, []);

  const togglePreview = useCallback(
    async (
      kind: SoundFileKind,
      path: string,
      defaultSrc: string,
      volume: number,
    ) => {
      if (playingKind === kind) {
        stopPreview(); // 正在播这个又点它 → 停止(■ → ▶️)
        return;
      }
      stopPreview(); // 播着别的(或重播本行) → 先停,同一时间只允许一个声音
      const token = ++tokenRef.current;
      setLoadingKind(kind);
      let expired = false;
      try {
        // 每次试听都重新加载:主进程从磁盘重读副本,配合时间戳文件名,
        // 换了新文件后播的一定是新声音,不会拿旧内容凑合
        const src = path
          ? await window.sound
              .load(path)
              .then((r) => r.dataURL)
              .catch(() => defaultSrc)
          : defaultSrc;
        if (token !== tokenRef.current) {
          expired = true; // 加载等待期间情况已变(点了别的行/停止),丢弃本次结果
          return;
        }
        const howl = new Howl({
          src: [src],
          volume,
          onend: () => {
            // 自然播完恢复 ▶️;只有当前令牌的结束回调才清状态
            if (token === tokenRef.current) {
              previewRef.current = null;
              setPlayingKind(null);
            }
          },
        });
        previewRef.current = { howl, kind, token };
        setPlayingKind(kind);
        howl.play();
      } finally {
        // 过期时不清 loading:loading 已由新一次操作接管,误清会把它的状态抹掉
        if (!expired) setLoadingKind(null);
      }
    },
    [playingKind, stopPreview],
  );

  // 试听音量实时跟随当前生效音量(拖动音量滑块时,正在试听的声音音量立即变)
  useEffect(() => {
    previewRef.current?.howl.volume(effectiveVolume);
  }, [effectiveVolume]);

  // 离开设置页(组件卸载)时停掉试听,不让声音在别的页面继续响
  useEffect(
    () => () => {
      const cur = previewRef.current;
      if (cur) {
        cur.howl.off('end');
        cur.howl.stop();
        cur.howl.unload();
        previewRef.current = null;
      }
    },
    [],
  );

  // 设置加载完成前不渲染,避免闪现默认值后又跳变
  if (!settings) return null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-10">
        {/* 页面标题:主题色加粗 + 主题色下划线装饰(与任务面板标题同风格) */}
        <header className="animate-fade-in-up">
          <h1 className="text-lg font-bold text-app-primary">设置</h1>
          <span className="mt-1.5 block h-1 w-10 rounded-full bg-app-primary" />
        </header>

        {/* 三张卡:红(番茄钟)/蓝(提示音)/绿(通用),依次淡入 */}
        <SettingsCard
          icon="🍅"
          title="番茄钟设置"
          accentClass="bg-app-primary"
          titleClass="text-app-primary"
          animationDelay="0.05s"
        >
          <DurationSetting
            label="专注时长"
            value={settings.workDuration}
            min={1}
            max={120}
            onCommit={(v) => updateSetting('workDuration', v)}
          />
          <DurationSetting
            label="短休息时长"
            value={settings.shortBreakDuration}
            min={1}
            max={30}
            onCommit={(v) => updateSetting('shortBreakDuration', v)}
          />
          <DurationSetting
            label="长休息时长"
            value={settings.longBreakDuration}
            min={1}
            max={60}
            onCommit={(v) => updateSetting('longBreakDuration', v)}
          />
          <LongBreakIntervalSetting value={settings.longBreakInterval} />
        </SettingsCard>

        <SettingsCard
          icon="🔔"
          title="提示音设置"
          accentClass="bg-app-blue"
          titleClass="text-app-blue"
          animationDelay="0.11s"
        >
          <SwitchRow
            label="提示音"
            description="番茄钟结束时播放提示音"
            checked={settings.soundEnabled}
            onCheckedChange={(v) => updateSetting('soundEnabled', v)}
          />
          <VolumeSetting
            volume={settings.soundVolume}
            disabled={!settings.soundEnabled}
            onLiveChange={setLiveVolume}
            onCommit={(v) => {
              setLiveVolume(null);
              updateSetting('soundVolume', v);
            }}
          />
          {/* 试听由父组件统一管理:playing/loading 按行分发,音量经 effect 实时跟随 */}
          <SoundFileSetting
            kind="workEndSoundPath"
            nameKey="workEndSoundName"
            label="专注结束提示音"
            path={settings.workEndSoundPath}
            name={soundDisplayName(
              settings.workEndSoundName,
              settings.workEndSoundPath,
            )}
            disabled={!settings.soundEnabled}
            playing={playingKind === 'workEndSoundPath'}
            loading={loadingKind === 'workEndSoundPath'}
            onTogglePreview={() =>
              void togglePreview(
                'workEndSoundPath',
                settings.workEndSoundPath,
                workEndSound,
                effectiveVolume,
              )
            }
            onStopPreview={stopPreview}
          />
          <SoundFileSetting
            kind="breakEndSoundPath"
            nameKey="breakEndSoundName"
            label="休息结束提示音"
            path={settings.breakEndSoundPath}
            name={soundDisplayName(
              settings.breakEndSoundName,
              settings.breakEndSoundPath,
            )}
            disabled={!settings.soundEnabled}
            playing={playingKind === 'breakEndSoundPath'}
            loading={loadingKind === 'breakEndSoundPath'}
            onTogglePreview={() =>
              void togglePreview(
                'breakEndSoundPath',
                settings.breakEndSoundPath,
                breakEndSound,
                effectiveVolume,
              )
            }
            onStopPreview={stopPreview}
          />
        </SettingsCard>

        <SettingsCard
          icon="⚙️"
          title="通用设置"
          accentClass="bg-app-break"
          titleClass="text-app-break"
          animationDelay="0.17s"
        >
          <SwitchRow
            label="开机自启动"
            description="登录系统后自动启动番茄钟"
            checked={settings.autoLaunch}
            onCheckedChange={(v) => updateSetting('autoLaunch', v)}
          />
          <SwitchRow
            label="窗口置顶"
            description="与标题栏的图钉按钮保持同步"
            checked={settings.alwaysOnTop}
            onCheckedChange={(v) => updateSetting('alwaysOnTop', v)}
          />
        </SettingsCard>
      </div>
    </div>
  );
}
