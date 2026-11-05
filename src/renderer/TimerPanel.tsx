import { useEffect, useRef, useState } from 'react';
import { Howl } from 'howler';
import type { Task } from '../shared/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import breakEndSound from './break-end.mp3';
import workEndSound from './work-end.mp3';
import { renderTrayIcon } from './tray-icon';
import { useSettings } from './use-settings';

// 番茄钟状态：渲染层只负责按状态展示，由计时逻辑驱动流转
type TimerStatus =
  | 'idle' // 空闲
  | 'working' // 工作中
  | 'paused' // 专注暂停
  | 'work-done' // 专注完成，待开始休息
  | 'short-break' // 短休息
  | 'long-break' // 长休息
  | 'break-paused' // 休息暂停
  | 'break-done'; // 休息结束，待开始下一个专注

const STATUS_CONFIG: Record<
  TimerStatus,
  { label: string; text: string; dot: string; number: string }
> = {
  // 空闲与待开始:数字降到半透明,暗示当前不是活跃计时状态
  idle: {
    label: '准备开始',
    text: 'text-gray-400',
    dot: 'bg-gray-400',
    number: 'text-gray-400/60',
  },
  working: {
    label: '专注中',
    text: 'text-app-primary',
    dot: 'bg-app-primary',
    number: 'text-app-primary',
  },
  paused: {
    label: '已暂停',
    text: 'text-app-amber',
    dot: 'bg-app-amber',
    number: 'text-app-amber',
  },
  'work-done': {
    label: '专注完成，休息一下吧',
    text: 'text-app-glow-break',
    dot: 'bg-app-glow-break',
    number: 'text-app-glow-break',
  },
  'short-break': {
    label: '短休息中',
    text: 'text-app-glow-break',
    dot: 'bg-app-glow-break',
    number: 'text-app-glow-break',
  },
  'long-break': {
    label: '长休息中',
    text: 'text-app-glow-break',
    dot: 'bg-app-glow-break',
    number: 'text-app-glow-break',
  },
  'break-paused': {
    label: '休息已暂停',
    text: 'text-app-amber',
    dot: 'bg-app-amber',
    number: 'text-app-amber',
  },
  'break-done': {
    label: '开始下一个番茄吧',
    text: 'text-gray-400',
    dot: 'bg-gray-400',
    number: 'text-gray-400/60',
  },
};

// 主按钮的四种形态：待专注（红·开始专注）、待休息（绿·开始休息）、计时中（琥珀·暂停）、暂停后（琥珀·继续）
// 渐变自上而下由浅入深,底部深色保证白色文字可读;阴影用同色系,与圆环颜色对应
type ActionState = 'focus-idle' | 'break-ready' | 'running' | 'paused';

const ACTION_BUTTON: Record<
  ActionState,
  { label: string; className: string }
> = {
  'focus-idle': {
    label: '开始专注',
    className:
      'bg-linear-to-b from-app-primary to-app-primary-dark shadow-lg shadow-app-primary/40',
  },
  'break-ready': {
    label: '开始休息',
    className:
      'bg-linear-to-b from-app-break to-app-break-dark shadow-lg shadow-app-break/40',
  },
  running: {
    label: '暂停',
    className:
      'bg-linear-to-b from-app-amber to-app-amber-dark shadow-lg shadow-app-amber/40',
  },
  paused: {
    label: '继续',
    className:
      'bg-linear-to-b from-app-amber to-app-amber-dark shadow-lg shadow-app-amber/40',
  },
};

const PROGRESS_R = 88;
const PROGRESS_CIRC = 2 * Math.PI * PROGRESS_R;

function formatTime(seconds: number) {
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

interface TimerPanelProps {
  // 当前选中的任务(App 持有),null 表示自由专注
  selectedTask: Task | null;
  // 数据版本号:番茄钟写库后 +1,驱动从数据库重新同步底部计数
  pomodoroVersion: number;
  // 番茄钟写库成功后通知 App 刷新数据
  onPomodoroSaved: () => void;
  // 选中任务被标记完成时 +1,计时器随之回到初始状态
  taskCompletedSignal: number;
}

export default function TimerPanel({
  selectedTask,
  pomodoroVersion,
  onPomodoroSaved,
  taskCompletedSignal,
}: TimerPanelProps) {
  // 全局设置:各阶段时长/长休息间隔/提示音音量与音源都从这里来。
  // 任何位置(设置页/主进程)修改后经广播同步到这里,展示立即跟随
  const settings = useSettings();
  // 各阶段时长(秒)与间隔;设置加载完成前按 schema 默认值展示
  const workDuration = (settings?.workDuration ?? 25) * 60;
  const shortBreakDuration = (settings?.shortBreakDuration ?? 5) * 60;
  const longBreakDuration = (settings?.longBreakDuration ?? 15) * 60;
  const longBreakInterval = settings?.longBreakInterval ?? 4;
  const soundVolume = settings?.soundVolume ?? 0.7;
  // 提示音开关:关闭后阶段结束时不再播放提示音(系统通知不受影响,照常弹出)
  const soundEnabled = settings?.soundEnabled ?? true;

  const [status, setStatus] = useState<TimerStatus>('idle');
  const [secondsLeft, setSecondsLeft] = useState(workDuration);
  // 今日已完成番茄数:以数据库为准,每次数据变化后重新同步
  const [completedToday, setCompletedToday] = useState(0);
  // 下一个休息的类型：在专注完成那一刻根据累计番茄数决定
  const [nextBreakType, setNextBreakType] = useState<'short' | 'long'>('short');
  // 本轮专注开始计时的时刻（恢复计时也会重置），用于写番茄钟记录，暂停时间不计入
  const [focusStartedAt, setFocusStartedAt] = useState<number | null>(null);
  // 本轮专注归属的任务:点「开始专注」时快照,专注中途切换选中不影响归属
  const [focusTaskId, setFocusTaskId] = useState<number | null>(null);
  // 开始专注时的时长快照(秒):写库记录"开始那一刻"设置的时长,
  // 专注中途改设置不影响本番茄的记录时长
  const focusDurationRef = useRef(workDuration);
  // 开始休息时的时长快照(秒):休息进行中/暂停中圆环按快照计算,
  // 中途改设置不跳变;等待休息(work-done)界面仍跟随当前设置展示
  const breakDurationRef = useRef(shortBreakDuration);
  // 本轮周期（4 个一组）起点的累计番茄数：集满 4 个后底部不清零，
  // 满屏的番茄保持到开始新一轮专注的那一刻才清零（cycleOffset 在那时更新）
  const [cycleOffset, setCycleOffset] = useState(0);
  // 是否已完成首次加载(重启恢复时才对齐周期起点)
  const loadedRef = useRef(false);
  // 计时截止时刻(挂钟毫秒)。用时间差而非 interval 累减计时:
  // 窗口被遮挡/最小化时 interval 会被强节流,挂钟差值保证时间永远精确
  const endAtRef = useRef<number | null>(null);
  // 提示音实例:挂载时创建并预解码(归零时零延迟出声)。Howler 默认开启
  // autoUnlock,会抓住用户第一次点击(如「开始专注」)解锁 AudioContext,
  // 绕过浏览器自动播放限制;之后播放由音频线程驱动,最小化/后台不受节流影响
  const soundsRef = useRef<{ workEnd: Howl; breakEnd: Howl } | null>(null);

  // 音效来源:默认音(内置)或自定义音(设置中的路径,经主进程读成 dataURL)
  const [soundSources, setSoundSources] = useState<{ workEnd: string; breakEnd: string }>({
    workEnd: workEndSound,
    breakEnd: breakEndSound,
  });

  // 自定义提示音路径变化 → 重新解析音源;读取失败(文件被移动/删除)回退默认音,
  // 保证倒计时结束时总有声音可播。cancelled 守卫丢弃过期请求的结果
  useEffect(() => {
    let cancelled = false;
    const workPath = settings?.workEndSoundPath ?? '';
    const breakPath = settings?.breakEndSoundPath ?? '';
    void Promise.all([
      workPath
        ? window.sound.load(workPath).then((r) => r.dataURL).catch(() => workEndSound)
        : workEndSound,
      breakPath
        ? window.sound.load(breakPath).then((r) => r.dataURL).catch(() => breakEndSound)
        : breakEndSound,
    ]).then(([work, brk]) => {
      if (!cancelled) setSoundSources({ workEnd: work, breakEnd: brk });
    });
    return () => {
      cancelled = true;
    };
  }, [settings?.workEndSoundPath, settings?.breakEndSoundPath]);

  // 最新音量 ref:创建 Howl 时要带当前音量,但不希望音量变化触发实例重建
  const volumeRef = useRef(soundVolume);
  useEffect(() => {
    volumeRef.current = soundVolume;
  });

  // 音源变化(含首挂载)时重建 Howl 实例并预解码;卸载/重建时释放旧实例,
  // 避免音频资源随重建不断堆积
  useEffect(() => {
    const workEnd = new Howl({ src: [soundSources.workEnd], volume: volumeRef.current });
    const breakEnd = new Howl({ src: [soundSources.breakEnd], volume: volumeRef.current });
    soundsRef.current = { workEnd, breakEnd };
    return () => {
      workEnd.unload();
      breakEnd.unload();
      soundsRef.current = null;
    };
  }, [soundSources]);

  // 音量设置变化 → 立即应用到现有实例(只调音量,不重建、不打断解码)
  useEffect(() => {
    soundsRef.current?.workEnd.volume(soundVolume);
    soundsRef.current?.breakEnd.volume(soundVolume);
  }, [soundVolume]);

  // 按截止时刻计算剩余秒数(向上取整);无截止时刻时返回 null
  const remainingSeconds = () => {
    if (endAtRef.current === null) return null;
    return Math.max(0, Math.ceil((endAtRef.current - Date.now()) / 1000));
  };

  const isCounting =
    status === 'working' || status === 'short-break' || status === 'long-break';
  const isBreakPhase =
    status === 'short-break' ||
    status === 'long-break' ||
    status === 'break-paused';
  const breakDuration =
    nextBreakType === 'long' ? longBreakDuration : shortBreakDuration;
  // 底部番茄显示本轮周期的进度（0~4）：第 4 个完成后停在 4/4，新一轮开始时归零
  const currentCycleCount = completedToday - cycleOffset;

  // 从数据库读取今天的番茄钟记录,统计真实完成数(没有记录就是 0);
  // 番茄钟写库成功后版本号 +1 会触发重新同步,始终以数据库为准
  useEffect(() => {
    window.database
      .getPomodorosToday()
      .then((records) => {
        const count = records.filter((r) => r.type === 'work').length;
        setCompletedToday(count);
        // 仅首次加载时按 4 个一组对齐周期起点(重启恢复场景,保证不超过 4);
        // 之后由「开始新一轮专注」维护,避免完成第 4 个番茄时立刻清零
        if (!loadedRef.current) {
          loadedRef.current = true;
          setCycleOffset(
            longBreakInterval * Math.floor(count / longBreakInterval),
          );
        }
      })
      .catch((err) => console.error('读取今日番茄数失败:', err));
  }, [pomodoroVersion]);

  // 设置变化 → 同步未计时界面的展示时长:
  // 空闲/休息结束显示新的专注时长,专注完成等待休息显示即将开始的休息时长。
  // 计时中与暂停中不动——进行中的番茄按开始那一刻的时长计算,中途改设置不影响
  useEffect(() => {
    if (status === 'idle' || status === 'break-done') {
      setSecondsLeft(workDuration);
    } else if (status === 'work-done') {
      setSecondsLeft(
        nextBreakType === 'long' ? longBreakDuration : shortBreakDuration,
      );
    }
  }, [status, workDuration, shortBreakDuration, longBreakDuration, nextBreakType]);

  // 长休息间隔变化 → 非计时状态下按新间隔重新对齐周期起点(计时中不动,
  // 新一轮专注开始时自然对齐)。用 ref 记录上次值,只在间隔真正变化时执行:
  // 番茄写库导致的 completedToday 变化不能触发这里,否则完成第 4 个番茄时
  // 底部番茄会被立刻清零,失去"满 4 停留"的展示
  const lastIntervalRef = useRef(longBreakInterval);
  useEffect(() => {
    if (lastIntervalRef.current === longBreakInterval) return;
    lastIntervalRef.current = longBreakInterval;
    if (isCounting) return;
    setCycleOffset(
      longBreakInterval * Math.floor(completedToday / longBreakInterval),
    );
  }, [longBreakInterval, isCounting, completedToday]);

  // 计时中每 0.5 秒按挂钟差值刷新剩余时间（专注与休息共用同一个倒计时）。
  // 后台被节流时 tick 变慢,但每次 tick 都用 Date.now() 校正,恢复后立即准确
  useEffect(() => {
    if (!isCounting) return;
    const timer = setInterval(() => {
      const remaining = remainingSeconds();
      if (remaining !== null) setSecondsLeft(remaining);
    }, 500);
    return () => clearInterval(timer);
  }, [isCounting]);

  // 专注倒计时归零 → 完成一个番茄钟，写入记录并进入“开始休息”界面
  useEffect(() => {
    if (status !== 'working' || secondsLeft !== 0) return;
    const nextBreak: 'short' | 'long' =
      (completedToday + 1) % longBreakInterval === 0 ? 'long' : 'short';
    setNextBreakType(nextBreak);
    // “开始休息”界面直接展示即将开始的休息时长
    setSecondsLeft(
      nextBreak === 'long' ? longBreakDuration : shortBreakDuration,
    );
    setStatus('work-done');
    // 归零立即播放提示音并弹系统通知,不等用户点击(开关关闭时只弹通知)
    if (soundEnabled) soundsRef.current?.workEnd.play();
    window.notification
      .show('专注结束 🍅', '专注时间到了，休息一下吧！')
      .catch((err) => console.error('发送专注结束通知失败:', err));
    // 记录番茄钟,关联开始专注时快照的任务与时长(自由专注为 null);
    // 写库成功后通知刷新,底部计数与任务卡片番茄数从数据库重新同步
    if (focusStartedAt !== null) {
      window.database
        .addPomodoro({
          taskId: focusTaskId,
          duration: focusDurationRef.current,
          type: 'work',
          startedAt: new Date(focusStartedAt).toISOString(),
          endedAt: new Date().toISOString(),
        })
        .then(onPomodoroSaved)
        .catch((err) => console.error('写入番茄钟记录失败:', err));
    }
  }, [
    status,
    secondsLeft,
    completedToday,
    focusStartedAt,
    focusTaskId,
    onPomodoroSaved,
    longBreakInterval,
    longBreakDuration,
    shortBreakDuration,
  ]);

  // 休息倒计时归零 → 待开始下一个专注
  useEffect(() => {
    if (
      (status === 'short-break' || status === 'long-break') &&
      secondsLeft === 0
    ) {
      endAtRef.current = null;
      setSecondsLeft(workDuration);
      setStatus('break-done');
      // 归零立即播放提示音并弹系统通知,不等用户点击(开关关闭时只弹通知)
      if (soundEnabled) soundsRef.current?.breakEnd.play();
      window.notification
        .show('休息结束 ⏰', '休息结束，继续加油！')
        .catch((err) => console.error('发送休息结束通知失败:', err));
    }
  }, [status, secondsLeft, workDuration]);

  // 选中的任务被标记完成 → 计时器回到初始状态:
  // 与该任务关联的专注流程已结束,无论当前处于计时/暂停/休息/待休息哪一阶段都打断,
  // 被打断的番茄不写库(与「重置」的语义一致)
  useEffect(() => {
    if (taskCompletedSignal === 0) return; // 首次挂载不触发
    endAtRef.current = null;
    setStatus('idle');
    setSecondsLeft(workDuration);
  }, [taskCompletedSignal, workDuration]);

  // 进度环比例：计时/暂停中的阶段用各自开始那一刻的时长快照——与 endAtRef
  // 的口径一致,中途改设置圆环比例不跳变;空闲/等待休息(work-done)跟随当前设置展示
  const totalDuration =
    status === 'working' || status === 'paused'
      ? focusDurationRef.current
      : status === 'short-break' || status === 'long-break' || status === 'break-paused'
        ? breakDurationRef.current
        : status === 'work-done'
          ? breakDuration
          : workDuration;
  const progress = secondsLeft / totalDuration;

  const statusCfg = STATUS_CONFIG[status];
  const actionState: ActionState = isCounting
    ? 'running'
    : status === 'paused' || status === 'break-paused'
      ? 'paused'
      : status === 'work-done'
        ? 'break-ready'
        : 'focus-idle';
  const action = ACTION_BUTTON[actionState];

  // 圆环颜色(与按钮颜色对应):空闲/待开始淡红、专注红、暂停琥珀、等待休息淡绿、休息绿
  const ringColor =
    status === 'working'
      ? 'text-app-primary'
      : status === 'paused' || status === 'break-paused'
        ? 'text-app-amber'
        : status === 'work-done'
          ? 'text-app-break-light'
          : isBreakPhase
            ? 'text-app-glow-break'
            : 'text-app-primary-light';

  // 卡片状态光晕:计时中按阶段红/绿,等待休息绿;空闲与暂停保持中性淡阴影
  const cardGlow = isCounting
    ? isBreakPhase
      ? 'glow-card-break'
      : 'glow-card-focus'
    : status === 'work-done'
      ? 'glow-card-break'
      : null;

  // 计时中进度弧随每秒 tick 平滑流动;暂停/重置时禁用过渡,环立即停在/回到目标位置
  const ringTransition = isCounting
    ? 'transition-[stroke-dashoffset] duration-1000 ease-linear'
    : undefined;

  const handleAction = () => {
    if (isCounting) {
      // 计时中 → 暂停:按截止时刻精确计算剩余并清空截止时刻
      const remaining = remainingSeconds();
      if (remaining !== null) setSecondsLeft(remaining);
      endAtRef.current = null;
      setStatus(status === 'working' ? 'paused' : 'break-paused');
    } else if (status === 'paused') {
      // 恢复计时：以当前剩余时间重建截止时刻(暂停期间不计入)
      endAtRef.current = Date.now() + secondsLeft * 1000;
      setFocusStartedAt(Date.now());
      setStatus('working');
    } else if (status === 'work-done' || status === 'break-paused') {
      // 开始（或继续）休息，休息类型在专注完成时已确定
      if (status === 'work-done') breakDurationRef.current = breakDuration;
      endAtRef.current =
        Date.now() + (status === 'break-paused' ? secondsLeft : breakDuration) * 1000;
      setStatus(nextBreakType === 'long' ? 'long-break' : 'short-break');
    } else {
      // 空闲或休息结束：开始新一轮专注。
      // 周期起点按间隔的倍数对齐：上一周期未集满时值不变（番茄继续累加），
      // 集满后开始新一轮时跳到下一个周期边界，底部番茄在此刻清零
      setSecondsLeft(workDuration);
      setCycleOffset(
        longBreakInterval * Math.floor(completedToday / longBreakInterval),
      );
      setFocusStartedAt(Date.now());
      // 时长也在此刻快照:专注中途改设置不影响本番茄的记录时长
      focusDurationRef.current = workDuration;
      // 为选中的任务开始番茄钟(此刻快照,中途切换选中不影响归属)
      setFocusTaskId(selectedTask?.id ?? null);
      endAtRef.current = Date.now() + workDuration * 1000;
      setStatus('working');
    }
  };

  const handleReset = () => {
    endAtRef.current = null;
    if (isBreakPhase) {
      // 休息阶段重置：清掉当前休息，回到“开始休息”界面，不进入下一个专注
      setSecondsLeft(breakDuration);
      setStatus('work-done');
    } else {
      // 专注阶段重置：回到完整专注时长的“开始专注”界面，不记录番茄钟
      setSecondsLeft(workDuration);
      setStatus('idle');
    }
  };

  // 托盘「跳过」：专注阶段不记录番茄钟，进入“开始休息”等待态；
  // 休息阶段进入“开始专注”等待态。空闲/等待态下无操作
  const handleSkip = () => {
    if (status === 'working' || status === 'paused') {
      endAtRef.current = null;
      // 休息类型与专注自然完成时同一套规则(按累计番茄数决定)
      const nextBreak: 'short' | 'long' =
        (completedToday + 1) % longBreakInterval === 0 ? 'long' : 'short';
      setNextBreakType(nextBreak);
      setSecondsLeft(
        nextBreak === 'long' ? longBreakDuration : shortBreakDuration,
      );
      setStatus('work-done');
    } else if (isBreakPhase) {
      endAtRef.current = null;
      setSecondsLeft(workDuration);
      setStatus('break-done');
    }
  };

  // 托盘命令转发到「最新版」操作函数:监听器只挂载一次(卸载时清理),
  // 经 ref 间接调用,避免每秒重挂监听或命中过期的旧闭包
  const actionRef = useRef(handleAction);
  const skipRef = useRef(handleSkip);
  useEffect(() => {
    actionRef.current = handleAction;
    skipRef.current = handleSkip;
  });

  useEffect(() => {
    const off = window.tray.onCommand((command) => {
      if (command === 'toggle') actionRef.current();
      else if (command === 'skip') skipRef.current();
    });
    return off;
  }, []);

  // 每秒把计时状态上报主进程 → 更新托盘悬停文字。
  // secondsLeft 计时中每秒变化驱动本 effect,空闲/等待时随状态变化上报一次
  useEffect(() => {
    const phase =
      status === 'working'
        ? 'focus'
        : status === 'paused' || status === 'break-paused'
          ? 'paused'
          : isBreakPhase
            ? 'break'
            : status === 'work-done' || status === 'break-done'
              ? 'waiting'
              : 'idle';
    const withTime =
      status === 'working' || status === 'paused' || isBreakPhase;
    const timeText = withTime ? formatTime(secondsLeft) : '';
    window.tray.updateStatus(phase, timeText);
    // 剩余时间同时画进托盘图标:Windows 悬停中的 tooltip 不刷新,
    // 图标上的数字才是每秒实时可见的
    window.tray.updateIcon(renderTrayIcon(phase, timeText));

    // 迷你窗口同步:上报细分阶段(与界面颜色一一对应)+ 界面展示时间 + 是否计时中。
    // 等待/空闲阶段也上报展示时长,迷你窗口全程有数字可显示;计时逻辑不外流,
    // 迷你窗口只是显示端
    const miniPhase =
      status === 'working'
        ? 'focus'
        : status === 'short-break' || status === 'long-break'
          ? 'break'
          : status === 'paused' || status === 'break-paused'
            ? 'paused'
            : status === 'work-done'
              ? 'break-wait'
              : 'idle';
    window.miniReporter.updateState({
      phase: miniPhase,
      timeText: formatTime(secondsLeft),
      running: isCounting,
    });
  }, [status, secondsLeft, isBreakPhase]);

  return (
    <div className={cn('glow-card w-[380px] rounded-3xl p-8', cardGlow)}>
      {/* 当前任务提示 */}
      <p
        data-testid="current-task"
        className="mb-3 flex min-w-0 items-baseline justify-center gap-1"
      >
        {selectedTask ? (
          <>
            <span className="shrink-0 text-xs text-gray-400">当前任务：</span>
            <span
              className="min-w-0 truncate text-sm font-bold text-gray-700"
              title={selectedTask.name}
            >
              {selectedTask.name}
            </span>
          </>
        ) : (
          <span className="text-sm font-bold text-gray-700">自由专注</span>
        )}
      </p>

      {/* 进度环 + 倒计时数字 + 状态标签 */}
      <div
        className={cn(
          'relative mx-auto h-64 w-64 rounded-full',
          // 计时中整个进度环呼吸发光:光晕一大一小循环,专注红 / 休息绿
          isCounting && (isBreakPhase ? 'breathe-break' : 'breathe-focus'),
        )}
      >
        <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90">
          {/* 发光层的高斯模糊滤镜 */}
          <defs>
            <filter id="ring-glow-filter" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" />
            </filter>
          </defs>
          {/* 底环 */}
          <circle
            cx="100"
            cy="100"
            r={PROGRESS_R}
            fill="none"
            strokeWidth="10"
            className="stroke-app-card-border"
          />
          {/* 发光层:与进度弧同形状但更宽、半透明、带模糊,垫在主弧下营造光晕感 */}
          <circle
            cx="100"
            cy="100"
            r={PROGRESS_R}
            fill="none"
            stroke="currentColor"
            strokeWidth="20"
            strokeLinecap="round"
            strokeDasharray={PROGRESS_CIRC}
            strokeDashoffset={PROGRESS_CIRC * (1 - progress)}
            opacity="0.35"
            filter="url(#ring-glow-filter)"
            className={cn(ringColor, ringTransition)}
          />
          {/* 进度弧 */}
          <circle
            cx="100"
            cy="100"
            r={PROGRESS_R}
            fill="none"
            stroke="currentColor"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={PROGRESS_CIRC}
            strokeDashoffset={PROGRESS_CIRC * (1 - progress)}
            className={cn(ringColor, ringTransition)}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <span
            data-testid="time"
            className={cn(
              'text-6xl font-extrabold tracking-tight tabular-nums',
              statusCfg.number,
            )}
          >
            {formatTime(secondsLeft)}
          </span>
          <span
            data-testid="status"
            className={cn(
              'flex items-center gap-1.5 text-sm font-medium',
              statusCfg.text,
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', statusCfg.dot)} />
            {statusCfg.label}
          </span>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="mt-6 flex items-center justify-center gap-4">
        <Button
          size="lg"
          className={cn(
            'h-11 w-32 rounded-2xl text-white',
            // 悬停微微放大,点击微微缩小,给按压反馈感
            'transition-all duration-200 hover:scale-105 hover:brightness-110 active:scale-95',
            action.className,
          )}
          aria-label={action.label}
          onClick={handleAction}
        >
          {action.label}
        </Button>
        <Button
          size="lg"
          className="h-11 w-32 rounded-2xl bg-linear-to-b from-app-reset to-app-reset-dark text-white shadow-lg shadow-app-reset/30 transition-all duration-200 hover:scale-105 hover:brightness-110 active:scale-95"
          aria-label="重置"
          onClick={handleReset}
        >
          重置
        </Button>
      </div>

      {/* 本轮番茄进度：集满间隔数进入长休息后清零，重新从第一个开始计数 */}
      <p
        className="mt-4 min-h-8 text-center text-2xl"
        title={`本轮已完成 ${currentCycleCount}/${longBreakInterval} 个番茄，集满 ${longBreakInterval} 个进入长休息`}
      >
        {'🍅'.repeat(currentCycleCount)}
      </p>
    </div>
  );
}
