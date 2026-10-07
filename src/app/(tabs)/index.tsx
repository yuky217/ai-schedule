import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { CaptureInput } from '@/components/capture-input';
import { EmptyState } from '@/components/empty-state';
import { FocusPicker, type FocusPickerOption } from '@/components/focus-picker';
import { GrowthOrb } from '@/components/growth-orb';
import { NextCourseCard } from '@/components/next-course-card';
import { Screen } from '@/components/screen';
import { TaskRow } from '@/components/task-row';
import { ThemedText } from '@/components/themed-text';
import { ChoiceSheet, type ChoiceOption } from '@/components/choice-sheet';
import { Spacing } from '@/constants/theme';
import { hasCheckedInOn, summarizeCheckins } from '@/domain/checkins';
import { containerStats, CONTAINER_KIND_LABEL } from '@/domain/container-stats';
import { TaskStatus } from '@/domain/enums';
import {
  defaultFocusIndex,
  FOCUS_PICKER_LIMIT,
  listFocusCandidates,
} from '@/domain/focus-candidate';
import { describeMark, pickUpcoming, sortMarkViews } from '@/domain/marks';
import type { CaptureRoute } from '@/domain/routing';
import { taskAnchor, type Task } from '@/domain/task';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';
import { formatDateLong, formatDayTime } from '@/utils/datetime';

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
  const lastFocus = useAppStore((state) => state.lastFocus);
  const clearFocusFeedback = useAppStore((state) => state.clearFocusFeedback);
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

  /**
   * 专注选择器的候选：今天要面对的那几件。
   *
   * 刻意**只取 today，不掺收集箱** —— 收集箱是"还没安排好"的池子，
   * 把它铺进滑动区，用户就得在这儿先做一次筛选；那正是「＋」那一格该干的事。
   */
  const choices = useMemo(
    () => listFocusCandidates({ today, inbox: [] }).slice(0, FOCUS_PICKER_LIMIT),
    [today],
  );

  const [pickerIndex, setPickerIndex] = useState(0);
  const [newTitle, setNewTitle] = useState('');
  /** 从「全部」里挑出来的那件：插在「写一件新的事」后面，紧挨着默认位置 */
  const [extraTask, setExtraTask] = useState<Task | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  /** 用户一旦自己动过指针，就别再用默认项覆盖他的选择 */
  const pickedRef = useRef(false);

  const options = useMemo<FocusPickerOption[]>(() => {
    const list: FocusPickerOption[] = [{ kind: 'new', key: 'new' }];
    if (extraTask) {
      list.push({ kind: 'task', key: extraTask.id, task: extraTask, reason: '你刚挑的这件' });
    }
    for (const candidate of choices) {
      // 刚挑中的那件本来就可能已经在今天的列表里，跳过以免出现两格一样的
      if (extraTask && candidate.task.id === extraTask.id) continue;
      list.push({
        kind: 'task',
        key: candidate.task.id,
        task: candidate.task,
        reason: candidate.reason,
      });
    }
    list.push({ kind: 'more', key: 'more' });
    return list;
  }, [choices, extraTask]);

  /**
   * 默认停在「时间表上正好有安排的那件」→「标了进行中的那件」→「写一件新的事」。
   * 规则在 domain/focus-candidate，覆盖不到时给空白输入框 —— 宁可让用户自己说，
   * 也不要"随便挑一件"当默认（那种默认解释不了自己）。
   */
  useEffect(() => {
    if (pickedRef.current) return;
    const preferred = defaultFocusIndex(choices);
    setPickerIndex(preferred === null ? 0 : preferred + 1);
  }, [choices]);

  // 挑中的那件被删了或已经做完 —— 指针别继续停在一个不存在的东西上
  useEffect(() => {
    if (!extraTask) return;
    const fresh = tasks.find((item) => item.id === extraTask.id);
    if (!fresh || fresh.status === TaskStatus.Done) setExtraTask(null);
  }, [tasks, extraTask]);

  const selected = options[pickerIndex] ?? options[0];

  /** 「＋」弹出的那份清单：所有还没做完的顶层任务（收集箱 + 已排时间的） */
  const allOptions = useMemo<ChoiceOption[]>(
    () =>
      tasks
        .filter((task) => task.status !== TaskStatus.Done)
        .map((task) => {
          const anchor = taskAnchor(task);
          return {
            key: task.id,
            label: task.title,
            hint: anchor ? formatDayTime(anchor) : '待规划',
          };
        }),
    [tasks],
  );

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

  const handleIndexChange = (next: number) => {
    pickedRef.current = true;
    setPickerIndex(next);
    // 停在「＋」上就把清单弹出来 —— 用户滑到那儿的意思本来就是"这儿没有，给我看全部"
    if (options[next]?.kind === 'more') setAllOpen(true);
  };

  const pickFromAll = (taskId: string) => {
    setAllOpen(false);
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    pickedRef.current = true;
    setExtraTask(task);
    // extraTask 固定插在「写一件新的事」后面，所以永远是这一格
    setPickerIndex(1);
  };

  const start = async () => {
    if (!selected || starting) return;
    if (selected.kind === 'more') {
      setAllOpen(true);
      return;
    }
    if (selected.kind === 'task') {
      router.push({ pathname: '/focus', params: { taskId: selected.task.id } });
      return;
    }
    const title = newTitle.trim();
    if (!title) return;
    setStarting(true);
    try {
      // 先落一条再进专注：带上 id，结束时时长和时段才写得回它身上，它才会出现在日历里
      const result = await capture({ text: title });
      setNewTitle('');
      router.push({ pathname: '/focus', params: { taskId: result.id } });
    } finally {
      setStarting(false);
    }
  };

  const startLabel =
    selected?.kind === 'more' ? '打开全部' : selected?.kind === 'task' ? '开始' : '记下并开始';
  const canStart =
    selected?.kind === 'task'
      ? true
      : selected?.kind === 'new'
        ? newTitle.trim().length > 0
        : true;
  const pickerHint = choices.length
    ? '现在做哪件？左右滑挑一个，停在哪件就是哪件'
    : '今天还没有安排 —— 写一件新的，或者先干着、结束再命名';

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

      {/*
        下一节课：跟"我想做什么"是两回事 —— 课是别人定好的时间，
        它一动，今天剩下的时间怎么排全得跟着改。所以摆在最上面。
        没有课表、或者下一节还远（后天之后）就整块不渲染。
      */}
      <NextCourseCard onPress={(courseId) => router.push(`/course/${courseId}`)} />

      {/*
        刚结束的那段专注：一行字说清"这一下到底干了什么"，并指到它落的地方。
        专注结束的副作用可能落在任务 / 日历 / 打卡表任意一处，
        以前只有进任务详情页才看得到 —— 而从首页进来的这条路径根本不经过那里，
        于是用户按完"结束"只看到一个计时器消失，剩下全靠猜。
      */}
      {lastFocus ? (
        <Card
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: theme.backgroundSelected }}>
          <View style={styles.focusReceipt}>
            <Ionicons name="timer-outline" size={18} color={theme.text} />
            <ThemedText type="small" style={styles.focusReceiptText}>
              {lastFocus.message}
            </ThemedText>
          </View>
          <View style={styles.focusReceiptActions}>
            {lastFocus.taskId ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  const id = lastFocus.taskId;
                  // 点进去就把它收起来：详情页会把同一句话再显示一遍，看着像没走
                  clearFocusFeedback();
                  if (id) router.push(`/task/${id}`);
                }}
                style={({ pressed }) => [
                  styles.ghostButton,
                  { borderColor: theme.backgroundSelected, opacity: pressed ? 0.6 : 1 },
                ]}>
                <ThemedText type="small" themeColor="textSecondary">
                  看看这件
                </ThemedText>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={clearFocusFeedback}
              style={({ pressed }) => [
                styles.ghostButton,
                { borderColor: theme.backgroundSelected, opacity: pressed ? 0.6 : 1 },
              ]}>
              <ThemedText type="small" themeColor="textSecondary">
                知道了
              </ThemedText>
            </Pressable>
          </View>
        </Card>
      ) : null}

      {/* 专注启动：指针固定、左右滑选 —— 不用瞄准，停在哪件就是哪件 */}
      <Card>
        <View style={styles.focusHead}>
          <GrowthOrb seconds={growthSeconds} size={56} />
          <ThemedText type="small" themeColor="textSecondary" style={styles.focusHint}>
            {pickerHint}
          </ThemedText>
        </View>

        <FocusPicker
          options={options}
          index={pickerIndex}
          onIndexChange={handleIndexChange}
          newTitle={newTitle}
          onNewTitleChange={setNewTitle}
        />

        <View style={styles.focusActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canStart }}
            disabled={!canStart || starting}
            onPress={() => void start()}
            style={({ pressed }) => [
              styles.primaryButton,
              {
                backgroundColor: canStart ? theme.text : theme.backgroundSelected,
                opacity: pressed || starting ? 0.8 : 1,
              },
            ]}>
            <ThemedText
              type="smallBold"
              style={{ color: canStart ? theme.background : theme.textSecondary }}>
              {starting ? '准备中…' : startLabel}
            </ThemedText>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/focus')}
            style={({ pressed }) => [
              styles.ghostButton,
              { borderColor: theme.backgroundSelected, opacity: pressed ? 0.6 : 1 },
            ]}>
            <ThemedText type="small" themeColor="textSecondary">
              先干着，结束再命名
            </ThemedText>
          </Pressable>
        </View>
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

      {/* 「＋」那一格的去向：全部还没做完的事，挑一件就把它摆到指针下面 */}
      <ChoiceSheet
        visible={allOpen}
        title="挑一件现在做的"
        options={allOptions}
        onSelect={pickFromAll}
        onClose={() => setAllOpen(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  feedback: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  focusReceipt: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  focusReceiptText: { flex: 1, lineHeight: 19 },
  focusReceiptActions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  focusHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  focusHint: { flex: 1, fontSize: 12, lineHeight: 17 },
  focusActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
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
