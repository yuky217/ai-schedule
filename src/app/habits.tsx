import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { CheckinHeatmap } from '@/components/checkin-heatmap';
import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import {
  buildHeatmap,
  describeStreak,
  hasCheckedInOn,
  summarizeCheckins,
} from '@/domain/checkins';
import { describeProgress } from '@/domain/focus-link';
import { occurrencesInPeriod } from '@/domain/habit-period';
import { CompletionRule } from '@/domain/enums';
import type { Task } from '@/domain/task';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';

/**
 * 习惯打卡。
 *
 * 为什么不占一个 Tab：习惯是"每天/每周去做一次"，不是"今天必须处理的一批事"，
 * 它不该跟任务抢导航位（跟纪念日同理）。首页给一张卡做入口，全部在这里管。
 *
 * 与任务的关系（重要）：
 * - 任务状态回答"这件事还做不做"；
 * - 打卡记录回答"今天做没做"。
 * 所以打卡**不会**把习惯标成完成、不会让它从列表消失 —— 明天它还得出现。
 * 唯一例外是有明确次数目标的频率型习惯（"每周跑 3 次"）：那种情况下
 * "本期做了几次"是从打卡记录**现算**的（`domain/habit-period`），
 * 够数由 state 层在 refresh 前统一对账，新的一周会自动回到待办。
 */
const HEATMAP_DAYS = 70;
const HEATMAP_WEEKS = 10;

export default function HabitsScreen() {
  const router = useRouter();
  const theme = useTheme();

  const habits = useAppStore((state) => state.habits);
  const checkins = useAppStore((state) => state.checkins);
  const checkIn = useAppStore((state) => state.checkIn);
  const undoCheckIn = useAppStore((state) => state.undoCheckIn);
  const [busyId, setBusyId] = useState<string | null>(null);

  /** 每个习惯的打卡日集合，避免在渲染里反复 filter 整份记录 */
  const keysByTask = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const record of checkins) {
      const bucket = map.get(record.taskId) ?? [];
      bucket.push(record.dayKey);
      map.set(record.taskId, bucket);
    }
    return map;
  }, [checkins]);

  const today = new Date();

  const stats = useMemo(
    () =>
      habits.map((habit) => {
        const keys = keysByTask.get(habit.id) ?? [];
        return {
          habit,
          keys,
          streak: summarizeCheckins(keys, today),
          doneToday: hasCheckedInOn(keys, today),
          // 频率型的"本期几次"从打卡记录现算，不读任何计数器（见 domain/habit-period）
          periodCount:
            habit.completion === CompletionRule.Frequency
              ? occurrencesInPeriod(keys, habit.repeat, today)
              : 0,
        };
      }),
    // today 每次渲染都是新对象，用日期字符串代替依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [habits, keysByTask, today.toDateString()],
  );

  const doneCount = stats.filter((s) => s.doneToday).length;

  const toggle = async (habit: Task, doneToday: boolean) => {
    setBusyId(habit.id);
    try {
      if (doneToday) await undoCheckIn(habit.id);
      else await checkIn(habit.id);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Screen
      title="习惯"
      subtitle={
        habits.length ? `今天已打卡 ${doneCount}/${habits.length}` : '一次一次累积出来的东西'
      }
      right={
        <Pressable hitSlop={8} onPress={() => router.back()}>
          <Ionicons name="close" size={24} color={theme.textSecondary} />
        </Pressable>
      }>
      {!habits.length ? (
        <EmptyState
          icon="repeat-outline"
          title="还没有习惯"
          hint="在首页记一条，把类型设成习惯型（比如「每天早上跑步 30 分钟」），它就会出现在这里"
        />
      ) : null}

      {stats.map(({ habit, keys, streak, doneToday, periodCount }) => (
        <Card key={habit.id}>
          <View style={styles.head}>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/task/${habit.id}`)}
              style={styles.headText}>
              <ThemedText type="smallBold" numberOfLines={1}>
                {habit.title}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {describeStreak(streak)}
                {streak.longest > 0 ? ` · 最长 ${streak.longest} 天` : ''}
                {` · 共 ${streak.total} 次`}
              </ThemedText>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ checked: doneToday }}
              accessibilityLabel={doneToday ? '撤销今天的打卡' : '今天打卡'}
              disabled={busyId === habit.id}
              onPress={() => void toggle(habit, doneToday)}
              style={[
                styles.checkButton,
                {
                  backgroundColor: doneToday ? theme.text : 'transparent',
                  borderColor: doneToday ? theme.text : theme.textSecondary,
                  opacity: busyId === habit.id ? 0.5 : 1,
                },
              ]}>
              <Ionicons
                name={doneToday ? 'checkmark' : 'add'}
                size={16}
                color={doneToday ? theme.background : theme.textSecondary}
              />
              <ThemedText
                type="small"
                style={{ color: doneToday ? theme.background : theme.textSecondary }}>
                {doneToday ? '今天已打卡' : '今天打卡'}
              </ThemedText>
            </Pressable>
          </View>

          {describeProgress(habit, periodCount) ? (
            <ThemedText type="small" themeColor="textSecondary">
              {describeProgress(habit, periodCount)}
            </ThemedText>
          ) : null}

          <CheckinHeatmap
            cells={buildHeatmap(keys, HEATMAP_DAYS, today)}
            weeks={HEATMAP_WEEKS}
          />

          <ThemedText type="small" themeColor="textSecondary" style={styles.legend}>
            最近 {HEATMAP_DAYS} 天，深色 = 打过卡
          </ThemedText>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  headText: { flex: 1, gap: 2 },
  checkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two,
    borderWidth: 1.2,
  },
  legend: { fontSize: 11, lineHeight: 15, opacity: 0.8 },
});
