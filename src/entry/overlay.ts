import { requireOptionalNativeModule } from 'expo-modules-core';
import { Linking, Platform } from 'react-native';

/**
 * 悬浮窗 —— 入口层在 Android 上的形态（主文档的「记录无感」）。
 *
 * 为什么不并进 `notifications.ts`：它们是两种不同的"能力可能不存在"。
 * 提醒是**系统授权**问题；悬浮窗是**打包形态**问题 —— 它是原生模块，
 * 网页端和 Expo Go 里根本不存在，只有独立安装的 Android 版才有。
 * 混在一起写，会让"能力层"这件事变得说不清。
 *
 * 三条纪律，跟提醒卡一致：
 * ① **默认关闭**。它会在屏幕上一直占一块地方，这种侵入性的东西绝不自动开。
 * ② **探真实状态，不靠猜**。`getOverlaySupport()` 读的是原生侧的实际值
 *    （权限给没给、服务在不在跑），不是本地记的"用户点过开关"。
 * ③ **拿不到原生模块就降级**，不抛异常、不拖垮页面 ——
 *    网页端渲染设置页时这条路径每次都会走到。
 *
 * 用户意愿（要不要开）由 `state/settings-store` 持久化；这里只负责"做得到做不到"。
 */

/** 原生模块暴露的接口，与 `modules/overlay` 里的 `ModuleDefinition` 一一对应 */
type OverlayNativeModule = {
  isSupported: () => boolean;
  canDrawOverlays: () => boolean;
  isShowing: () => boolean;
  requestPermission: () => Promise<boolean>;
  show: () => Promise<boolean>;
  hide: () => Promise<boolean>;
};

export type OverlayStatus =
  /** 权限齐了，开得起来 */
  | 'ready'
  /** 差"显示在其他应用上层"这个授权 */
  | 'need-permission'
  /** 这个形态下没有这个能力（网页端 / Expo Go / iOS） */
  | 'unavailable';

export interface OverlaySupport {
  status: OverlayStatus;
  /** 气泡是不是正浮着 */
  showing: boolean;
  /** 给界面直接显示的一句话 */
  message: string;
}

let cached: OverlayNativeModule | null | undefined;

/**
 * 拿原生模块。找不到就返回 null —— 不抛。
 * 缓存在模块作用域里：这个值一辈子不会变，没必要每次进设置页都问一遍。
 */
function native(): OverlayNativeModule | null {
  if (Platform.OS !== 'android') return null;
  if (cached !== undefined) return cached;
  try {
    cached = requireOptionalNativeModule<OverlayNativeModule>('Overlay') ?? null;
  } catch {
    cached = null;
  }
  return cached;
}

/** 探查当前真实状态。这是界面上一切判断的唯一出处。 */
export async function getOverlaySupport(): Promise<OverlaySupport> {
  const mod = native();
  if (!mod) {
    return {
      status: 'unavailable',
      showing: false,
      message:
        Platform.OS === 'android'
          ? '要装独立安装版才有；Expo Go 和网页端都缺原生模块'
          : '悬浮窗只有 Android 有；iOS 不允许应用画在别的应用之上',
    };
  }

  try {
    if (!mod.canDrawOverlays()) {
      return {
        status: 'need-permission',
        showing: false,
        message: '还差一步授权：允许「显示在其他应用上层」',
      };
    }
    const showing = mod.isShowing();
    return {
      status: 'ready',
      showing,
      message: showing ? '正浮着，点一下就能记' : '现在没开',
    };
  } catch {
    return { status: 'unavailable', showing: false, message: '当前环境下用不了' };
  }
}

/**
 * 开启。没授权就先跳系统设置页。
 *
 * 注意：跳出去之后用户授权完回来，**还需要再调一次本函数**才真的能开 ——
 * 这个"回来接着开"由设置页监听 AppState 完成，见 `app/settings.tsx`。
 */
export async function enableOverlay(): Promise<OverlaySupport> {
  const mod = native();
  if (!mod) return getOverlaySupport();
  try {
    if (!mod.canDrawOverlays()) {
      await mod.requestPermission();
    } else {
      await mod.show();
    }
  } catch {
    // 授权被拒 / 系统拒绝启动前台服务：如实返回当前状态即可
  }
  return getOverlaySupport();
}

export async function disableOverlay(): Promise<OverlaySupport> {
  const mod = native();
  if (mod) {
    try {
      await mod.hide();
    } catch {
      // 同上，失败不改写"当前状态"的判断来源
    }
  }
  return getOverlaySupport();
}

/**
 * 启动时按用户上次的选择恢复气泡。
 *
 * 为什么需要它：不是"开机自启"那么大的事，而是 —— 用户开过一次之后，
 * 不该因为 App 重启就得再去设置页点一次。开一次就一直在，才叫简单。
 * 用户没开过（`enabled === false`）时这里什么都不做，不产生任何副作用。
 */
export async function restoreOverlayIfEnabled(enabled: boolean): Promise<void> {
  if (!enabled) return;
  const mod = native();
  if (!mod) return;
  try {
    if (mod.canDrawOverlays() && !mod.isShowing()) await mod.show();
  } catch {
    // 恢复失败不是错误：权限可能被撤销了，设置页会显示真实状态
  }
}

/** 直接跳到授权页（设置页里"去打开"用的） */
export async function openOverlayPermission(): Promise<boolean> {
  const mod = native();
  if (!mod) return false;
  try {
    await mod.requestPermission();
    return true;
  } catch {
    return false;
  }
}

/** 深链地址。原生侧那份在 `OverlayService.CAPTURE_URL`，两处必须一致。 */
export const OVERLAY_CAPTURE_URL = 'aischedule://capture';

/** 给"点通知/点气泡之后到底去了哪"兜底：解析出问题就直接开记录页 */
export async function openCaptureDeepLink(): Promise<boolean> {
  try {
    const supported = await Linking.canOpenURL(OVERLAY_CAPTURE_URL);
    if (!supported) return false;
    await Linking.openURL(OVERLAY_CAPTURE_URL);
    return true;
  } catch {
    return false;
  }
}
