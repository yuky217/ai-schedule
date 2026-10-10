import { Platform } from 'react-native';
import {
  FlexWidget,
  TextWidget,
  registerWidgetTaskHandler,
  requestWidgetUpdate,
  type WidgetRepresentation,
} from 'react-native-android-widget';

import { useAppStore } from '@/state/app-store';
import { computeWidgetSnapshot, readWidgetSnapshot, type WidgetSnapshot } from './snapshot';

/** 两个独立的小组件，用户可分别添加到桌面 */
const WIDGET_NAMES = ['Today', 'NextClass'] as const;
type WidgetName = (typeof WIDGET_NAMES)[number];

/** 配色与 App 主题一致（theme.ts 的暖调近黑近白，极简无彩色强调） */
const PALETTE = {
  light: { bg: '#FAF9F7', text: '#1B1A18', secondary: '#6D6A63' },
  dark: { bg: '#111110', text: '#F2F0EB', secondary: '#B5B1A8' },
} as const;

function buildWidget(name: WidgetName, theme: 'light' | 'dark', snap: WidgetSnapshot) {
  const c = PALETTE[theme];

  if (name === 'Today') {
    const deadline = snap.nextDeadline
      ? `下一个 ${snap.nextDeadline.time} ${snap.nextDeadline.title}`
      : '今天没有更多截止';
    return (
      <FlexWidget
        clickAction="OPEN_APP"
        accessibilityLabel="今天概览"
        style={{
          flexDirection: 'column',
          padding: 16,
          flexGap: 6,
          backgroundColor: c.bg,
          borderRadius: 16,
        }}>
        <TextWidget style={{ fontSize: 12, color: c.secondary }} text="今天" />
        <TextWidget
          style={{ fontSize: 18, fontWeight: 'bold', color: c.text }}
          text={`今天 ${snap.todayCount} 件事`}
        />
        <TextWidget style={{ fontSize: 14, color: c.secondary }} text={deadline} />
      </FlexWidget>
    );
  }

  // NextClass
  const sub = snap.nextClass
    ? snap.nextClass.place
      ? `${snap.nextClass.headline} · ${snap.nextClass.place}`
      : snap.nextClass.headline
    : '近期没有课';
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel="下一节课"
      style={{
        flexDirection: 'column',
        padding: 16,
        flexGap: 6,
        backgroundColor: c.bg,
        borderRadius: 16,
      }}>
      <TextWidget style={{ fontSize: 12, color: c.secondary }} text="下一节课" />
      <TextWidget
        style={{ fontSize: 18, fontWeight: 'bold', color: c.text }}
        text={snap.nextClass?.title ?? '还没排课'}
      />
      <TextWidget style={{ fontSize: 14, color: c.secondary }} text={sub} />
    </FlexWidget>
  );
}

/** 同时产出 light / dark 两版，由系统按当前主题挑 */
function renderRepresentation(snap: WidgetSnapshot, widgetName: WidgetName): WidgetRepresentation {
  return {
    light: buildWidget(widgetName, 'light', snap),
    dark: buildWidget(widgetName, 'dark', snap),
  };
}

/**
 * 注册小组件：必须在模块顶层调用（headless task 的注册要在 bundle 加载时就完成，
 * 不能放进 React 组件的 effect —— 系统冷启动刷新 widget 时不会跑 UI 组件）。
 */
export function setupWidgets(): void {
  if (Platform.OS !== 'android') return;

  registerWidgetTaskHandler(async ({ widgetInfo, widgetAction, renderWidget }) => {
    if (widgetAction === 'WIDGET_DELETED') return;
    const snap = await readWidgetSnapshot();
    renderWidget(renderRepresentation(snap, widgetInfo.widgetName as WidgetName));
  });

  // App 内数据一变（dataVersion 自增）就主动推给小组件，不等系统 30 分钟
  let lastVersion = useAppStore.getState().dataVersion;
  useAppStore.subscribe((state) => {
    if (state.dataVersion === lastVersion) return;
    lastVersion = state.dataVersion;
    pushWidgets();
  });

  // 启动后先推一次（把刚写好的快照画上去）
  pushWidgets();
}

function pushWidgets(): void {
  const snap = computeWidgetSnapshot();
  for (const name of WIDGET_NAMES) {
    void requestWidgetUpdate({
      widgetName: name,
      renderWidget: () => renderRepresentation(snap, name),
    });
  }
}
