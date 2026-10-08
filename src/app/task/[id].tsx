import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card } from '@/components/card';
import {
  DateTimePickerBody,
  defaultDraft,
  describeDraft,
  draftFromTask,
  draftToTime,
  type DateTimeDraft,
} from '@/components/date-time-picker';
import { ScheduleSheet, type SheetView } from '@/components/schedule-sheet';
import { Screen } from '@/components/screen';
import { KIND_LABEL } from '@/components/task-row';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import {
  CompletionRule,
  TaskKind,
  TaskStatus,
  TimeAttribute,
  type TaskKind as TaskKindValue,
  type TaskStatus as TaskStatusValue,
} from '@/domain/enums';
import { hasCheckedInOn } from '@/domain/checkins';
import { describeProgress } from '@/domain/focus-link';
import {
  buildHabitConversion,
  canConvertToHabit,
  type HabitCadence,
} from '@/domain/habit-convert';
import { describePeriodProgress, occurrencesInPeriod } from '@/domain/habit-period';
import { describePastWindow, planEventShift, toLooseTodo } from '@/domain/past-event';
import { describeNextFire } from '@/domain/reminder';
import { describeReminder, describeRepeat } from '@/domain/repeat-next';
import { buildScheduleTime, SCHEDULE_PRESETS } from '@/domain/schedule-presets';
import { subtaskProgress } from '@/domain/subtask-progress';
import { taskDisplayState } from '@/domain/task-state';
import { taskAnchor, type RepeatRule, type Task, type TaskTime } from '@/domain/task';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';
import { describeDue, formatDayTime } from '@/utils/datetime';

/**
 * 任务详情页 —— 主流程「行 / 完」的载体。
 *
 * 列表行只负责"看一眼 + 勾一下"，其余编辑（标题、备注、状态、优先级、
 * 时间、提醒、重复、删除）全部收进这里。这样列表行不用堆按钮，
 * 加字段也不用再改列表。
 *
 * 保存策略：本页 state 是唯一显示源（乐观更新），改动即刻写库，
 * 不回头 reload —— 否则会跟正在输入的文本打架。
 */

const STATUS_OPTIONS: TaskStatusValue[] = [
  TaskStatus.Todo,
  TaskStatus.Doing,
  TaskStatus.Waiting,
];

/**
 * 可切换的任务类型。
 *
 * 刻意不给「想法型」：那是想法库里的东西（另一张表、不提醒、不催办），
 * 一条已经落了地的任务再改回想法，只会让两边的数据打架。
 */
const KIND_OPTIONS: TaskKindValue[] = [TaskKind.Schedule, TaskKind.Execution, TaskKind.Habit];

/**
 * "转成打卡"的预设。
 *
 * 不做一个"频率 + 次数"的二级表单：这一步的核心是**换判定域**，
 * 频率是唯一需要选的东西，而常见值就那么几个。选完还能在「目标」卡里改次数。
 */
const CONVERT_PRESETS: ReadonlyArray<{ label: string; cadence: HabitCadence; target: number }> = [
  { label: '每天 1 次', cadence: 'daily', target: 1 },
  { label: '每周 3 次', cadence: 'weekly', target: 3 },
  { label: '每周 5 次', cadence: 'weekly', target: 5 },
  { label: '每月 10 次', cadence: 'monthly', target: 10 },
];

export default function TaskDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const router = useRouter();
  const theme = useTheme();

  const rawId = params.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;

  const loadTask = useAppStore((state) => state.loadTask);
  const updateTask = useAppStore((state) => state.updateTask);
  const completeTask = useAppStore((state) => state.completeTask);
  const reopenTask = useAppStore((state) => state.reopenTask);
  const removeTask = useAppStore((state) => state.removeTask);
  const scheduleTask = useAppStore((state) => state.scheduleTask);
  const containers = useAppStore((state) => state.containers);
  const lastFocus = useAppStore((state) => state.lastFocus);
  const clearFocusFeedback = useAppStore((state) => state.clearFocusFeedback);
  const checkins = useAppStore((state) => state.checkins);
  const checkInAction = useAppStore((state) => state.checkIn);
  const undoCheckInAction = useAppStore((state) => state.undoCheckIn);
  const loadSubtasksAction = useAppStore((state) => state.loadSubtasks);
  const addSubtaskAction = useAppStore((state) => state.addSubtask);
  const toggleSubtaskAction = useAppStore((state) => state.setSubtaskDone);
  const deleteSubtaskAction = useAppStore((state) => state.removeSubtask);

  const [task, setTask] = useState<Task | null>(null);
  /**
   * 动作完成后留一句回声（"已转成打卡""已挪到明天 14:00"）——
   * 卡片会随之消失，不留一句话用户会不确定刚才那一下有没有生效。
   */
  const [flash, setFlash] = useState<{ icon: keyof typeof Ionicons.glyphMap; message: string } | null>(
    null,
  );
  /** "就这样吧"要按两下：第一下问一句，第二下才拿掉 */
  const [confirmingDrop, setConfirmingDrop] = useState(false);

  /**
   * 频率型的"本期做了几次"**从打卡记录现算**，不读任何计数器 ——
   * 计数器会被周期翻页甩下（这正是修掉的那个 bug），见 domain/habit-period。
   *
   * 必须放在页面顶部的无条件区（而不是 early return 之后）：
   * 它用了 useMemo，放后面就变成"有时调、有时不调"，React 会直接报错。
   */
  const checkinKeys = useMemo(
    () => (task ? checkins.filter((row) => row.taskId === task.id).map((row) => row.dayKey) : []),
    [checkins, task],
  );
  const doneToday = hasCheckedInOn(checkinKeys, new Date());
  const isFrequency = task?.completion === CompletionRule.Frequency;
  const periodCount =
    task && isFrequency ? occurrencesInPeriod(checkinKeys, task.repeat) : 0;
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [newSubtask, setNewSubtask] = useState('');
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetView, setSheetView] = useState<SheetView>('main');
  /**
   * 时间调整栏的草稿。栏是常驻的（不再藏进"自定义"），所以页面一进来就得有一份：
   * 先落在任务现有时间上，没有时间就给"今天 09:00"这个能直接确认的默认值。
   */
  const [draft, setDraft] = useState<DateTimeDraft>(() => defaultDraft());
  /** 滚轮按住时关掉整页滚动（见 date-time-picker 文件头：外层会吃掉滚轮手势） */
  const [wheelLocked, setWheelLocked] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  /** 低频设置（状态/类型/目标/归属/转打卡）收在这个开关后面，默认收起 */
  const [settingsOpen, setSettingsOpen] = useState(false);

  /** 输入框内容单独放，避免每次写库都重渲染整页 */
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [location, setLocation] = useState('');
  const [waitingFor, setWaitingFor] = useState('');
  const titleRef = useRef('');
  const noteRef = useRef('');
  const locationRef = useRef('');
  const waitingRef = useRef('');
  /** 目标值：本期次数 / 每次时长（习惯型才有） */
  const [goalOcc, setGoalOcc] = useState('');
  const [goalMin, setGoalMin] = useState('');
  const goalOccRef = useRef('');
  const goalMinRef = useRef('');

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    let alive = true;
    void loadTask(id).then(async (found) => {
      if (!alive) return;
      setTask(found);
      if (found) {
        setDraft(draftFromTask(found));
        setTitle(found.title);
        setNote(found.note ?? '');
        setLocation(found.location ?? '');
        setWaitingFor(found.waitingFor ?? '');
        titleRef.current = found.title;
        noteRef.current = found.note ?? '';
        locationRef.current = found.location ?? '';
        waitingRef.current = found.waitingFor ?? '';
        const occ = found.targetOccurrences ? String(found.targetOccurrences) : '';
        const min = found.targetMinutes ? String(found.targetMinutes) : '';
        setGoalOcc(occ);
        setGoalMin(min);
        goalOccRef.current = occ;
        goalMinRef.current = min;
        const children = await loadSubtasksAction(id);
        if (alive) setSubtasks(children);
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [id, loadTask, loadSubtasksAction]);

  /** 子任务变动后：重取子任务列表 + 重取父任务（父任务完成态可能是被推导出来的） */
  const reloadAfterSubtaskChange = useCallback(async () => {
    if (!id) return;
    setSubtasks(await loadSubtasksAction(id));
    const fresh = await loadTask(id);
    if (fresh) setTask(fresh);
  }, [id, loadSubtasksAction, loadTask]);

  const addSubtaskNow = useCallback(async () => {
    const text = newSubtask.trim();
    if (!id || !text) return;
    setNewSubtask('');
    await addSubtaskAction(id, text);
    await reloadAfterSubtaskChange();
  }, [id, newSubtask, addSubtaskAction, reloadAfterSubtaskChange]);

  const setSubtaskDone = useCallback(
    async (childId: string, done: boolean) => {
      await toggleSubtaskAction(childId, done);
      await reloadAfterSubtaskChange();
    },
    [toggleSubtaskAction, reloadAfterSubtaskChange],
  );

  const removeSubtask = useCallback(
    async (childId: string) => {
      await deleteSubtaskAction(childId);
      await reloadAfterSubtaskChange();
    },
    [deleteSubtaskAction, reloadAfterSubtaskChange],
  );

  /** 乐观更新：先改本地，再写库 */
  const patch = useCallback(
    async (changes: Partial<Task>) => {
      if (!task) return;
      setTask((current) => (current ? { ...current, ...changes } : current));
      await updateTask(task.id, changes);
    },
    [task, updateTask],
  );

  const saveTitle = useCallback(async () => {
    const next = titleRef.current.trim();
    if (!task || !next || next === task.title) return;
    await patch({ title: next });
  }, [task, patch]);

  const saveNote = useCallback(async () => {
    const next = noteRef.current.trim();
    if (!task || next === (task.note ?? '')) return;
    await patch({ note: next || null });
  }, [task, patch]);

  const saveLocation = useCallback(async () => {
    const next = locationRef.current.trim();
    if (!task || next === (task.location ?? '')) return;
    await patch({ location: next || null });
  }, [task, patch]);

  const saveWaiting = useCallback(async () => {
    const next = waitingRef.current.trim();
    if (!task || next === (task.waitingFor ?? '')) return;
    await patch({ waitingFor: next || null });
  }, [task, patch]);

  /**
   * 目标存盘：次数优先（"每周 3 次"这类），只填时长则按时长算。
   * 两个都空 = 没有达标线，回到"纯手动勾选"—— 不替用户定义什么算做到。
   */
  const saveGoals = useCallback(async () => {
    if (!task) return;
    const occ = Number(goalOccRef.current) || 0;
    const min = Number(goalMinRef.current) || 0;
    const patchGoals: Partial<Task> = {
      targetOccurrences: occ > 0 ? occ : null,
      targetMinutes: min > 0 ? min : null,
      completion:
        occ > 0
          ? CompletionRule.Frequency
          : min > 0
            ? CompletionRule.Duration
            : CompletionRule.Check,
    };
    if (
      task.targetOccurrences === patchGoals.targetOccurrences &&
      task.targetMinutes === patchGoals.targetMinutes &&
      task.completion === patchGoals.completion
    ) {
      return;
    }
    await patch(patchGoals);
  }, [task, patch]);

  /**
   * 打卡 / 撤销今天。
   * 打完卡状态可能翻转（本期达标 → 完成，或撤销后打回待办），
   * 所以要把任务重新读一遍，不能只信本地状态。
   */
  const toggleTodayCheckin = useCallback(async () => {
    if (!task) return;
    if (doneToday) await undoCheckInAction(task.id);
    else await checkInAction(task.id);
    const fresh = await loadTask(task.id);
    if (fresh) setTask(fresh);
  }, [task, doneToday, checkInAction, undoCheckInAction, loadTask]);

  /**
   * 转成打卡习惯。
   *
   * 顺序有讲究：**先改造任务，再补打卡**。
   * 如果任务原本已经完成过，补的那条打卡就是"今天做过一次" ——
   * 否则用户已经做过的事会因为一次转换凭空消失（见 habit-convert 的 seedCheckin）。
   */
  const convertToHabit = useCallback(
    async (preset: { label: string; cadence: HabitCadence; target: number }) => {
      if (!task) return;
      const plan = buildHabitConversion(task, {
        cadence: preset.cadence,
        targetOccurrences: preset.target,
        countExistingCompletion: true,
      });
      setTask((current) => (current ? { ...current, ...plan.patch } : current));
      await updateTask(task.id, plan.patch);
      if (plan.seedCheckin) await checkInAction(task.id);
      const fresh = await loadTask(task.id);
      if (fresh) setTask(fresh);
      setFlash({ icon: 'repeat-outline', message: `${plan.message}，以后打卡就行。` });
    },
    [task, updateTask, checkInAction, loadTask],
  );

  const handleComplete = async () => {
    if (!task) return;
    const isRepeating = Boolean(task.repeat) && taskAnchor(task) !== null;
    await completeTask(task.id);
    if (isRepeating) {
      // 重复任务"完成"= 滚到下一期，人还在这一页，刷新一下看新时间
      const fresh = await loadTask(task.id);
      setTask(fresh);
      if (fresh) {
        setTitle(fresh.title);
        titleRef.current = fresh.title;
      }
      return;
    }
    router.back();
  };

  /** 撤销完成：放回待办、提醒排回去，人留在这页看得到回声 */
  const handleReopen = async () => {
    if (!task) return;
    await reopenTask(task.id);
    const fresh = await loadTask(task.id);
    if (fresh) setTask(fresh);
    setFlash({ icon: 'arrow-undo', message: '已放回待办，到点会照常提醒你。' });
  };

  const handleDelete = async () => {
    if (!task) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    await removeTask(task.id);
    router.back();
  };

  const handleSchedule = (target: Task, time: TaskTime) => {
    // 时间由 store 写库并重排提醒；本地同步一份用于展示
    setTask((current) => (current ? { ...current, time } : current));
    void scheduleTask(target.id, time);
  };

  /** 点预设 = 一步安排到位，不用再进面板 */
  const handlePreset = (time: TaskTime) => {
    if (!task) return;
    setTask((current) => (current ? { ...current, time } : current));
    // 栏里的滚轮要跟着走：否则预设刚把时间改到"明天 14:00"，
    // 下面的调整栏还停在旧时刻，接着按一下确认就把刚定的时间顶掉了。
    setDraft(draftFromTask({ time }));
    void scheduleTask(task.id, time);
  };

  /** 调整栏的确认键：滚轮上选到哪就是哪 */
  const handleApplyDraft = () => {
    if (!task) return;
    const time = draftToTime(draft);
    if (!time) return;
    setTask((current) => (current ? { ...current, time } : current));
    void scheduleTask(task.id, time);
  };

  /** 取消时间 = 退回收集箱（主文档里"没时间"就是收集箱的定义） */
  const handleClearTime = () => {
    if (!task) return;
    const cleared: TaskTime = {
      attribute: TimeAttribute.None,
      startAt: null,
      endAt: null,
      dueAt: null,
    };
    setTask((current) => (current ? { ...current, time: cleared } : current));
    void scheduleTask(task.id, cleared);
  };

  /**
   * 「已经过去的事」的第一个出口：挪到下一个还没到的那个时刻。
   * 目标由 domain 算（原时刻今天已过就顺延到明天），界面不自己拼日期。
   */
  const handleShiftPast = () => {
    if (!task) return;
    const plan = planEventShift(task);
    if (!plan) return;
    setTask((current) => (current ? { ...current, time: plan.time } : current));
    setDraft(draftFromTask({ time: plan.time }));
    void scheduleTask(task.id, plan.time);
    setFlash({
      icon: 'time-outline',
      message: plan.dayOffset === 0 ? `${plan.label}，今天的这件事还在。` : `${plan.label} 了。`,
    });
  };

  /** 第二个出口：撤掉时间。会不开了，但这事本身还得做 → 回收集箱 */
  const handleLooseTodo = () => {
    if (!task) return;
    const changes = toLooseTodo(task);
    setTask((current) => (current ? { ...current, ...changes } : current));
    void updateTask(task.id, changes);
    setFlash({ icon: 'file-tray-outline', message: '撤掉时间了，它回到收集箱。' });
  };

  /**
   * 第三个出口：就这样吧 = 从日程里拿掉（软删除）。
   * 刻意**不**标成完成 —— 说好了"不替用户下结论"，也不能替他把没做的事记成做到；
   * 所以它不进完成率、不进回顾页。跟下面的删除按钮同一条路，同样按两下确认。
   */
  const handleDropPast = async () => {
    if (!task) return;
    if (!confirmingDrop) {
      setConfirmingDrop(true);
      return;
    }
    await removeTask(task.id);
    router.back();
  };

  if (loading) {
    return (
      <Screen title="任务">
        <ThemedText type="small" themeColor="textSecondary">
          正在读取…
        </ThemedText>
      </Screen>
    );
  }

  if (!task) {
    return (
      <Screen
        title="任务"
        right={
          <Pressable hitSlop={8} onPress={() => router.back()}>
            <Ionicons name="close" size={24} color={theme.textSecondary} />
          </Pressable>
        }>
        <Card>
          <ThemedText type="small" themeColor="textSecondary">
            这条任务已经不存在了（可能刚被删除）。
          </ThemedText>
        </Card>
      </Screen>
    );
  }

  const anchor = taskAnchor(task);
  const isDeadline = task.time.attribute === 'deadline';
  const done = task.status === TaskStatus.Done;

  /**
   * 「这段时间已经过去了」——只在**固定型**、已过、没打勾时出现。
   * 截止型过期（欠着的）不给这张卡：欠着的东西不该被劝着放弃。
   */
  const pastEvent = taskDisplayState(task) === 'missed';
  const pastPlan = pastEvent ? planEventShift(task) : null;
  const pastWindow = pastEvent ? describePastWindow(task) : '';

  const timeText = anchor
    ? `${describeDue(anchor)} · ${formatDayTime(anchor)}`
    : '还没定时间';
  /**
   * 没有时间时不写第二行：卡片标题旁边那句提示已经把这件事说完了，
   * 这里再说一遍就成了同一句话说两遍（而且"点一下"已经不成立 —— 调整栏就在下面）。
   */
  const timeHint = anchor
    ? `${isDeadline ? '截止' : '开始'} · ${
        task.reminderMinutesBefore == null
          ? '不提醒'
          : `提醒 ${describeReminder(task.reminderMinutesBefore)}`
      }${task.repeat ? ` · ${describeRepeat(task.repeat)}` : ''}`
    : '';

  /**
   * 低频设置收起时的那一行摘要 —— 收起不等于看不见：
   * 得让人知道里面现在是什么状态，否则每次都要点开确认一遍。
   */
  const statusLabel =
    task.status === TaskStatus.Done
      ? '已完成'
      : task.status === TaskStatus.Doing
        ? '进行中'
        : task.status === TaskStatus.Waiting
          ? '等待中'
          : '待办';
  const containerLabel = task.containerId
    ? (containers.find((item) => item.id === task.containerId)?.title ?? '已归属')
    : '不归属';
  const settingsSummary = `${statusLabel} · ${KIND_LABEL[task.kind]} · ${containerLabel}`;

  /**
   * 常驻底栏。这两个动作都会改写这条任务，原来却要滚到页面最底部才够得到 ——
   * 典型的"高频动作被低频设置挤到下面"。
   */
  const bottomBar = (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="进入专注"
        onPress={() => router.push({ pathname: '/focus', params: { taskId: task.id } })}
        style={({ pressed }) => [
          styles.barGhost,
          { borderColor: theme.backgroundSelected, opacity: pressed ? 0.6 : 1 },
        ]}>
        <Ionicons name="timer-outline" size={17} color={theme.text} />
        <ThemedText type="small">专注</ThemedText>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        onPress={() =>
          void (isFrequency ? toggleTodayCheckin() : done ? handleReopen() : handleComplete())
        }
        style={({ pressed }) => [
          styles.barPrimary,
          { backgroundColor: theme.text, opacity: pressed ? 0.8 : 1 },
        ]}>
        <Ionicons
          name={isFrequency ? (doneToday ? 'arrow-undo' : 'add') : done ? 'arrow-undo' : 'checkmark'}
          size={17}
          color={theme.background}
        />
        <ThemedText type="smallBold" style={{ color: theme.background }}>
          {isFrequency
            ? doneToday
              ? '撤销今天'
              : '今天打卡'
            : done
              ? '撤销完成'
              : task.repeat
                ? '完成这一次'
                : '完成'}
        </ThemedText>
      </Pressable>
    </>
  );

  return (
    <Screen
      title="任务"
      bottomBar={bottomBar}
      scrollEnabled={!wheelLocked}
      subtitle={`${KIND_LABEL[task.kind]}${
        isFrequency
          ? ` · ${describePeriodProgress(task.repeat, task.targetOccurrences, periodCount)}`
          : ''
      }`}
      right={
        <Pressable hitSlop={8} onPress={() => router.back()}>
          <Ionicons name="close" size={24} color={theme.textSecondary} />
        </Pressable>
      }>
      {/* 刚结束的专注带了话回来：就地告诉用户这段被记到哪儿了 */}
      {lastFocus?.taskId === task.id ? (
        <Pressable accessibilityRole="button" onPress={clearFocusFeedback}>
          <Card style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: theme.backgroundSelected }}>
            <View style={styles.focusFeedback}>
              <Ionicons name="timer-outline" size={16} color={theme.text} />
              <ThemedText type="small" style={styles.focusFeedbackText}>
                {lastFocus.message}
              </ThemedText>
            </View>
          </Card>
        </Pressable>
      ) : null}

      {/* 动作完成后的一句回声：卡片消失时得有句话说明刚才发生了什么 */}
      {flash ? (
        <Pressable accessibilityRole="button" onPress={() => setFlash(null)}>
          <Card style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: theme.backgroundSelected }}>
            <View style={styles.focusFeedback}>
              <Ionicons name={flash.icon} size={16} color={theme.text} />
              <ThemedText type="small" style={styles.focusFeedbackText}>
                {flash.message}
              </ThemedText>
            </View>
          </Card>
        </Pressable>
      ) : null}

      {/*
        已经过去的事：给它三个出口。
        时间过了绝不自动完成（铁律），但也绝不能让一条没人认领的过去
        永远挂在日历上 —— 用户每次翻到那天都要重新想一遍"这个我到底办没办"。
        三个出口对应三种真实意图，都能一步到位，没有新概念要学。
      */}
      {pastEvent ? (
        <Card
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: theme.backgroundSelected }}>
          <View style={styles.pastHeader}>
            <Ionicons name="alert-circle-outline" size={16} color={theme.textSecondary} />
            <View style={styles.pastHeaderBody}>
              <ThemedText type="smallBold">{pastWindow} 的这段时间已经过去了</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.rowHint}>
                没打勾的事我不会自动替你算完成 —— 怎么处理你说了算。
              </ThemedText>
            </View>
          </View>

          <View style={styles.chips}>
            {pastPlan ? (
              <Chip
                label={pastPlan.label}
                active
                theme={theme}
                onPress={handleShiftPast}
              />
            ) : null}
            <Chip label="改成待办" active={false} theme={theme} onPress={handleLooseTodo} />
            <Chip
              label={confirmingDrop ? '再点一次就拿掉' : '就这样吧'}
              active={false}
              theme={theme}
              onPress={() => void handleDropPast()}
            />
          </View>

          <ThemedText type="small" themeColor="textSecondary" style={styles.goalHint}>
            「就这样吧」= 从日程里拿掉，不算完成、也不进统计；想要别的时刻就走「时间」卡。
          </ThemedText>
        </Card>
      ) : null}

      {/* 标题：大字输入，直接改 */}
      <Card>
        <TextInput
          value={title}
          onChangeText={(value) => {
            setTitle(value);
            titleRef.current = value;
          }}
          onBlur={() => void saveTitle()}
          multiline
          placeholder="想做什么"
          placeholderTextColor={theme.textSecondary}
          style={[styles.titleInput, { color: theme.text }]}
        />

        <TextInput
          value={note}
          onChangeText={(value) => {
            setNote(value);
            noteRef.current = value;
          }}
          onBlur={() => void saveNote()}
          multiline
          placeholder="备注（自动保存）"
          placeholderTextColor={theme.textSecondary}
          style={[
            styles.noteInput,
            {
              color: theme.text,
              backgroundColor: theme.background,
              borderColor: theme.backgroundSelected,
            },
          ]}
        />

        {/*
          地点：选填的一等字段。它是"这件事在哪儿发生"，而不是备注里的一句话 ——
          日历上要知道往哪走，那一眼不该靠点进详情页才看得见。
          与课程 / 固定日程上的同名字段对齐（那两个一直就有）。
        */}
        <View
          style={[
            styles.locationRow,
            { borderColor: theme.backgroundSelected, backgroundColor: theme.background },
          ]}>
          <Ionicons name="location-outline" size={15} color={theme.textSecondary} />
          <TextInput
            value={location}
            onChangeText={(value) => {
              setLocation(value);
              locationRef.current = value;
            }}
            onBlur={() => void saveLocation()}
            placeholder="在哪（选填）"
            placeholderTextColor={theme.textSecondary}
            style={[styles.locationInput, { color: theme.text }]}
          />
        </View>

        {/* 专注累计：原来挂在最底部的「开始做」卡上，那里现在只剩一个底栏按钮 */}
        {describeProgress(task) ? (
          <ThemedText type="small" themeColor="textSecondary">
            {describeProgress(task)}
          </ThemedText>
        ) : null}
      </Card>

      {/* 时间 / 提醒 / 重复 */}
      <Card title="时间" hint={anchor ? undefined : '定个时间，它就会落到日历按时提醒你'}>
        <View style={styles.row}>
          <Ionicons
            name={anchor ? (isDeadline ? 'alarm-outline' : 'time-outline') : 'calendar-outline'}
            size={18}
            color={theme.textSecondary}
          />
          <View style={styles.rowBody}>
            <ThemedText type="smallBold">{timeText}</ThemedText>
            {timeHint ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.rowHint}>
                {timeHint}
              </ThemedText>
            ) : null}
          </View>
        </View>

        {/* 高频预设直接铺开：从收集箱点进来只要再点一下就定好了 */}
        <View style={styles.chips}>
          {SCHEDULE_PRESETS.map((preset) => (
            <Pressable
              key={preset.id}
              accessibilityRole="button"
              accessibilityLabel={`安排为${preset.label}`}
              onPress={() => handlePreset(buildScheduleTime(preset))}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: pressed ? theme.backgroundSelected : theme.background,
                  borderColor: theme.backgroundSelected,
                },
              ]}>
              <Ionicons
                name={preset.attribute === 'fixed' ? 'time-outline' : 'alarm-outline'}
                size={13}
                color={theme.textSecondary}
              />
              <ThemedText type="small">{preset.label}</ThemedText>
            </Pressable>
          ))}

          {/* 预设兜不住的走这里：自己选哪天 + 时/分双滚轮，精确到 1 分钟。
              常驻展开，不再有一个"自定义…"的入口 —— 要精确调时刻本来就该直接看到滚轮。 */}
          <View style={styles.pickerBlock}>
            <DateTimePickerBody
              value={draft}
              onChange={setDraft}
              onScrollLockChange={setWheelLocked}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`设为${describeDraft(draft)}`}
              onPress={handleApplyDraft}
              style={({ pressed }) => [
                styles.applyButton,
                { backgroundColor: theme.text, opacity: pressed ? 0.8 : 1 },
              ]}>
              <ThemedText type="smallBold" style={{ color: theme.background }}>
                设为 {describeDraft(draft)}
              </ThemedText>
            </Pressable>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setSheetView('reminder');
            setSheetOpen(true);
          }}
          style={({ pressed }) => [
            styles.settingRow,
            { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
          ]}>
          <Ionicons name="notifications-outline" size={16} color={theme.textSecondary} />
          <ThemedText type="small">提醒</ThemedText>
          <View style={styles.settingValue}>
            <ThemedText type="small" themeColor="textSecondary">
              {describeReminder(task.reminderMinutesBefore)}
            </ThemedText>
            <Ionicons name="chevron-forward" size={14} color={theme.textSecondary} />
          </View>
        </Pressable>
        {/* 提醒是静默调度的（权限被拒、时间已过都不出声），把"排没排上"说在明处 */}
        <ThemedText type="small" themeColor="textSecondary" style={styles.reminderNote}>
          {describeNextFire(task)}
        </ThemedText>

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setSheetView('repeat');
            setSheetOpen(true);
          }}
          style={({ pressed }) => [
            styles.settingRow,
            { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
          ]}>
          <Ionicons name="repeat-outline" size={16} color={theme.textSecondary} />
          <ThemedText type="small">重复</ThemedText>
          <View style={styles.settingValue}>
            <ThemedText type="small" themeColor="textSecondary">
              {task.repeat ? describeRepeat(task.repeat) : '不重复'}
            </ThemedText>
            <Ionicons name="chevron-forward" size={14} color={theme.textSecondary} />
          </View>
        </Pressable>

        {anchor ? (
          <Pressable accessibilityRole="button" onPress={handleClearTime} style={styles.linkRow}>
            <ThemedText type="small" themeColor="textSecondary">
              取消时间安排，退回收集箱
            </ThemedText>
          </Pressable>
        ) : null}
      </Card>

      {/* 子任务：把一件事拆开，父任务进度跟着走 */}
      <Card
        title="子任务"
        hint={
          subtasks.length
            ? `${subtaskProgress(subtasks).done}/${subtasks.length} 完成${
                subtaskProgress(subtasks).allDone ? ' · 已全部完成' : ''
              }`
            : '把这件事拆成几步，做起来更容易开始'
        }>
        {subtasks.map((child) => (
          <View key={child.id} style={styles.subtaskRow}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: child.status === TaskStatus.Done }}
              accessibilityLabel={child.status === TaskStatus.Done ? '取消完成' : '标记为完成'}
              onPress={() => void setSubtaskDone(child.id, child.status !== TaskStatus.Done)}
              style={[
                styles.subtaskCheck,
                {
                  borderColor: child.status === TaskStatus.Done ? theme.text : theme.textSecondary,
                  backgroundColor:
                    child.status === TaskStatus.Done ? theme.text : 'transparent',
                },
              ]}>
              {child.status === TaskStatus.Done ? (
                <Ionicons name="checkmark" size={12} color={theme.background} />
              ) : null}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/task/${child.id}`)}
              style={styles.subtaskBody}>
              <ThemedText
                type="small"
                themeColor={child.status === TaskStatus.Done ? 'textSecondary' : 'text'}
                style={child.status === TaskStatus.Done ? styles.subtaskDone : undefined}
                numberOfLines={2}>
                {child.title}
              </ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="删除子任务"
              hitSlop={6}
              onPress={() => void removeSubtask(child.id)}>
              <Ionicons name="close" size={15} color={theme.textSecondary} />
            </Pressable>
          </View>
        ))}

        <View style={[styles.subtaskAdd, { borderColor: theme.backgroundSelected }]}>
          <Ionicons name="add" size={16} color={theme.textSecondary} />
          <TextInput
            value={newSubtask}
            onChangeText={setNewSubtask}
            onSubmitEditing={() => void addSubtaskNow()}
            placeholder="加一步，点键盘上的「完成」"
            placeholderTextColor={theme.textSecondary}
            returnKeyType="done"
            style={[styles.subtaskInput, { color: theme.text }]}
          />
        </View>
      </Card>

      {/*
        低频设置收在开关后面。
        这一页以前是 9 个分区平铺，最常改的「时间」被挤到第 3 屏才看得见 ——
        现在把"一辈子改不了几次"的收起来，收起时只剩一行摘要。
      */}
      <Card>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: settingsOpen }}
          accessibilityLabel={settingsOpen ? '收起更多设置' : '展开更多设置'}
          onPress={() => setSettingsOpen((open) => !open)}
          style={({ pressed }) => [styles.settingsToggle, { opacity: pressed ? 0.7 : 1 }]}>
          <Ionicons name="options-outline" size={16} color={theme.textSecondary} />
          <View style={styles.settingsToggleBody}>
            <ThemedText type="small">更多设置</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.rowHint}>
              {settingsSummary}
            </ThemedText>
          </View>
          <Ionicons
            name={settingsOpen ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={theme.textSecondary}
          />
        </Pressable>
      </Card>

      {settingsOpen ? (
        <>
          {/* 状态 */}
          <Card title="状态">
        <View style={styles.chips}>
          {STATUS_OPTIONS.map((option) => {
            const active = task.status === option;
            return (
              <Chip
                key={option}
                label={option === TaskStatus.Todo ? '待办' : option === TaskStatus.Doing ? '进行中' : '等待中'}
                active={active}
                theme={theme}
                onPress={() =>
                  void patch({
                    status: option,
                    completedAt: null,
                    waitingFor: option === TaskStatus.Waiting ? task.waitingFor ?? null : null,
                  })
                }
              />
            );
          })}
        </View>

        {task.status === TaskStatus.Waiting ? (
          <TextInput
            value={waitingFor}
            onChangeText={(value) => {
              setWaitingFor(value);
              waitingRef.current = value;
            }}
            onBlur={() => void saveWaiting()}
            placeholder="在等谁 / 等什么"
            placeholderTextColor={theme.textSecondary}
            style={[
              styles.inlineInput,
              {
                color: theme.text,
                backgroundColor: theme.background,
                borderColor: theme.backgroundSelected,
              },
            ]}
          />
        ) : null}
      </Card>

      {/* 类型：决定它怎么被对待 —— 习惯型才进「习惯」页、才能打卡 */}
      <Card title="类型" hint="能打卡、攒连续天数">
        <View style={styles.chips}>
          {KIND_OPTIONS.map((option) => (
            <Chip
              key={option}
              label={KIND_LABEL[option]}
              active={task.kind === option}
              theme={theme}
              onPress={() => void patch({ kind: option })}
            />
          ))}
        </View>
      </Card>

      {/* 目标：习惯 / 执行型的达标线。定了它就"够数自动完成"，没定就纯靠手动勾选 */}
      {task.kind === TaskKind.Habit ? (
        <Card title="目标" hint="够数自动达成；不定就只记次数">
          <View style={styles.goalRow}>
            <ThemedText type="small" style={styles.goalLabel}>
              本期做够
            </ThemedText>
            <TextInput
              value={goalOcc}
              onChangeText={(value) => {
                setGoalOcc(value.replace(/[^0-9]/g, ''));
                goalOccRef.current = value;
              }}
              onBlur={() => void saveGoals()}
              keyboardType="number-pad"
              placeholder="不限"
              placeholderTextColor={theme.textSecondary}
              style={[
                styles.goalInput,
                {
                  color: theme.text,
                  backgroundColor: theme.background,
                  borderColor: theme.backgroundSelected,
                },
              ]}
            />
            <ThemedText type="small">次</ThemedText>
          </View>

          <View style={styles.goalRow}>
            <ThemedText type="small" style={styles.goalLabel}>
              每次做够
            </ThemedText>
            <TextInput
              value={goalMin}
              onChangeText={(value) => {
                setGoalMin(value.replace(/[^0-9]/g, ''));
                goalMinRef.current = value;
              }}
              onBlur={() => void saveGoals()}
              keyboardType="number-pad"
              placeholder="不限"
              placeholderTextColor={theme.textSecondary}
              style={[
                styles.goalInput,
                {
                  color: theme.text,
                  backgroundColor: theme.background,
                  borderColor: theme.backgroundSelected,
                },
              ]}
            />
            <ThemedText type="small">分钟</ThemedText>
          </View>

          <ThemedText type="small" themeColor="textSecondary" style={styles.goalHint}>
            次数优先：填了次数就按次数达标（如"每周 3 次"）；只填时长就按时长达标。
            没有重复规则时"本期"按一天算。
          </ThemedText>

          {isFrequency ? (
            <View style={styles.periodRow}>
              <ThemedText type="small">
                {describePeriodProgress(task.repeat, task.targetOccurrences, periodCount)}
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                onPress={() => void toggleTodayCheckin()}
                style={({ pressed }) => [
                  styles.miniButton,
                  {
                    borderColor: theme.backgroundSelected,
                    opacity: pressed ? 0.6 : 1,
                  },
                ]}>
                <ThemedText type="small" themeColor="textSecondary">
                  {doneToday ? '撤销今天' : '今天打卡'}
                </ThemedText>
              </Pressable>
            </View>
          ) : null}
        </Card>
      ) : null}

      {/*
        转成打卡：任务做完就结束，习惯每天重置 —— 差别在**判定域**，
        不是显示方式。所以这一步会同时换掉类型、重复规则、达标方式。
      */}
      {canConvertToHabit(task) ? (
        <Card
          title="转成打卡习惯"
          hint="打一次算一次；够目标自动达成">
          <View style={styles.chips}>
            {CONVERT_PRESETS.map((preset) => (
              <Chip
                key={preset.label}
                label={preset.label}
                active={false}
                theme={theme}
                onPress={() => void convertToHabit(preset)}
              />
            ))}
          </View>

          <ThemedText type="small" themeColor="textSecondary" style={styles.goalHint}>
            重复规则与达标方式会换成打卡的频率；时间、备注、归属都保留。
            {task.targetMinutes
              ? `原来的「够 ${task.targetMinutes} 分钟」目标将不再生效。`
              : ''}
          </ThemedText>
        </Card>
      ) : null}

      {/* 归属：任务挂在容器下，进度才会汇到目标 / 项目里 */}
      <Card
        title="归属"
        hint={
          containers.length
            ? '挂了容器，进度就汇到那个目标 / 项目里'
            : '还没有容器，去「项目」页建一个目标或项目'
        }>
        <View style={styles.chips}>
          <Chip
            label="不归属"
            active={!task.containerId}
            theme={theme}
            onPress={() => void patch({ containerId: null })}
          />
          {containers.map((container) => (
            <Chip
              key={container.id}
              label={container.title}
              active={task.containerId === container.id}
              theme={theme}
              onPress={() => void patch({ containerId: container.id })}
            />
          ))}
        </View>
      </Card>

          {/*
            删除放在这里而不是底栏：它必须存在（能创建就要能删掉），
            但不该天天杵在拇指最容易碰到的位置 —— 尤其是它按一下就没了。
          */}
          <Pressable
            accessibilityRole="button"
            onPress={() => void handleDelete()}
            style={({ pressed }) => [styles.dangerRow, { opacity: pressed ? 0.6 : 1 }]}>
            <ThemedText type="small" themeColor="textSecondary">
              {confirmingDelete ? '再点一次确认删除' : task.repeat ? '删除这个重复任务' : '删除这条'}
            </ThemedText>
          </Pressable>
        </>
      ) : null}

      <ScheduleSheet
        task={sheetOpen ? task : null}
        initialView={sheetView}
        onClose={() => setSheetOpen(false)}
        onSchedule={handleSchedule}
        onSetReminder={(target, minutes) => {          setTask((current) =>
            current ? { ...current, reminderMinutesBefore: minutes } : current,
          );
          void updateTask(target.id, { reminderMinutesBefore: minutes });
        }}
        onSetRepeat={(target, rule: RepeatRule | null) => {
          setTask((current) => (current ? { ...current, repeat: rule } : current));
          void updateTask(target.id, { repeat: rule });
        }}
      />
    </Screen>
  );
}

function Chip({
  label,
  active,
  onPress,
  theme,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: active ? theme.text : theme.background,
          borderColor: active ? theme.text : theme.backgroundSelected,
        },
      ]}>
      <ThemedText type="small" style={{ color: active ? theme.background : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  titleInput: {
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '600',
    padding: 0,
  },
  noteInput: {
    minHeight: 72,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: 'top',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  locationInput: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    padding: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  rowBody: { flex: 1, gap: Spacing.half },
  rowHint: { fontSize: 12, lineHeight: 16 },
  /** 「已经过去的事」那张卡的头：图标 + 两行说明 */
  pastHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  pastHeaderBody: { flex: 1, gap: Spacing.half },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  /** 常驻的时间调整栏：紧跟预设，间隔略大一点，看起来是"另一件事"（精确调） */
  pickerBlock: { gap: Spacing.two, marginTop: Spacing.two },
  applyButton: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  settingValue: { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: 'auto' },
  reminderNote: {
    paddingHorizontal: Spacing.three,
    marginTop: -Spacing.one,
    marginBottom: Spacing.one,
  },
  inlineInput: {
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 14,
  },
  linkRow: { paddingVertical: Spacing.one },
  subtaskRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  subtaskCheck: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtaskBody: { flex: 1, paddingVertical: Spacing.one },
  subtaskDone: { textDecorationLine: 'line-through' },
  subtaskAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
    marginTop: Spacing.one,
  },
  subtaskInput: { flex: 1, fontSize: 14, lineHeight: 20, paddingVertical: 2 },
  goalRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  goalLabel: { width: 72 },
  goalInput: {
    minWidth: 72,
    textAlign: 'center',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 14,
    lineHeight: 20,
  },
  goalHint: { fontSize: 11, lineHeight: 16, opacity: 0.8 },
  /** 本期进度 + 打卡按钮：进度在左、动作在右，跟列表行的习惯一致 */
  periodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  miniButton: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
  focusFeedback: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  focusFeedbackText: { flex: 1, lineHeight: 18 },
  /** 「更多设置」开关：一行摘要 + 展开箭头，收起时就是它一行 */
  settingsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  settingsToggleBody: { flex: 1, gap: Spacing.half },
  /** 删除：贴在折叠区最下面。靠文字说清后果，不靠红颜色喊 */
  dangerRow: { alignItems: 'center', paddingVertical: Spacing.two },
  /** 底栏两个键：次要的描边、主要的实心并吃掉剩余宽度 */
  barGhost: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
  barPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
  },
});
