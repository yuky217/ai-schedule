import Constants, { ExecutionEnvironment } from 'expo-constants';
import { addDays } from 'date-fns';
import { LogBox, Platform } from 'react-native';

import { coursesOnDate, type Course, type Term } from '@/domain/course';
import type { CalEvent } from '@/domain/event';
import { describeEventFire, eventFireAt, type EventFire } from '@/domain/event-reminder';
import { taskAnchor, type Task } from '@/domain/task';

/**
 * 提醒调度。
 *
 * 主文档 5.1 对"日程型"的要求是"到点提醒一声"，对"执行型"是"点击进专注"。
 * 所以这里只给**有明确时间**的任务排通知，无时间任务永远不打扰用户。
 *
 * 全程 try/catch + 返回 null：通知权限被拒、模拟器不支持、Web 端没有通知，
 * 都不应该让"记一条事"这个动作失败。记录是主线，提醒只是加分项。
 *
 * ⚠️ 关于 Expo Go：
 * 官方文档（SDK 57）明确写着 —— expo-notifications 的**远程推送**从 SDK 53 起
 * 在 Android 的 Expo Go 里不可用，但"**本地通知（应用内通知）在 Expo Go 中仍然可用**"。
 * 也就是说被砍掉的是要服务器的 push（getExpoPushTokenAsync 那类），
 * 而我们用的 scheduleNotificationAsync 属于本地通知，**在 Expo Go 里照样能排**。
 * 所以这里绝不能按"是不是 Expo Go"来一刀切禁掉提醒 —— 那等于因为用不上推送，
 * 连本地提醒也一起不要了。
 *
 * ⚠️ 仍然要惰性 import：
 * 一来 Web 端没有通知能力，二来万一某个运行环境里模块确实加载不了，
 * 顶层 import 会把 quick-capture → app-store → 所有页面 的导入链整个炸断，
 * 表现为所有路由 "missing the required default export"。
 * 惰性 import + 外层 try/catch 之后，上述情况都只是"提醒静默不可用"，不会拖垮记录。
 */

type NotificationsModule = typeof import('expo-notifications');

let cachedModule: NotificationsModule | null | undefined;

/** 当前是否运行在 Expo Go 里。仅用于给用户提示能力边界，不用来决定开不开提醒。 */
export function isExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

// Expo Go（Android，SDK 53+）加载 expo-notifications 模块的那一刻，库自己会打出
// 一条 "Android Push notifications (remote notifications) ... was removed from Expo Go"
// 的 ERROR —— 它说的是**远程推送**（自动注册副作用），不是本地通知。
// 官方文档明确"本地通知在 Expo Go 仍可用"，我们用的只有本地通知。
// 这条噪音只在会话里弹一次，但正好打在用户第一次安排时间的时刻，会把人吓到 —— 挡掉。
// 只挡这一条，其他日志照常显示。
if (Platform.OS === 'android' && isExpoGo()) {
  LogBox.ignoreLogs(['was removed from Expo Go']);
}

async function loadNotifications(): Promise<NotificationsModule | null> {
  if (cachedModule !== undefined) return cachedModule;
  if (Platform.OS === 'web') {
    // 网页端没有系统通知托盘，直接放弃
    cachedModule = null;
    return cachedModule;
  }
  try {
    cachedModule = await import('expo-notifications');
  } catch {
    // 模块加载失败 —— 提醒不可用，但不影响记录
    cachedModule = null;
  }
  return cachedModule;
}

/** 提醒能力的真实状态。给设置页显示用，让"到底能不能响"是可见的，而不是靠猜。 */
export type ReminderSupport = {
  /** 模块能否加载 */
  moduleAvailable: boolean;
  /** 是否已拿到通知权限 */
  granted: boolean;
  inExpoGo: boolean;
  message: string;
};

/**
 * 探一次提醒能力。**不会弹权限框**——只想看状态时不该打扰用户。
 * 想弹权限走 ensureNotificationPermission()。
 */
export async function getReminderSupport(): Promise<ReminderSupport> {
  const inExpoGo = isExpoGo();
  const mod = await loadNotifications();
  if (!mod) {
    return {
      moduleAvailable: false,
      granted: false,
      inExpoGo,
      message: Platform.OS === 'web' ? '网页端不支持系统提醒' : '当前环境不支持本地提醒',
    };
  }
  let granted = false;
  try {
    granted = await hasNotificationPermission(mod);
  } catch {
    granted = false;
  }
  return {
    moduleAvailable: true,
    granted,
    inExpoGo,
    message: granted
      ? inExpoGo
        ? '可用（Expo Go 里本地提醒可正常触发）'
        : '可用'
      : '可用，但还没拿到通知权限 —— 排提醒时会问你要',
  };
}

/**
 * 发一条 N 秒后的测试提醒。纯粹为了验证"这台设备到底响不响"，
 * 别处不要用它代替真正的任务提醒。
 */
export async function sendTestReminder(seconds = 5): Promise<boolean> {
  const mod = await loadNotifications();
  if (!mod) return false;
  try {
    registerHandler(mod);
    if (!(await ensureNotificationPermission())) return false;
    await ensureAndroidChannel(mod);
    await mod.scheduleNotificationAsync({
      content: { title: '提醒工作正常', body: `${seconds} 秒前你按下了测试。` },
      trigger: {
        type: mod.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.max(1, Math.round(seconds)),
      },
    });
    return true;
  } catch {
    return false;
  }
}

let handlerRegistered = false;

function registerHandler(mod: NotificationsModule): void {
  if (handlerRegistered) return;
  handlerRegistered = true;
  try {
    mod.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // 忽略：某些运行环境不支持本地通知
  }
}

export async function ensureNotificationPermission(): Promise<boolean> {
  const Notifications = await loadNotifications();
  if (!Notifications) return false;
  if (await hasNotificationPermission(Notifications)) return true;
  try {
    const requested = await Notifications.requestPermissionsAsync();
    return isGranted(requested);
  } catch {
    return false;
  }
}

/**
 * 只问"现在有没有权限"，**不弹框**。
 * 启动时补排提醒要走这条：用户刚打开 App 就被问"要不要通知"太唐突，
 * 权限框只该出现在他主动做了一件事之后（记录、导入课表、导入考试）。
 */
async function hasNotificationPermission(mod: NotificationsModule): Promise<boolean> {
  try {
    return isGranted(await mod.getPermissionsAsync());
  } catch {
    return false;
  }
}

/**
 * 权限对象在不同平台/版本上字段不完全一致（有的给 granted，有的只给 status），
 * 所以两种都认一遍，避免因为一个字段名就把"提醒"整条链路判死。
 */
function isGranted(permission: { granted?: boolean; status?: string }): boolean {
  return permission.granted === true || permission.status === 'granted';
}

async function ensureAndroidChannel(mod: NotificationsModule): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await mod.setNotificationChannelAsync('default', {
      name: '日程提醒',
      importance: mod.AndroidImportance.DEFAULT,
    });
  } catch {
    // 忽略
  }
}

/**
 * 给任务排一条提醒。返回通知 id，失败返回 null。
 * 已经过期的任务不补排 —— 用户不需要被"昨天的会"打扰。
 *
 * **没设提醒就不排**（`reminderMinutesBefore == null`，见 domain/reminder.ts 的三态说明）：
 * 以前 null 当准点用，于是"没点过提醒那一格"的人也会被提醒 ——
 * 默认打扰用户是比默认安静更糟的错，因为用户根本不知道去哪儿关掉它。
 *
 * 提前量：> 0 时在开始/截止前 N 分钟触发；0 = 准点；
 * 若提前量时刻已过但准点还没到，退回准点提醒（比不提醒好）。
 */
export async function scheduleTaskReminder(task: Task): Promise<string | null> {
  if (task.reminderMinutesBefore == null) return null;

  const anchor = taskAnchor(task);
  if (!anchor) return null;

  const anchorDate = new Date(anchor);
  if (Number.isNaN(anchorDate.getTime())) return null;

  const offsetMinutes = task.reminderMinutesBefore;
  let fireAt = new Date(anchorDate.getTime() - offsetMinutes * 60_000);
  if (fireAt.getTime() <= Date.now()) {
    if (offsetMinutes > 0 && anchorDate.getTime() > Date.now()) {
      fireAt = anchorDate; // 提前量已过，退回准点
    } else {
      return null;
    }
  }

  const isDeadline = task.time.attribute === 'deadline';
  const when =
    offsetMinutes > 0
      ? `还有 ${offsetMinutes >= 60 ? `${offsetMinutes / 60} 小时` : `${offsetMinutes} 分钟`}${
          isDeadline ? '截止' : '开始'
        }`
      : task.kind === 'schedule'
        ? '到点了'
        : '这件事的截止时间快到了';
  /*
   * 地点跟着提醒一起送达。
   * 看到通知的那一刻，正是要决定"现在动不动身、往哪走"的那一刻 ——
   * 把地点留在详情页里，等于用户收到提醒后还得再点两下才知道去哪儿。
   */
  const body = task.location ? `${when} · ${task.location}` : when;

  try {
    const Notifications = await loadNotifications();
    if (!Notifications) return null;

    registerHandler(Notifications);
    if (!(await ensureNotificationPermission())) return null;
    await ensureAndroidChannel(Notifications);
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: task.title,
        body,
        data: { taskId: task.id },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt },
    });
  } catch {
    return null;
  }
}

/**
 * 取消某任务名下所有已排通知。
 *
 * 任务改期 / 改提前量 / 完成滚动 / 删除时先调它，否则旧通知仍会在
 * 原时刻弹出来，内容跟任务现状对不上。按 data.taskId 过滤，
 * 不影响其他任务的通知。全程静默容错。
 */
export async function cancelTaskReminders(taskId: string): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const item of scheduled) {
      if ((item.content.data as { taskId?: string } | undefined)?.taskId === taskId) {
        await Notifications.cancelScheduledNotificationAsync(item.identifier);
      }
    }
  } catch {
    // 忽略：通知不可用或取消失败都不影响主流程
  }
}

/**
 * 撤掉全部已排通知。备份"覆盖导入"后调用 —— 库已经整体换血，
 * 分不清哪些旧通知还作数，全撤再按新库重排是最稳的做法。
 */
export async function cancelAllReminders(): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const item of scheduled) {
      await Notifications.cancelScheduledNotificationAsync(item.identifier);
    }
  } catch {
    // 忽略
  }
}

/**
 * 按未来几天的课重排提醒，返回排上了几条。
 *
 * **为什么是"全撤重排"而不是增量维护**：课表是随时会变的东西（重导一次、
 * 删一门、改个上课时间）。增量太容易漏掉"已经排出去的那条旧通知" ——
 * 它还会在原时刻弹出来，内容却跟现状对不上，而用户根本不知道那条是旧的。
 * 全撤重排一把，逻辑上就没有这种漏洞；代价也小：一学期几十门课，
 * 7 天内也就几十条。
 *
 * **为什么只排 7 天**：一次性通知在安卓上有数量上限，一学期全排完会被系统
 * 静默丢掉一部分（最难查的那种 bug）；而且那么远的通知本来就该随课表变动重排。
 *
 * 每门课提前多久由 `course.reminderMinutesBefore` 决定，`null` = 这门课不提醒。
 */
export async function syncCourseReminders(
  courses: readonly Course[],
  term: Term | null,
  days = 7,
): Promise<number> {
  const Notifications = await loadNotifications();
  if (!Notifications) return 0;

  try {
    // 只撤"课程提醒"（按 data.courseId 认），不动任务那边的通知
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const item of scheduled) {
      const data = item.content.data as { courseId?: string } | undefined;
      if (data?.courseId) await Notifications.cancelScheduledNotificationAsync(item.identifier);
    }
  } catch {
    // 撤不干净就别往下排 —— 硬排的后果是同一条课弹出两个通知
    return 0;
  }

  if (!term || !courses.length) return 0;
  if (!(await ensureNotificationPermission())) return 0;
  await ensureAndroidChannel(Notifications);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const now = Date.now();
  let count = 0;

  for (let offset = 0; offset < days; offset += 1) {
    const date = addDays(today, offset);
    for (const slot of coursesOnDate(courses, date, term)) {
      const lead = slot.course.reminderMinutesBefore;
      if (lead == null || lead < 0) continue;
      // slot.start 是"当天第几分钟"，减掉提前量就是该响的时刻
      const fireAt = new Date(today.getTime() + (slot.start - lead) * 60_000);
      if (fireAt.getTime() <= now) continue; // 已经过点的课不补提醒

      const periods =
        slot.session.startPeriod === slot.session.endPeriod
          ? `第 ${slot.session.startPeriod} 节`
          : `第 ${slot.session.startPeriod}-${slot.session.endPeriod} 节`;
      const body = [periods, slot.session.location ?? slot.course.location, slot.course.teacher]
        .filter((part): part is string => Boolean(part))
        .join(' · ');

      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: slot.course.title,
            body,
            data: { courseId: slot.course.id },
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt },
        });
        count += 1;
      } catch {
        // 单条排不上不影响其余
      }
    }
  }
  return count;
}

/**
 * 给固定日程（考试）排提醒，返回排上了几条。**没有提前量字段** ——
 * 什么时候响由 `domain/event-reminder.ts` 定死（前一天 20:00，排不上退开考前 1 小时），
 * 这里只负责把它变成系统通知。
 *
 * **同样全撤重排**：考试的导入是"整批替换"语义（教务网重新查一次就整批再导一遍），
 * 增量维护只会留下一批指向旧考试的幽灵通知 —— 它们还会在原时刻弹出来，
 * 而用户根本不知道那是上一次导入的。
 *
 * **为什么不限天数**（课程那边只排 7 天）：一学期也就十来场考试，
 * 一次性通知的数量上限撑得住；而且考试本来就发生在几周之后，
 * 限成 7 天等于一场都排不上 —— 那这个功能就白做了。
 *
 * `requestPermission: false` 给**启动时补排**用：系统在重启后可能丢掉已排的一次性
 * 通知，而考试远在几周后、不像课表那样每次改动都会重排，所以在启动时补一次。
 * 但那时不该弹权限框（见 hasNotificationPermission 的说明）。
 */
export async function syncEventReminders(
  events: readonly CalEvent[],
  options: { requestPermission?: boolean } = {},
): Promise<number> {
  const Notifications = await loadNotifications();
  if (!Notifications) return 0;

  try {
    // 只撤"考试提醒"（按 data.eventId 认），不动任务和课程的通知
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const item of scheduled) {
      const data = item.content.data as { eventId?: string } | undefined;
      if (data?.eventId) await Notifications.cancelScheduledNotificationAsync(item.identifier);
    }
  } catch {
    // 撤不干净就别往下排 —— 硬排的后果是同一场考试弹出两个通知
    return 0;
  }

  const now = new Date();
  const upcoming: { event: CalEvent; fire: EventFire }[] = [];
  for (const event of events) {
    if (event.deletedAt) continue;
    const fire = eventFireAt(event, now);
    if (fire) upcoming.push({ event, fire });
  }
  if (!upcoming.length) return 0;

  const granted =
    options.requestPermission === false
      ? await hasNotificationPermission(Notifications)
      : await ensureNotificationPermission();
  if (!granted) return 0;
  await ensureAndroidChannel(Notifications);

  let count = 0;
  for (const { event, fire } of upcoming) {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: event.title,
          body: describeEventFire(event, fire),
          data: { eventId: event.id },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fire.at },
      });
      count += 1;
    } catch {
      // 单条排不上不影响其余
    }
  }
  return count;
}
