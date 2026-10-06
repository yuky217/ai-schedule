import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import { Card } from '@/components/card';
import { GrowthOrb } from '@/components/growth-orb';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
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
  const completeTask = useAppStore((state) => state.completeTask);
  const loadTask = useAppStore((state) => state.loadTask);

  const [boundTask, setBoundTask] = useState<Task | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(true);
  const [intent, setIntent] = useState('');
  const [note, setNote] = useState('');
  const [alsoComplete, setAlsoComplete] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const elapsedRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
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
      if (!cancelled) setSessionId(session.id);
    })();
    return () => {
      cancelled = true;
    };
    // 只在进入页面时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 计时
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  // 离开页面时兜底收尾，避免留下永远不会结束的会话
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
      await finishFocus(sessionId, {
        actualSeconds: elapsed,
        intent: intent.trim() || null,
        note: note.trim() || null,
      });
      // 用户明确勾了"这段就算把它做完"，才替他把状态推过去
      if (alsoComplete && boundTask) {
        await completeTask(boundTask.id);
      }
      if (hapticsEnabled) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
    } finally {
      setFinishing(false);
      router.back();
    }
  };

  const plannedSeconds = defaultMinutes * 60;
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
      scroll={false}
      right={
        <Pressable hitSlop={8} onPress={() => router.back()}>
          <Ionicons name="chevron-down" size={24} color={theme.textSecondary} />
        </Pressable>
      }>
      {/* 主角：时间 */}
      <View style={styles.timerBlock}>
        <ThemedText style={styles.timer}>{formatDuration(elapsed)}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {running ? `计划 ${defaultMinutes} 分钟` : '已暂停'} ·
          {progress >= 1 ? ' 已经超出计划，随时可以收工' : ` 完成度 ${Math.round(progress * 100)}%`}
        </ThemedText>
      </View>

      <View style={styles.orbBlock}>
        <GrowthOrb
          seconds={elapsed}
          size={104}
          caption={`这段生长了 ${formatDuration(elapsed)}`}
        />
      </View>

      <Card>
        <ThemedText type="small" themeColor="textSecondary">
          结束时给这段起个名字（也可以留空）
        </ThemedText>
        <TextInput
          value={intent}
          onChangeText={setIntent}
          placeholder={boundTask ? boundTask.title : '这是什么事？'}
          placeholderTextColor={theme.textSecondary}
          style={[
            styles.input,
            { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected },
          ]}
        />
        <ThemedText type="small" themeColor="textSecondary">
          专注中记一笔（会绑定在这件事下，不影响全局随手记）
        </ThemedText>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="忽然想到的、卡住的地方…"
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
        <Card title="记到这件事上" hint="这段时长会累加进它的进度，够目标就自动完成">
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <ThemedText type="smallBold">这段就算把它做完</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.switchHint}>
                关掉就只记时长，完成与否你自己决定
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  timerBlock: { alignItems: 'center', gap: Spacing.two, paddingTop: Spacing.five },
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
