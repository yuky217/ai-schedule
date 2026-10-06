import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { CaptureInput } from '@/components/capture-input';
import { EmptyState } from '@/components/empty-state';
import { GrowthOrb } from '@/components/growth-orb';
import { Screen } from '@/components/screen';
import { TaskRow } from '@/components/task-row';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { containerStats, CONTAINER_KIND_LABEL } from '@/domain/container-stats';
import { hasCheckedInOn, summarizeCheckins } from '@/domain/checkins';
import { describeMark, pickUpcoming, sortMarkViews } from '@/domain/marks';
import type { CaptureRoute } from '@/domain/routing';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';
import { formatDateLong } from '@/utils/datetime';

/** 记完之后给一句明确反馈，用户才知道东西到底去哪了 */
const ROUTE_FEEDBACK: Record<CaptureRoute, string> = {
  idea: '已放进想法库，不提醒',
  inbox: '已放进收集箱，等你安排时间',
  calendar: '已落到日历，到点提醒你',
};

const PREVIEW_LIMIT = 5;

export default function HomeScreen() {
  const router = useRouter();
  const theme = useTheme();

  const today = useAppStore((state) => state.today);
  const inbox = useAppStore((state) => state.inbox);
  const growthSeconds = useAppStore((state) => state.growthSeconds);
  const lastCapture = useAppStore((state) => state.lastCapture);
  const ready = useAppStore((state) => state.ready);
  const error = useAppStore((state) => state.error);
  const capture = useAppStore((state) => state.capture);
  const completeTask = useAppStore((state) => state.completeTask);
  const marks = useAppStore((state) => state.marks);
  const containers = useAppStore((state) => state.containers);
  const tasks = useAppStore((state) => state.tasks);
  const habits = useAppStore((state) => state.habits);
  const checkins = useAppStore((state) => state.checkins);
  const checkIn = useAppStore((state) => state.checkIn);
  const undoCheckIn = useAppStore((state) => state.undoCheckIn);

  /** 习惯的打卡日：按任务分组，供首页那几条算连续天数 */
  const checkinKeys = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const record of checkins) {
      const bucket = map.get(record.taskId) ?? [];
      bucket.push(record.dayKey);
      map.set(record.taskId, bucket);
    }
    return map;
  }, [checkins]);

  const habitDoneToday = useMemo(
    () => habits.filter((habit) => hasCheckedInOn(checkinKeys.get(habit.id) ?? [], new Date())).length,
    [habits, checkinKeys],
  );

  /** 纪念日：只挑几个最近要发生的，不占首页主角 */
  const upcomingMarks = useMemo(
    () => pickUpcoming(sortMarkViews(marks.map((mark) => describeMark(mark))), 3),
    [marks],
  );

  /** 在推进的容器：首页给一个"别忘了这些事"的入口 */
  const activeContainers = useMemo(
    () => containers.filter((container) => container.status === 'active').slice(0, 3),
    [containers],
  );

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 6) return '还没睡';
    if (hour < 11) return '早上好';
    if (hour < 14) return '中午好';
    if (hour < 18) return '下午好';
    return '晚上好';
  }, []);

  const visibleToday = today.slice(0, PREVIEW_LIMIT);
  const hiddenCount = Math.max(0, today.length - visibleToday.length);

  return (
    <Screen
      title={greeting}
      subtitle={formatDateLong()}
      right={
        <View style={styles.headerActions}>
          <Pressable
            hitSlop={8}
            accessibilityLabel="回顾"
            onPress={() => router.push('/review')}>
            <Ionicons name="stats-chart-outline" size={21} color={theme.textSecondary} />
          </Pressable>
          <Pressable hitSlop={8} onPress={() => router.push('/settings')}>
            <Ionicons name="settings-outline" size={22} color={theme.textSecondary} />
          </Pressable>
        </View>
      }>
      {error ? (
        <Card title="本地数据库没起来">
          <ThemedText type="small" themeColor="textSecondary">
            {error}
          </ThemedText>
        </Card>
      ) : null}

      {/* 入口层：记录只需要一个输入框；下面那排快捷按钮是可选的 */}
      <CaptureInput
        containers={containers}
        onSubmit={async (text, options) => {
          await capture({
            text,
            markedAsInspiration: options.asIdea,
            time: options.time,
            containerId: options.containerId,
            repeat: options.repeat,
            reminderMinutesBefore: options.reminderMinutesBefore,
          });
        }}
      />

      {lastCapture ? (
        <View style={styles.feedback}>
          <Ionicons name="arrow-forward-circle-outline" size={14} color={theme.textSecondary} />
          <ThemedText type="small" themeColor="textSecondary">
            「{lastCapture.title}」{ROUTE_FEEDBACK[lastCapture.route]}
            {lastCapture.reminderScheduled ? '（提醒已设好）' : ''}
          </ThemedText>
        </View>
      ) : null}

      {/* 专注启动：主角是时间，旁边那个小东西只涨不落 */}
      <Card>
        <View style={styles.focusRow}>
          <GrowthOrb seconds={growthSeconds} size={88} />
          <View style={styles.focusText}>
            <ThemedText type="smallBold">开始专注</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              挑一件事，点进去，剩下的交给时间
            </ThemedText>
            <Pressable
              onPress={() => router.push('/focus')}
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: theme.text, opacity: pressed ? 0.8 : 1 },
              ]}>
              <ThemedText type="smallBold" style={{ color: theme.background }}>
                进入专注
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </Card>

      {/* 今天 */}
      <Card
        title="今天"
        hint={today.length ? `共 ${today.length} 件，先做最上面那件` : undefined}
        right={
          today.length > PREVIEW_LIMIT ? (
            <ThemedText type="small" themeColor="textSecondary">
              +{hiddenCount}
            </ThemedText>
          ) : null
        }>
        {visibleToday.length ? (
          visibleToday.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onComplete={(t) => void completeTask(t.id)}
              onPress={(t) => router.push(`/task/${t.id}`)}
            />
          ))
        ) : (
          <EmptyState
            icon="sunny-outline"
            title={ready ? '今天还没有安排' : '正在读取本地数据…'}
            hint="现在没有必须要做的事，也是一种好消息"
          />
        )}
      </Card>

      {/* 纪念日：不提醒、不催办，只是把日子摆在你眼前 */}
      <Card
        title="纪念日"
        hint={upcomingMarks.length ? undefined : '记一个还剩几天的日子'}
        right={
          <Pressable onPress={() => router.push('/marks')}>
            <ThemedText type="small" themeColor="textSecondary">
              {marks.length ? '全部' : '去添加'}
            </ThemedText>
          </Pressable>
        }>
        {upcomingMarks.length ? (
          upcomingMarks.map((view) => (
            <Pressable
              key={view.mark.id}
              accessibilityRole="button"
              onPress={() => router.push('/marks')}
              style={styles.markRow}>
              <View style={styles.markNumberBlock}>
                <ThemedText type="smallBold" style={styles.markNumber}>
                  {view.headline}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.markCaption}>
                  {view.caption}
                </ThemedText>
              </View>
              <ThemedText type="small" numberOfLines={1} style={styles.markTitle}>
                {view.mark.title}
              </ThemedText>
            </Pressable>
          ))
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            还没有纪念日。生日、考试、在一起多久，都可以记一个。
          </ThemedText>
        )}
      </Card>

      {/* 习惯：日常里累积的那部分，不占 Tab，首页给一张卡 */}
      {habits.length ? (
        <Card
          title="习惯"
          hint={`今天已打卡 ${habitDoneToday}/${habits.length}`}
          right={
            <Pressable onPress={() => router.push('/habits')}>
              <ThemedText type="small" themeColor="textSecondary">
                全部
              </ThemedText>
            </Pressable>
          }>
          {habits.slice(0, 3).map((habit) => {
            const keys = checkinKeys.get(habit.id) ?? [];
            const streak = summarizeCheckins(keys);
            const done = hasCheckedInOn(keys, new Date());
            return (
              <Pressable
                key={habit.id}
                accessibilityRole="button"
                onPress={() => void (done ? undoCheckIn(habit.id) : checkIn(habit.id))}
                style={styles.habitRow}>
                <View
                  style={[
                    styles.habitCheck,
                    {
                      borderColor: done ? theme.text : theme.textSecondary,
                      backgroundColor: done ? theme.text : 'transparent',
                    },
                  ]}>
                  {done ? (
                    <Ionicons name="checkmark" size={12} color={theme.background} />
                  ) : null}
                </View>
                <ThemedText type="small" numberOfLines={1} style={styles.projectTitle}>
                  {habit.title}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {streak.current ? `连续 ${streak.current} 天` : '还没开始'}
                </ThemedText>
              </Pressable>
            );
          })}
        </Card>
      ) : null}

      {/* 在推进的项目 / 目标：看一眼进度，别让它悄悄烂尾 */}
      {activeContainers.length ? (
        <Card
          title="在推进"
          hint="目标和项目的进度"
          right={
            <Pressable onPress={() => router.push('/projects')}>
              <ThemedText type="small" themeColor="textSecondary">
                全部
              </ThemedText>
            </Pressable>
          }>
          {activeContainers.map((container) => {
            const stats = containerStats(tasks.filter((task) => task.containerId === container.id));
            return (
              <Pressable
                key={container.id}
                accessibilityRole="button"
                onPress={() => router.push(`/container/${container.id}`)}
                style={styles.projectRow}>
                <ThemedText type="small" numberOfLines={1} style={styles.projectTitle}>
                  {container.title}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {CONTAINER_KIND_LABEL[container.kind]}
                  {stats.total ? ` · ${stats.done}/${stats.total}` : ''}
                </ThemedText>
              </Pressable>
            );
          })}
        </Card>
      ) : null}

      {/* 收集中但还没安排的事，提醒用户去消化 */}
      <Card
        title="待规划"
        hint={inbox.length ? `收集箱里还躺着 ${inbox.length} 件` : undefined}>
        {inbox.length ? (
          <Pressable onPress={() => router.push('/inbox')} style={styles.linkRow}>
            <ThemedText type="small" themeColor="textSecondary">
              去收集箱给它们定个时间
            </ThemedText>
            <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
          </Pressable>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            收集箱是空的，很干净
          </ThemedText>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  feedback: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  focusRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four },
  focusText: { flex: 1, gap: Spacing.two },
  primaryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    marginTop: Spacing.one,
  },
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  markRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  markNumberBlock: { flexDirection: 'row', alignItems: 'baseline', gap: 3, minWidth: 62 },
  markNumber: { fontSize: 16, lineHeight: 20, fontVariant: ['tabular-nums'] },
  markCaption: { fontSize: 11, lineHeight: 14 },
  markTitle: { flex: 1 },
  projectRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  projectTitle: { flex: 1 },
  habitRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  habitCheck: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
