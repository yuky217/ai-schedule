import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable } from 'react-native';

import { CaptureSuccess } from '@/components/capture-success';
import { Card } from '@/components/card';
import { CaptureInput } from '@/components/capture-input';
import { type DateTimePreset } from '@/components/date-time-picker';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import type { CaptureRoute } from '@/domain/routing';
import type { QuickCaptureResult } from '@/entry/quick-capture';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';
import { closeScreen } from '@/utils/navigation';

/**
 * 快速记录（模态）。
 *
 * 界面上只有输入框 + 一排 chip —— 以前"什么时候"预设单占一张卡，说的事和
 * "时间"chip 是同一件（2026-10-07 并入）：预设挪进了时间面板顶部，点一下
 * 即定即收；不点就是不定时间（或者交给文本自动识别）。
 * 它仍然不问"这件事属于哪个项目"——那是收集箱和后面的流程该干的事。
 *
 * 记完**不换页**：大勾动效 1.6 秒自动关页（2026-10-08 用户点名撤掉结果卡 ——
 * 那页只为说一声"成了"，还要用户再按一次关是纯负担）。× 用 closeScreen：
 * 直接开网址 / 深链冷启动时没有历史栈，back() 是空操作。
 */

const CAPTURE_TIME_PRESETS: readonly DateTimePreset[] = [
  {
    key: 'today-evening',
    label: '今天 18:00',
    build: () => draftAt(0, 18 * 60, 'fixed'),
  },
  {
    key: 'tomorrow-morning',
    label: '明天 09:00',
    build: () => draftAt(1, 9 * 60, 'fixed'),
  },
  {
    key: 'tomorrow-due',
    label: '明天 18:00 截止',
    build: () => draftAt(1, 18 * 60, 'deadline'),
  },
];

function draftAt(dayOffset: number, minutesOfDay: number, attribute: 'fixed' | 'deadline') {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  return { date, minutesOfDay, attribute };
}

const ROUTE_LABEL: Record<CaptureRoute, string> = {
  idea: '想法库',
  inbox: '收集箱',
  calendar: '日历',
};

export default function CaptureScreen() {
  const router = useRouter();
  const theme = useTheme();
  const capture = useAppStore((state) => state.capture);

  const [result, setResult] = useState<QuickCaptureResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** 动效播完 / 点了一下 → 关页。closeScreen 兜底无历史栈的情况 */
  const finish = useCallback(() => closeScreen(router), [router]);

  return (
    <Screen
      title="记一件事"
      subtitle="时间可以先空着，之后再安排"
      scroll
      right={
        <Pressable hitSlop={8} onPress={() => closeScreen(router)}>
          <Ionicons name="close" size={24} color={theme.textSecondary} />
        </Pressable>
      }>
      {result ? (
        <CaptureSuccess
          label={`已归入${ROUTE_LABEL[result.route]}`}
          title={result.title}
          hint={result.reminderScheduled ? '到点会提醒你' : undefined}
          onDone={finish}
        />
      ) : (
        <>
          <CaptureInput
            autoFocus
            timePresets={CAPTURE_TIME_PRESETS}
            submitLabel="记下"
            placeholder="比如：周五下午三点开会 / 想做一个只记灵感的 App"
            onSubmit={async (text, options) => {
              setError(null);
              try {
                const captured = await capture({
                  text,
                  markedAsInspiration: options.asIdea,
                  // 输入条快捷按钮（清单/重复/提醒）和 AI 解析结果全部透传，
                  // 落库口径收口在 quickCapture 一处；想法不需要这些，传了也不会用
                  time: options.time,
                  containerId: options.containerId,
                  repeat: options.repeat,
                  reminderMinutesBefore: options.reminderMinutesBefore,
                  parsed: options.parsed,
                });
                setResult(captured);
              } catch (err) {
                setError(err instanceof Error ? err.message : '记录失败');
              }
            }}
          />

          {error ? (
            <Card>
              <ThemedText type="small" themeColor="textSecondary">
                {error}
              </ThemedText>
            </Card>
          ) : null}
        </>
      )}
    </Screen>
  );
}
