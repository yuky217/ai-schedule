import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import { Card } from '@/components/card';
import { ChoiceSheet } from '@/components/choice-sheet';
import { GrowthOrb } from '@/components/growth-orb';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { TimeAttribute } from '@/domain/enums';
import { FOCUS_MINUTE_PRESETS, type FocusSession } from '@/domain/focus';
import type { Task } from '@/domain/task';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';
import { useSettings } from '@/state/settings-store';
import { formatDuration } from '@/utils/datetime';

/**
 * 专注界面（主文档第六节）。
 *
 * 三条设计决策直接写在实现里：
 * 1. **主角是时间** —— 页面上最大的字号给了计时器，其它一切都让位。
 * 2. **小东西只涨不落** —— growth 取"本次已过去的最长时间"，暂停也不会缩水。
 * 3. **可以开始之后再命名** —— 不强迫用户在进入时就想清楚"这是什么事"。
 *
 * 带 taskId 进来时，这一页就成了主流程「行」的入口：结束后把这段时长
 * 记到那条任务身上，够目标的自动完成（见 domain/focus-link.ts）。
 * 是否"顺便标记完成"由用户自己勾 —— 坐下来干了 20 分钟不等于事情做完了。
 *
 * 进入页面即开始计时，退出即结束并落库，避免出现"忘了结束"的僵尸会话。
 */
export default function FocusScreen() {
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{ taskId?: string }>();
  const taskId = params.taskId ?? null;

  const defaultMinutes = useSettings((state) => state.defaultFocusMinutes);
  const hapticsEnabled = useSettings((state) => state.hapticsEnabled);

  const startFocus = useAppStore((state) => state.startFocus);
  const finishFocus = useAppStore((state) => state.finishFocus);
  const saveFocusSession = useAppStore((state) => state.saveFocusSession);
  const loadTask = useAppStore((state) => state.loadTask);

  const [boundTask, setBoundTask] = useState<Task | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  /*
   * 计划时长：进场带设置里的默认值，**当场可改** ——
   * "这次想专注 45 分钟"不该逼人先去设置页改全局默认再回来（第一原则②）。
   */
  const [planned, setPlanned] = useState(defaultMinutes);
  const [pickMinutes, setPickMinutes] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(true);
  const [intent, setIntent] = useState('');
  const [note, setNote] = useState('');
  const [alsoComplete, setAlsoComplete] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const elapsedRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const sessionRef = useRef<FocusSession | null>(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    elapsedRef.current = elapsed;
  }, [elapsed]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // 绑定的任务：拿标题显示出来，让人确认"我正在做的是这件事"
  useEffect(() => {
    if (!taskId) return;
    let alive = true;
    void loadTask(taskId).then((found) => {
      if (alive) setBoundTask(found);
    });
    return () => {
      alive = false;
    };
  }, [loadTask, taskId]);

  // 进入即开一个会话：允许"先干着，之后再想这是什么事"
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await startFocus(taskId, defaultMinutes);
      if (!cancelled) {
        sessionRef.current = session;
        setSessionId(session.id);
      }
    })();
    return () => {
      cancelled = true;
    };
    // 只在进入页面时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 中途改计划时长：本地立即生效（进度条马上变），库里也顺手更新 */
  const changePlanned = (minutes: number) => {
    setPickMinutes(false);
    if (minutes === planned) return;
    setPlanned(minutes);
    const session = sessionRef.current;
    if (!session) return;
    session.plannedMinutes = minutes;
    void saveFocusSession({ ...session, plannedMinutes: minutes });
  };

  // 计时
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  /**
   * 离开页面时兜底收尾，避免留下永远不会结束的会话。
   *
   * 刻意**不带 markDone** —— 从右上角退出去不等于"我做完了"，
   * 那只是"我不记了"。真正的完成判定只发生在用户按下「结束」那一刻。
   */
  useEffect(() => {
    return () => {
      if (finishedRef.current) return;
      const id = sessionIdRef.current;
      if (!id) return;
      void finishFocus(id, { actualSeconds: elapsedRef.current });
    };
  }, [finishFocus]);

  const finish = async () => {
    if (!sessionId || finishing) return;
    setFinishing(true);
    finishedRef.current = true;
    try {
      // "这段就算把它做完"跟着这一次落库一起走 —— 这样回执才说得准
      // （页面一退场，任何还没写进回执的动作用户都看不到了）
      await finishFocus(sessionId, {
        actualSeconds: elapsed,
        intent: intent.trim() || null,
        note: note.trim() || null,
        markDone: alsoComplete,
      });
      if (hapticsEnabled) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
    } finally {
      setFinishing(false);
      router.back();
    }
  };

  const plannedSeconds = planned * 60;
  const progress = plannedSeconds > 0 ? Math.min(1, elapsed / plannedSeconds) : 0;

  return (
    <Screen
      title="专注"
      subtitle={
        boundTask
          ? `正在做：${boundTask.title}`
          : taskId
            ? '正在读取这件事…'
            : '没绑定具体任务也可以，先专注再说'
      }
      right={
        /* 语义要能和「结束」区分开：这个出口 = 时长照记、但不标记完成 */
        <Pressable hitSlop={8} onPress={() => router.back()}>
          <ThemedText type="small" themeColor="textSecondary">
            不记了
          </ThemedText>
        </Pressable>
      }>
      {/* 主角：时间 */}
      <View style={styles.timerBlock}>
        <ThemedText style={styles.timer}>{formatDuration(elapsed)}</ThemedText>
        <View style={styles.planRow}>
          <Pressable hitSlop={8} onPress={() => setPickMinutes(true)} style={styles.planChip}>
            <Ionicons name="timer-outline" size={14} color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary">
              {running ? `计划 ${planned} 分钟` : `已暂停 · 计划 ${planned} 分钟`}
            </ThemedText>
          </Pressable>
          <ThemedText type="small" themeColor="textSecondary">
            {progress >= 1 ? '已超出计划，随时可以收工' : `完成度 ${Math.round(progress * 100)}%`}
          </ThemedText>
        </View>
      </View>

      <View style={styles.orbBlock}>
        <GrowthOrb seconds={elapsed} size={104} caption={null} />
      </View>

      {/* 名字与随手记：没有任何常驻说明 —— 输入框自己说得清。
          没绑定任务才有"名字"：起了名用名字，没起名落日历时叫「专注」。
          绑定了任务就没有这个框 —— 那个名字哪儿都不显示，是个只写不读的字段。 */}
      {!boundTask ? (
        <Card>
          <TextInput
            value={intent}
            onChangeText={setIntent}
            placeholder="这是什么事？可留空"
            placeholderTextColor={theme.textSecondary}
            style={[
              styles.input,
              { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected },
            ]}
          />
        </Card>
      ) : null}

      <Card>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="顺手记一笔：忽然想到的、卡住的地方…"
          placeholderTextColor={theme.textSecondary}
          multiline
          style={[
            styles.input,
            styles.noteInput,
            { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected },
          ]}
        />
      </Card>

      {boundTask ? (
        <Card
          title="记到这件事上"
          hint={
            boundTask.time.attribute === TimeAttribute.None
              ? '这段会顺便当成它的时间'
              : '时长累加进进度，够目标会自动完成'
          }>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <ThemedText type="smallBold">这段就算把它做完</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.switchHint}>
                {alsoComplete ? '结束时会把它标成完成' : '只记时长，不算做完'}
              </ThemedText>
            </View>
            <Switch value={alsoComplete} onValueChange={setAlsoComplete} />
          </View>
        </Card>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          onPress={() => setRunning((value) => !value)}
          style={({ pressed }) => [
            styles.secondaryButton,
            { borderColor: theme.backgroundSelected, opacity: pressed ? 0.7 : 1 },
          ]}>
          <ThemedText type="smallBold">{running ? '暂停一下' : '继续'}</ThemedText>
        </Pressable>

        <Pressable
          onPress={finish}
          disabled={finishing}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: theme.text, opacity: pressed || finishing ? 0.8 : 1 },
          ]}>
          <ThemedText type="smallBold" style={{ color: theme.background }}>
            {finishing ? '收尾中…' : '结束'}
          </ThemedText>
        </Pressable>
      </View>

      {/* 场计划时长：点「计划 N 分钟」弹出，选中即生效（不做二次确认） */}
      <ChoiceSheet
        visible={pickMinutes}
        title="这场专注计划多久"
        options={FOCUS_MINUTE_PRESETS.map((m) => ({ key: String(m), label: `${m} 分钟` }))}
        selectedKey={String(planned)}
        onSelect={(key) => changePlanned(Number(key))}
        onClose={() => setPickMinutes(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  timerBlock: { alignItems: 'center', gap: Spacing.two, paddingTop: Spacing.five },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, flexWrap: 'wrap', justifyContent: 'center' },
  planChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  timer: {
    fontSize: 64,
    lineHeight: 72,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  orbBlock: { alignItems: 'center', paddingVertical: Spacing.three },
  input: {
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
  },
  noteInput: { minHeight: 72, textAlignVertical: 'top' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  switchText: { flex: 1, gap: Spacing.half },
  switchHint: { fontSize: 12, lineHeight: 16 },
  actions: { flexDirection: 'row', gap: Spacing.three, paddingBottom: Spacing.four },
  secondaryButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
  },
  primaryButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
});
