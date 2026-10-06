import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { CheckinHeatmap } from '@/components/checkin-heatmap';
import { EmptyState } from '@/components/empty-state';
import { FocusBars } from '@/components/focus-bars';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { buildHeatmap } from '@/domain/checkins';
import type { TaskKind } from '@/domain/enums';
import type { FocusSession } from '@/domain/focus';
import {
  buildReview,
  describeFocusDuration,
  describeRange,
  describeRate,
  describeSummary,
  heatmapWeeks,
  previousRange,
  resolveRange,
  REVIEW_PRESETS,
  type ReviewPreset,
} from '@/domain/review';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';
import { formatMonthDay } from '@/utils/datetime';

/**
 * 回顾（主流程最后一环「回」）。
 *
 * 这个页面的立场：**只报做到了什么，不盘点没做到什么。**
 * 产品的第一目的是"做完事"，而回顾的作用是让人愿意继续做下去 ——
 * 变成绩效面谈的话，用户第二次就不会点进来了。
 * 所以这里没有"逾期 12 件"的红色警告，逾期只作为一个中性数字出现。
 *
 * 另一个约束：不引图表库。一排 flex 均分的柱子就够，
 * 而且天然适配 7 天 / 30 天两种密度，不需要两套代码。
 */

const KIND_LABEL: Record<TaskKind, string> = {
  schedule: '日程型',
  execution: '执行型',
  habit: '习惯型',
  idea: '想法型',
};

const CONTAINER_LIMIT = 4;

export default function ReviewScreen() {
  const router = useRouter();
  const theme = useTheme();

  const tasks = useAppStore((state) => state.tasks);
  const checkins = useAppStore((state) => state.checkins);
  const habits = useAppStore((state) => state.habits);
  const containers = useAppStore((state) => state.containers);
  const loadFocusSessions = useAppStore((state) => state.loadFocusSessions);

  const [preset, setPreset] = useState<ReviewPreset>('week');
  const [sessions, setSessions] = useState<FocusSession[]>([]);

  // range 只在切换预设时重建。若每次渲染都 new Date()，
  // 下面那个 effect 会因为依赖变化而无限重查。
  const range = useMemo(() => resolveRange(preset), [preset]);
  const previous = useMemo(() => previousRange(range), [range]);

  useEffect(() => {
    let alive = true;
    // 一次查到"上一期起点"，环比就不用第二次查库
    void loadFocusSessions(previous.from.toISOString(), range.to.toISOString()).then((rows) => {
      if (alive) setSessions(rows);
    });
    return () => {
      alive = false;
    };
  }, [loadFocusSessions, previous, range]);

  const snapshot = useMemo(
    () => buildReview({ tasks, sessions, checkins, habits, range }),
    [tasks, sessions, checkins, habits, range],
  );

  const containerTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const container of containers) map.set(container.id, container.title);
    return map;
  }, [containers]);

  const summary = useMemo(() => describeSummary(snapshot), [snapshot]);

  const { tasks: taskReview, focus } = snapshot;
  const empty =
    taskReview.planned === 0 && taskReview.completedInRange === 0 && focus.sessions === 0 && snapshot.checkinCount === 0;

  const topContainers = taskReview.byContainer.slice(0, CONTAINER_LIMIT);
  const hiddenContainers = Math.max(0, taskReview.byContainer.length - topContainers.length);

  return (
    <Screen
      title="回顾"
      subtitle={describeRange(range)}
      right={
        <Pressable hitSlop={8} onPress={() => router.back()}>
          <Ionicons name="close" size={24} color={theme.textSecondary} />
        </Pressable>
      }>
      {/* 区间切换：默认本周，最贴近"我最近怎么样"这个真问题 */}
      <View style={styles.chips}>
        {REVIEW_PRESETS.map((option) => {
          const active = option.key === preset;
          return (
            <Pressable
              key={option.key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setPreset(option.key)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? theme.text : theme.background,
                  borderColor: active ? theme.text : theme.backgroundSelected,
                },
              ]}>
              <ThemedText type="small" style={{ color: active ? theme.background : theme.text }}>
                {option.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      {empty ? (
        <EmptyState
          icon="stats-chart-outline"
          title="这段时间还没有东西可回顾"
          hint="记几条任务、专注几次、打个卡，再回来看这里 —— 回顾的值来自有数据，不是来自这个页面"
        />
      ) : null}

      {!empty ? (
        <>
          <Card title={`${range.label}小结`}>
            {summary.map((line, index) => (
              <View key={`${index}-${line}`} style={styles.bulletRow}>
                <View style={[styles.bullet, { backgroundColor: theme.textSecondary }]} />
                <ThemedText type="small" style={styles.bulletText}>
                  {line}
                </ThemedText>
              </View>
            ))}
          </Card>

          {/* 三个大数字：一眼能看到"我这段时间投入了什么" */}
          <Card>
            <View style={styles.statRow}>
              <Stat value={`${taskReview.completedInRange}`} unit="件" label="已完成" />
              <Stat value={describeFocusDuration(focus.totalSeconds)} label="专注时长" />
              <Stat value={`${snapshot.checkinCount}`} unit="次" label="打卡" />
            </View>
          </Card>

          {/* 专注趋势 */}
          <Card
            title="专注趋势"
            hint={
              focus.sessions
                ? `共 ${focus.sessions} 次 · ${focus.activeDays} 天有专注 · 单日最长 ${describeFocusDuration(
                    focus.bestDaySeconds,
                  )}`
                : '这段时间还没有专注记录'
            }>
            <FocusBars days={focus.byDay} />
            <View style={styles.axis}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.axisLabel}>
                {formatMonthDay(range.from)}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.axisLabel}>
                今天
              </ThemedText>
            </View>
          </Card>

          {/* 完成情况 */}
          <Card title="完成情况" hint={describeRate(taskReview.rate)}>
            <MetricRow label="本期安排" value={`${taskReview.planned} 件`} />
            <MetricRow label="本期完成" value={`${taskReview.completedInRange} 件`} />
            <MetricRow
              label="其中提前完成"
              value={`${Math.max(0, taskReview.completedInRange - taskReview.done)} 件`}
            />
            <MetricRow label="已过期未完成" value={`${taskReview.overdue} 件`} muted />

            {taskReview.byKind.length ? (
              <View style={styles.groupBlock}>
                <ThemedText type="small" themeColor="textSecondary">
                  按类型
                </ThemedText>
                {taskReview.byKind.map((row) => (
                  <MetricRow
                    key={row.kind}
                    label={KIND_LABEL[row.kind]}
                    value={`${row.done}/${row.planned}`}
                  />
                ))}
              </View>
            ) : null}

            {topContainers.length ? (
              <View style={styles.groupBlock}>
                <ThemedText type="small" themeColor="textSecondary">
                  按清单 / 目标
                </ThemedText>
                {topContainers.map((row) => (
                  <MetricRow
                    key={row.containerId ?? 'none'}
                    label={
                      row.containerId
                        ? (containerTitles.get(row.containerId) ?? '已删除的容器')
                        : '未归类'
                    }
                    value={`${row.done}/${row.planned}`}
                  />
                ))}
                {hiddenContainers > 0 ? (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
                    还有 {hiddenContainers} 个容器本期有安排，这里只列了最主要的前 {CONTAINER_LIMIT} 个
                  </ThemedText>
                ) : null}
              </View>
            ) : null}
          </Card>

          {/* 习惯：连续天数是全局的，本期只决定"这段时间打了几次" */}
          <Card
            title="习惯"
            hint={snapshot.habits.length ? undefined : '把一条任务设成习惯型，就能在这里看到累积'}
            right={
              snapshot.habits.length ? (
                <Pressable onPress={() => router.push('/habits')}>
                  <ThemedText type="small" themeColor="textSecondary">
                    去打卡
                  </ThemedText>
                </Pressable>
              ) : null
            }>
            {snapshot.habits.length ? (
              snapshot.habits.map((habit) => (
                <View key={habit.taskId} style={styles.habitBlock}>
                  <View style={styles.habitHead}>
                    <ThemedText type="small" numberOfLines={1} style={styles.habitTitle}>
                      {habit.title}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      本期 {habit.inRange} 次 · {Math.round(habit.coverage * 100)}%
                    </ThemedText>
                  </View>
                  <CheckinHeatmap
                    cells={buildHeatmap(habit.dayKeys, range.days)}
                    weeks={heatmapWeeks(range.days)}
                    cellSize={11}
                  />
                  <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
                    {habit.streak.current > 0
                      ? `连续 ${habit.streak.current} 天`
                      : habit.streak.total > 0
                        ? `已中断 · 最长 ${habit.streak.longest} 天`
                        : '还没打过卡'}
                    {` · 累计 ${habit.streak.total} 次 · 最长 ${habit.streak.longest} 天`}
                  </ThemedText>
                </View>
              ))
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                还没有习惯型任务。
              </ThemedText>
            )}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function Stat({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <View style={styles.stat}>
      <View style={styles.statValueRow}>
        <ThemedText type="smallBold" style={styles.statValue}>
          {value}
        </ThemedText>
        {unit ? (
          <ThemedText type="small" themeColor="textSecondary">
            {unit}
          </ThemedText>
        ) : null}
      </View>
      <ThemedText type="small" themeColor="textSecondary" style={styles.statLabel}>
        {label}
      </ThemedText>
    </View>
  );
}

function MetricRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <View style={styles.metricRow}>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.metricLabel}>
        {label}
      </ThemedText>
      <ThemedText type={muted ? 'small' : 'smallBold'} themeColor={muted ? 'textSecondary' : 'text'}>
        {value}
      </ThemedText>
    </View>
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
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  bullet: { width: 4, height: 4, borderRadius: 2, marginTop: 8 },
  bulletText: { flex: 1 },
  statRow: { flexDirection: 'row', alignItems: 'flex-start' },
  stat: { flex: 1, gap: Spacing.half },
  statValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  statValue: { fontSize: 20, lineHeight: 26, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 12, lineHeight: 16 },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  axisLabel: { fontSize: 11, lineHeight: 15 },
  metricRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  metricLabel: { flex: 1 },
  groupBlock: { gap: Spacing.one, marginTop: Spacing.one },
  habitBlock: { gap: Spacing.two, marginTop: Spacing.two },
  habitHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  habitTitle: { flex: 1 },
  footnote: { fontSize: 11, lineHeight: 15, opacity: 0.8 },
});
