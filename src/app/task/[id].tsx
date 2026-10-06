import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card } from '@/components/card';
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
import { describeProgress } from '@/domain/focus-link';
import { describeReminder, describeRepeat } from '@/domain/repeat-next';
import { buildScheduleTime, SCHEDULE_PRESETS } from '@/domain/schedule-presets';
import { subtaskProgress } from '@/domain/subtask-progress';
import type { RepeatRule, Task, TaskTime } from '@/domain/task';
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

export default function TaskDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const router = useRouter();
  const theme = useTheme();

  const rawId = params.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;

  const loadTask = useAppStore((state) => state.loadTask);
  const updateTask = useAppStore((state) => state.updateTask);
  const completeTask = useAppStore((state) => state.completeTask);
  const removeTask = useAppStore((state) => state.removeTask);
  const scheduleTask = useAppStore((state) => state.scheduleTask);
  const containers = useAppStore((state) => state.containers);
  const lastFocus = useAppStore((state) => state.lastFocus);
  const clearFocusFeedback = useAppStore((state) => state.clearFocusFeedback);
  const loadSubtasksAction = useAppStore((state) => state.loadSubtasks);
  const addSubtaskAction = useAppStore((state) => state.addSubtask);
  const toggleSubtaskAction = useAppStore((state) => state.setSubtaskDone);
  const deleteSubtaskAction = useAppStore((state) => state.removeSubtask);

  const [task, setTask] = useState<Task | null>(null);
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [newSubtask, setNewSubtask] = useState('');
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetView, setSheetView] = useState<SheetView>('main');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  /** 输入框内容单独放，避免每次写库都重渲染整页 */
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [waitingFor, setWaitingFor] = useState('');
  const titleRef = useRef('');
  const noteRef = useRef('');
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
        setTitle(found.title);
        setNote(found.note ?? '');
        setWaitingFor(found.waitingFor ?? '');
        titleRef.current = found.title;
        noteRef.current = found.note ?? '';
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

  const handleComplete = async () => {
    if (!task) return;
    const isRepeating = Boolean(task.repeat) && Boolean(task.time.startAt ?? task.time.dueAt);
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

  const anchor = task.time.startAt ?? task.time.dueAt ?? null;
  const isDeadline = task.time.attribute === 'deadline';
  const done = task.status === TaskStatus.Done;
  const timeText = anchor
    ? `${describeDue(anchor)} · ${formatDayTime(anchor)}`
    : '还没定时间';
  const timeHint = anchor
    ? `${isDeadline ? '截止' : '开始'} · 提醒 ${describeReminder(task.reminderMinutesBefore)}${
        task.repeat ? ` · ${describeRepeat(task.repeat)}` : ''
      }`
    : '点一下给它定个时间，就会落到日历';

  return (
    <Screen
      title="任务"
      subtitle={`${KIND_LABEL[task.kind]}${task.progress.occurrencesThisPeriod ? ` · 已完成 ${task.progress.occurrencesThisPeriod} 次` : ''}`}
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
            placeholder="加一步，回车确认"
            placeholderTextColor={theme.textSecondary}
            returnKeyType="done"
            style={[styles.subtaskInput, { color: theme.text }]}
          />
        </View>
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
            <ThemedText type="small" themeColor="textSecondary" style={styles.rowHint}>
              {timeHint}
            </ThemedText>
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

          {/* 预设兜不住的走这里：自己选哪天 + 时/分双滚轮，精确到 1 分钟 */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="自定义时间"
            onPress={() => {
              setSheetView('custom');
              setSheetOpen(true);
            }}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: pressed ? theme.backgroundSelected : theme.background,
                borderColor: theme.backgroundSelected,
              },
            ]}>
            <Ionicons name="options-outline" size={13} color={theme.textSecondary} />
            <ThemedText type="small">自定义…</ThemedText>
          </Pressable>
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

        {done ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void patch({ status: TaskStatus.Todo, completedAt: null })}
            style={styles.linkRow}>
            <ThemedText type="small" themeColor="textSecondary">
              已完成 · 点这里重新打开
            </ThemedText>
          </Pressable>
        ) : null}
      </Card>

      {/* 类型：决定它怎么被对待 —— 习惯型才进「习惯」页、才能打卡 */}
      <Card title="类型" hint="习惯型会出现在「习惯」页，可以打卡攒连续天数">
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
        <Card title="目标" hint="定了目标，打卡到数就自动达成；不定就只是记录次数">
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

      {/* 行：真正的"开始做"入口。时长会记回这条任务 */}
      <Card
        title="开始做"
        hint="专注结束后，这段时间会累加到这条任务的进度里；够目标就自动完成">
        {describeProgress(task) ? (
          <ThemedText type="small" themeColor="textSecondary">
            {describeProgress(task)}
          </ThemedText>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/focus', params: { taskId: task.id } })}
          style={({ pressed }) => [
            styles.focusEntry,
            { backgroundColor: theme.backgroundSelected, opacity: pressed ? 0.85 : 1 },
          ]}>
          <Ionicons name="timer-outline" size={18} color={theme.text} />
          <ThemedText type="smallBold">进入专注</ThemedText>
          <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
        </Pressable>
      </Card>

      {/* 主操作 */}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => void handleComplete()}
          style={({ pressed }) => [
            styles.primaryAction,
            { backgroundColor: theme.text, opacity: pressed ? 0.8 : 1 },
          ]}>
          <Ionicons name="checkmark" size={18} color={theme.background} />
          <ThemedText type="smallBold" style={{ color: theme.background }}>
            {task.repeat ? '完成这一次' : '完成'}
          </ThemedText>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => void handleDelete()}
          style={({ pressed }) => [
            styles.secondaryAction,
            {
              borderColor: theme.backgroundSelected,
              opacity: pressed ? 0.6 : 1,
            },
          ]}>
          <ThemedText type="small" themeColor="textSecondary">
            {confirmingDelete ? '再点一次确认删除' : task.repeat ? '删除这个重复任务' : '删除'}
          </ThemedText>
        </Pressable>
      </View>

      <ScheduleSheet
        task={sheetOpen ? task : null}
        initialView={sheetView}
        onClose={() => setSheetOpen(false)}
        onSchedule={handleSchedule}
        onSetReminder={(target, minutes) => {
          setTask((current) =>
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
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
  focusFeedback: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  focusFeedbackText: { flex: 1, lineHeight: 18 },
  focusEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
  },
  actions: { gap: Spacing.two },
  primaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
  },
  secondaryAction: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
