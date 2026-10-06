import Constants, { ExecutionEnvironment } from 'expo-constants';
import { LogBox, Platform } from 'react-native';

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
    granted = isGranted(await mod.getPermissionsAsync());
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
  try {
    const current = await Notifications.getPermissionsAsync();
    if (isGranted(current)) return true;
    const requested = await Notifications.requestPermissionsAsync();
    return isGranted(requested);
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
 * 提前量：task.reminderMinutesBefore > 0 时在开始/截止前 N 分钟触发；
 * 若提前量时刻已过但准点还没到，退回准点提醒（比不提醒好）。
 */
export async function scheduleTaskReminder(task: Task): Promise<string | null> {
  const anchor = taskAnchor(task);
  if (!anchor) return null;

  const anchorDate = new Date(anchor);
  if (Number.isNaN(anchorDate.getTime())) return null;

  const offsetMinutes = task.reminderMinutesBefore ?? 0;
  let fireAt = new Date(anchorDate.getTime() - offsetMinutes * 60_000);
  if (fireAt.getTime() <= Date.now()) {
    if (offsetMinutes > 0 && anchorDate.getTime() > Date.now()) {
      fireAt = anchorDate; // 提前量已过，退回准点
    } else {
      return null;
    }
  }

  const isDeadline = task.time.attribute === 'deadline';
  const body =
    offsetMinutes > 0
      ? `还有 ${offsetMinutes >= 60 ? `${offsetMinutes / 60} 小时` : `${offsetMinutes} 分钟`}${
          isDeadline ? '截止' : '开始'
        }`
      : task.kind === 'schedule'
        ? '到点了'
        : '这件事的截止时间快到了';

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
