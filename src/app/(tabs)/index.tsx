import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { CaptureInput } from '@/components/capture-input';
import { EmptyState } from '@/components/empty-state';
import { GrowthOrb } from '@/components/growth-orb';
import { Screen } from '@/components/screen';
import { TaskRow } from '@/components/task-row';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { hasCheckedInOn, summarizeCheckins } from '@/domain/checkins';
import { containerStats, CONTAINER_KIND_LABEL } from '@/domain/container-stats';
import { listFocusCandidates } from '@/domain/focus-candidate';
import { describeMark, pickUpcoming, sortMarkViews } from '@/domain/marks';
import type { CaptureRoute } from '@/domain/routing';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';
import { formatDateLong } from '@/utils/datetime';

/**
 * 首页 = 入口层（主文档 3.1）。
 *
 * 这一版把"重心"从列表挪到了专注，但**不是**把一个空计时器摆在门口：
 *   1. 记录 —— 一个输入框，别的什么都不问
 *   2. 专注 —— **一个提案**（一件事 + 一句"为什么是它"）+ 一个动作。
 *      提案的规则全在 domain/focus-candidate.ts，页面只负责显示。
 *      不认同就「换一件」，一直换到底也可以「不选，直接开始」。
 *   3. 清单和慢事 —— 今天那几件按需展开，纪念日/习惯/项目/待规划收在一行折叠里。
 *
 * 立场：**首页要能回答"现在做哪件"，而不是把全部家当摆出来**。
 * 深度功能（完整列表、容器、回顾）都在门后，一两次点击就到。
 */

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

  /** 提案队列：换一件就是往后走一格 */
  const candidates = useMemo(() => listFocusCandidates({ today, inbox }), [today, inbox]);
  const [skip, setSkip] = useState(0);
  const current = candidates.length ? candidates[skip % candidates.length]! : null;

  /** 慢事收在一行里，展开才看；折叠不代表消失，数量一直摆在明面上 */
  const [expanded, setExpanded] = useState(false);

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

  /** 折叠那一行显示的计数 —— 不用展开也知道家里有多少东西 */
  const otherSummary = useMemo(() => {
    const parts: string[] = [];
    if (marks.length) parts.push(`纪念日 ${marks.length}`);
    if (habits.length) parts.push(`习惯 ${habitDoneToday}/${habits.length}`);
    if (activeContainers.length) parts.push(`在推进 ${activeContainers.length}`);
    if (inbox.length) parts.push(`待规划 ${inbox.length}`);
    return parts;
  }, [marks.length, habits.length, habitDoneToday, activeContainers.length, inbox.length]);

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

  const startFocus = () => {
    if (current) router.push({ pathname: '/focus', params: { taskId: current.task.id } });
    else router.push('/focus');
  };

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

      {/* 专注启动：不给选择负担 —— 提案一件事，认同就开始，不认同就换 */}
      <Card>
        <View style={styles.focusRow}>
          <GrowthOrb seconds={growthSeconds} size={76} />
          <View style={styles.focusText}>
            <ThemedText type="small" themeColor="textSecondary">
              {current ? current.reason : '现在没有安排'}
            </ThemedText>
            <ThemedText type="smallBold" numberOfLines={2} style={styles.focusTitle}>
              {current ? current.task.title : '先开一轮专注，做完再命名也行'}
            </ThemedText>
          </View>
        </View>

        <View style={styles.focusActions}>
          <Pressable
            accessibilityRole="button"
            onPress={startFocus}
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: theme.text, opacity: pressed ? 0.8 : 1 },
            ]}>
            <ThemedText type="smallBold" style={{ color: theme.background }}>
              {current ? '开始' : '开始专注'}
            </ThemedText>
          </Pressable>

          {current ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setSkip((value) => value + 1)}
              style={({ pressed }) => [
                styles.ghostButton,
                { borderColor: theme.backgroundSelected, opacity: pressed ? 0.6 : 1 },
              ]}>
              <ThemedText type="small" themeColor="textSecondary">
                换一件
              </ThemedText>
            </Pressable>
          ) : null}
        </View>

        {current ? (
          <Pressable accessibilityRole="button" onPress={() => router.push('/focus')}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.linkText}>
              都不是？不选任务，直接开始
            </ThemedText>
          </Pressable>
        ) : null}
      </Card>

      {/* 今天：只有这一处是列表，而且它排在专注后面 */}
      <Card
        title="今天"
        hint={today.length ? `共 ${today.length} 件` : undefined}
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

      {/* 慢事：折叠在一行里，点一下才展开 —— 默认极简，按需展开 */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? '收起其他内容' : '展开其他内容'}
        onPress={() => setExpanded((value) => !value)}
        style={styles.moreRow}>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.moreText}>
          {otherSummary.length ? `还有 ${otherSummary.join(' · ')}` : '纪念日、习惯、项目与待规划'}
        </ThemedText>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={theme.textSecondary}
        />
      </Pressable>

      {expanded ? (
        <>
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
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  feedback: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  focusRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  focusText: { flex: 1, gap: Spacing.one },
  focusTitle: { fontSize: 16, lineHeight: 22 },
  focusActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.one },
  primaryButton: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  ghostButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
  linkText: { textDecorationLine: 'underline' },
  moreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  moreText: { flex: 1 },
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
