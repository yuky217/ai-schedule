import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { CaptureInput } from '@/components/capture-input';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { TimeAttribute } from '@/domain/enums';
import type { CaptureRoute } from '@/domain/routing';
import type { TaskTime } from '@/domain/task';
import type { QuickCaptureResult } from '@/entry/quick-capture';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';
import { atTimeOn } from '@/utils/datetime';

/**
 * 快速记录（模态）。
 *
 * 这是"入口层"里信息量最大的一个入口：多加了一排时间快捷选项。
 * 但注意它仍然不问"这件事属于哪个项目"——那是收集箱和后面的流程该干的事。
 */

interface TimePreset {
  key: string;
  label: string;
  build: () => TaskTime | null;
}

const TIME_PRESETS: readonly TimePreset[] = [
  { key: 'none', label: '不定时间', build: () => null },
  {
    key: 'today-evening',
    label: '今天 18:00',
    build: () => ({
      attribute: TimeAttribute.Fixed,
      startAt: atTimeOn(0, 18),
      endAt: atTimeOn(0, 19),
    }),
  },
  {
    key: 'tomorrow-morning',
    label: '明天 09:00',
    build: () => ({
      attribute: TimeAttribute.Fixed,
      startAt: atTimeOn(1, 9),
      endAt: atTimeOn(1, 10),
    }),
  },
  {
    key: 'tomorrow-due',
    label: '明天 18:00 截止',
    build: () => ({ attribute: TimeAttribute.Deadline, dueAt: atTimeOn(1, 18) }),
  },
];

const ROUTE_LABEL: Record<CaptureRoute, string> = {
  idea: '想法库',
  inbox: '收集箱',
  calendar: '日历',
};

export default function CaptureScreen() {
  const router = useRouter();
  const theme = useTheme();
  const capture = useAppStore((state) => state.capture);

  const [presetKey, setPresetKey] = useState<string>('none');
  const [result, setResult] = useState<QuickCaptureResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activePreset = TIME_PRESETS.find((p) => p.key === presetKey) ?? TIME_PRESETS[0];

  return (
    <Screen
      title="记一件事"
      subtitle="时间可以先空着，之后再安排"
      scroll
      right={
        <Pressable hitSlop={8} onPress={() => router.back()}>
          <Ionicons name="close" size={24} color={theme.textSecondary} />
        </Pressable>
      }>
      {result ? (
        <Card title={`已归入${ROUTE_LABEL[result.route]}`} hint={result.reason}>
          <ThemedText>{result.title}</ThemedText>
          {result.reminderScheduled ? (
            <View style={styles.tipRow}>
              <Ionicons name="notifications-outline" size={14} color={theme.textSecondary} />
              <ThemedText type="small" themeColor="textSecondary">
                到点会提醒你
              </ThemedText>
            </View>
          ) : null}
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: theme.text, opacity: pressed ? 0.8 : 1 },
            ]}>
            <ThemedText type="smallBold" style={{ color: theme.background }}>
              好
            </ThemedText>
          </Pressable>
        </Card>
      ) : (
        <>
          <CaptureInput
            autoFocus
            submitLabel="记下"
            placeholder="比如：周五下午三点开会 / 想做一个只记灵感的 App"
            onSubmit={async (text, options) => {
              setError(null);
              try {
                const captured = await capture({
                  text,
                  markedAsInspiration: options.asIdea,
                  time: options.asIdea ? null : activePreset.build(),
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

          <Card title="什么时候" hint="选了时间就会自动落到日历并提醒">
            <View style={styles.chips}>
              {TIME_PRESETS.map((preset) => {
                const active = preset.key === presetKey;
                return (
                  <Pressable
                    key={preset.key}
                    onPress={() => setPresetKey(preset.key)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active ? theme.text : theme.background,
                        borderColor: active ? theme.text : theme.backgroundSelected,
                      },
                    ]}>
                    <ThemedText
                      type="small"
                      style={{ color: active ? theme.background : theme.text }}>
                      {preset.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  primaryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    marginTop: Spacing.one,
  },
});
