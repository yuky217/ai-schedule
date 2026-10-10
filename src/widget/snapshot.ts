import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { describeSlotTiming, nextCourse, type CourseSlot } from '@/domain/course';
import { describeClock, periodSpan } from '@/domain/timetable';
import { isAllDay, pendingUntil, type Task } from '@/domain/task';
import { TaskStatus } from '@/domain/enums';
import { useAppStore } from '@/state/app-store';

/**
 * 小组件数据快照。
 *
 * 为什么是「文件」而不是让 widget handler 现读数据库：
 * 小组件由 launcher 进程绘制，系统刷新时唤起的是一个**没有界面的 App 进程**，
 * 不保证 expo-sqlite 已初始化。所以 App 在前台/数据变动时把算好的快照写进文件，
 * widget handler 只读这份文件 —— 零依赖我们的 DB，也最快。
 * （见 docs/小组件实施规划.md 风险 1）
 */
export interface NextDeadline {
  /** "14:00" */
  time: string;
  title: string;
}

export interface NextClassInfo {
  title: string;
  /** "正在上 · 10:00–11:40" / "25 分钟后 · 10:00–11:40" */
  headline: string;
  place: string | null;
}

export interface WidgetSnapshot {
  todayCount: number;
  nextDeadline: NextDeadline | null;
  nextClass: NextClassInfo | null;
  updatedAt: string;
}

const snapshotFile = () => new File(Paths.document, 'widget-snapshot.json');

const pad2 = (n: number) => String(n).padStart(2, '0');
const formatHHMM = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/**
 * 现算「今天」+「下一节课」两卡的数据。
 * 纯函数，复用现有 domain 口径，不另造（与首页下一节课卡同一套逻辑）。
 */
export function computeWidgetSnapshot(): WidgetSnapshot {
  const state = useAppStore.getState();
  const now = new Date();

  // 今天：store.today 已是"今天开始/到期/进行中"的顶层任务；按 active 计数
  const items = state.today.filter((t: Task) => t.status !== TaskStatus.Done);
  const todayCount = items.length;

  // 下一个截止：今天里时间仍在将来、且最早的那一件
  let nextDeadline: NextDeadline | null = null;
  let bestMs = Infinity;
  for (const t of items) {
    // ⭐ 全天要看 endAt（当天 23:59:59）而不是 startAt，否则"今天全天"的事
    // 永远算不上"下一个截止"（00:00 永远在过去）。口径收在 domain.pendingUntil。
    const iso = pendingUntil(t.time);
    if (!iso) continue;
    const ms = new Date(iso).getTime();
    if (ms < now.getTime()) continue; // 只看还没到的
    if (ms < bestMs) {
      bestMs = ms;
      // 全天没有时刻可显示：写"00:00"等于谎报
      nextDeadline = { time: isAllDay(t.time) ? '全天' : formatHHMM(new Date(ms)), title: t.title };
    }
  }

  // 下一节课：复用首页同一条口径
  let nextClass: NextClassInfo | null = null;
  if (state.term && state.courses.length) {
    const slot: CourseSlot | null = nextCourse(state.courses, state.term, now);
    if (slot) {
      const timing = describeSlotTiming(slot, now);
      const span = periodSpan(state.term.periods, slot.session.startPeriod, slot.session.endPeriod);
      const clock = span ? `${describeClock(span.start)}–${describeClock(span.end)}` : '';
      const place = slot.session.location ?? slot.course.location ?? null;
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const minutesUntil = slot.start - nowMinutes;
      const headline =
        timing === '正在上'
          ? `正在上 · ${clock}`
          : minutesUntil > 0 && minutesUntil <= 120
            ? `${minutesUntil} 分钟后 · ${clock}`
            : `${timing} ${clock}`;
      nextClass = { title: slot.course.title, headline, place };
    }
  }

  return { todayCount, nextDeadline, nextClass, updatedAt: now.toISOString() };
}

/** 把当前快照写进文件（仅 Android 有意义；失败静默，widget 只是加分项） */
export async function writeWidgetSnapshot(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const snap = computeWidgetSnapshot();
    const file = snapshotFile();
    await file.write(JSON.stringify(snap));
  } catch {
    // 写快照失败不该影响主流程
  }
}

/** 读快照；文件缺失/损坏时返回空快照，widget 显示"0 件事 / 近期没有课" */
export async function readWidgetSnapshot(): Promise<WidgetSnapshot> {
  if (Platform.OS !== 'android') return emptySnapshot();
  try {
    const raw = await snapshotFile().text();
    const parsed = JSON.parse(raw) as Partial<WidgetSnapshot>;
    return { ...emptySnapshot(), ...parsed };
  } catch {
    return emptySnapshot();
  }
}

const emptySnapshot = (): WidgetSnapshot => ({
  todayCount: 0,
  nextDeadline: null,
  nextClass: null,
  updatedAt: '',
});
