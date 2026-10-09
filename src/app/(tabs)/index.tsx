import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Fab, FAB_SIZE } from '@/components/fab';
import { FocusPicker, type FocusPickerOption } from '@/components/focus-picker';
import { GrowthOrb } from '@/components/growth-orb';
import { NextCourseCard } from '@/components/next-course-card';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ChoiceSheet, type ChoiceOption } from '@/components/choice-sheet';
import { Spacing } from '@/constants/theme';
import { hasCheckedInOn, summarizeCheckins } from '@/domain/checkins';
import { TaskStatus } from '@/domain/enums';
import {
  defaultFocusIndex,
  FOCUS_PICKER_LIMIT,
  listFocusCandidates,
} from '@/domain/focus-candidate';
import type { CaptureRoute } from '@/domain/routing';
import { taskAnchor, type Task } from '@/domain/task';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';
import { formatDateLong, formatDayTime } from '@/utils/datetime';

/**
 * 首页 = 入口层（主文档 3.1）。
 *
 * 这一版把"重心"从列表挪到了专注，但**不是**把一个空计时器摆在门口：
 *   1. 记录 —— 一颗悬浮的「＋」，点开才问（常驻输入框太占地方，见 components/fab.tsx）
 *   2. 专注 —— **一个提案**（一件事 + 一句"为什么是它"）+ 一个动作。
 *      提案的规则全在 domain/focus-candidate.ts，页面只负责显示。
 *      挑的规则是"停在哪件就是哪件"，确认只有一个键。
 *   3. 慢事 —— 习惯卡常驻底部，不折叠（折叠等于多一次点击）。
 *      纪念日不在这里：它是"一个日子"而不是"一件事"，家在日历页。
 *
 * 立场：**首页要能回答"现在做哪件"，而不是把全部家当摆出来**。
 * 今天那几件不在这儿铺成列表 —— 专注选择器左右滑就是它们，
 * 完整的列表在日历和收集箱里，一两次点击就到。
 */

/** 记完之后给一句明确反馈，用户才知道东西到底去哪了 */
const ROUTE_FEEDBACK: Record<CaptureRoute, string> = {
  idea: '已放进想法库，不提醒',
  inbox: '已放进收集箱，等你安排时间',
  calendar: '已落到日历',
};

export default function HomeScreen() {
  const router = useRouter();
  const theme = useTheme();

  const today = useAppStore((state) => state.today);
  const growthSeconds = useAppStore((state) => state.growthSeconds);
  const lastCapture = useAppStore((state) => state.lastCapture);
  const lastFocus = useAppStore((state) => state.lastFocus);
  const clearFocusFeedback = useAppStore((state) => state.clearFocusFeedback);
  const error = useAppStore((state) => state.error);
  const capture = useAppStore((state) => state.capture);
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
  /** 从「全部」里挑出来的那件：插在「新建」后面，紧挨着默认位置 */
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
   * 默认停在「时间表上正好有安排的那件」→「标了进行中的那件」→「新建」。
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

  /**
   * 问候语按当前时刻现算，不进 useMemo —— 页面挂着跨过午夜 / 久挂后台回来时，
   * "早上好"要能自己变成"晚上好"。取小时数是零成本，不值得为它缓存。
   */
  const hour = new Date().getHours();
  const greeting =
    hour < 6 ? '还没睡' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';

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
    // extraTask 固定插在「新建」后面，所以永远是这一格
    setPickerIndex(1);
  };

  /**
   * 首页只有这一个动作键 —— 它对谁做事，由指针停在哪一格决定。
   *
   * 以前这里是两个键：「开始」和「先干着，结束再命名」。但"不命名就开干"
   * 本来就被「新建」那一格（标题留空）表达过了 —— 同一个意思说两遍，
   * 还逼用户按之前先判断一次"我该按哪个"。合成一个，判断交给位置。
   */
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
    // 名字留空就直接开始：专注页会在结束时请用户命名，那一刻他才真的知道自己在做什么
    if (!title) {
      router.push('/focus');
      return;
    }
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
    selected?.kind === 'more'
      ? '从全部里挑'
      : selected?.kind === 'task'
        ? '开始专注'
        : newTitle.trim()
          ? '记下并开始'
          : '开始';

  return (
    <Screen
      title={greeting}
      subtitle={formatDateLong()}
      // 结尾那颗「＋」是浮起来的，滚到底会压住最后一行 —— 给它留出自己的高度
      contentStyle={styles.homeContent}
      floating={
        <Fab onPress={() => router.push('/capture')} accessibilityLabel="记一件事" />
      }
      right={
        <View style={styles.headerActions}>
          <Pressable
            hitSlop={12}
            accessibilityLabel="回顾"
            onPress={() => router.push('/review')}>
            <Ionicons name="stats-chart-outline" size={21} color={theme.textSecondary} />
          </Pressable>
          <Pressable hitSlop={12} onPress={() => router.push('/settings')}>
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

      {/*
        记录已经不占首页的地方了：右下角那颗「＋」点开就是记录页
        （带时间快捷选项的那个）。首页第一屏留给"现在做什么"。
      */}
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

      {/*
        专注启动：指针固定、左右滑选 —— 不用瞄准，停在哪件就是哪件。
        这张卡**没有背景框**（bare）：它是页面的重心，不是"又一张卡"。
        上面下面那些有框的（下一节课、习惯）都是"顺便看一眼"的东西，
        靠材质把这两类分开 —— 别让它们排成一串同样重的方块。
      */}
      <Card bare>
        {/* 没有标题没有提示语，orb 自己站一行；padding 是留给 orb 下面那行字（caption）的，它绝对定位、不占布局 */}
        <View style={styles.focusOrbRow}>
          <GrowthOrb seconds={growthSeconds} size={72} />
        </View>

        <FocusPicker
          options={options}
          index={pickerIndex}
          onIndexChange={handleIndexChange}
          newTitle={newTitle}
          onNewTitleChange={setNewTitle}
        />

        {/* 只有一个键：按下它干什么，由指针停在谁身上决定 */}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: starting }}
          disabled={starting}
          onPress={() => void start()}
          style={({ pressed }) => [
            styles.startButton,
            { backgroundColor: theme.text, opacity: pressed || starting ? 0.8 : 1 },
          ]}>
          <ThemedText type="smallBold" style={{ color: theme.background }}>
            {starting ? '准备中…' : startLabel}
          </ThemedText>
        </Pressable>
      </Card>

      {/* 慢事：常驻一张卡，不用展开 —— 折叠等于多一次点击 */}
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
                <ThemedText type="small" numberOfLines={1} style={styles.habitTitle}>
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
  homeContent: { paddingBottom: FAB_SIZE + Spacing.three },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  focusOrbRow: { alignItems: 'center', paddingBottom: Spacing.four },
  // 通栏的大键：它是整张卡的落点，也是首页唯一的主按钮
  startButton: {
    marginTop: Spacing.one,
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  ghostButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
  habitTitle: { flex: 1 },
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
