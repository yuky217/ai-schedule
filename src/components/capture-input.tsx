import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { understandText } from '@/capabilities/client';
import { ChoiceSheet, type ChoiceOption } from '@/components/choice-sheet';
import {
  DateTimeSheet,
  describeDraft,
  draftFromTask,
  draftToTime,
  defaultDraft,
  type DateTimeDraft,
  type DateTimePreset,
} from '@/components/date-time-picker';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { Container } from '@/domain/container';
import { parseSchedule, type ParsedSchedule } from '@/domain/parse-schedule';
import { describeReminder, describeRepeat, REMINDER_PRESETS, REPEAT_PRESETS } from '@/domain/repeat-next';
import { resolveReminderMinutes } from '@/domain/reminder';
import { decideRoute } from '@/domain/routing';
import { timeAnchor, type RepeatRule, type TaskTime } from '@/domain/task';
import { useTheme } from '@/hooks/use-theme';
import { selectCapabilityGate, useSettings } from '@/state/settings-store';

/** ChoiceSheet 里「不提醒」那一项的 key */
const REMINDER_OFF = '__off__';

/**
 * 快速记录输入条 —— 入口层里最常用的那个。
 *
 * 主交互仍然只有"一个输入框 + 一排 chip"：分类、拆解、排期都不在这里问用户。
 * 四个 chip（时间 / 清单 / 重复 / 提醒）借鉴滴答清单的快捷设置：记的时候顺手定掉，
 * 省得之后再点进详情页补 —— 默认是灰的、不占视觉重量，设过之后才亮起来显示当前值。
 *
 * **时间 chip 是三合一的**（2026-10-07 减负）：以前"自动识别到的时间"单占一行文字，
 * 下方"时间"按钮又说同一件事；现在合成一个 chip —— 有手动值显示手动值，没手动值
 * 显示自动识别的结果，都没有才是占位的「时间」。点它就是把那一刻改成自己想要的，
 * 界面因此少一行，识别结果也从"只读的提示"变成了"能点能改的东西"。
 *
 * **提醒 chip 默认是"不提醒"**（2026-10-08）：它亮起来只有一种原因 ——
 * 这次真的会有通知。文字里写了（"提前半小时提醒我"，`parse-schedule` 认出来）
 * 或者用户自己点过。没提就不发通知，因为默认打扰比默认安静更难挽回：
 * 用户被无用的提醒烦到时，根本不知道去哪儿关掉它。
 */
export interface CaptureOptions {
  asIdea: boolean;
  /** 用户当场指定的时间（覆盖自动识别） */
  time?: TaskTime | null;
  containerId?: string | null;
  repeat?: RepeatRule | null;
  reminderMinutesBefore?: number | null;
  /**
   * 能力层「理解」的结果（开了 AI 才有；没开、失败、答得不成形都是 null）。
   * 拿到就**整份**交给落库那一步用，拿不到就走本地启发式 —— 两条路最终
   * 都汇进 `quickCapture` 的同一套规则里，所以不会出现"AI 一套口径、本地一套"。
   */
  parsed?: ParsedSchedule | null;
}

export interface CaptureInputProps {
  placeholder?: string;
  autoFocus?: boolean;
  submitLabel?: string;
  showIdeaToggle?: boolean;
  /** 可选的归属清单（来自 store 的容器） */
  containers?: Container[];
  /** 时间面板顶部的快捷预设（如"今天 18:00"）。不传就只有手选 */
  timePresets?: readonly DateTimePreset[];
  onSubmit: (text: string, options: CaptureOptions) => void | Promise<void>;
}

type Sheet = 'time' | 'list' | 'repeat' | 'reminder' | null;

export function CaptureInput({
  placeholder = '记一件事，或一个念头…',
  autoFocus,
  submitLabel = '记下',
  showIdeaToggle = true,
  containers,
  timePresets,
  onSubmit,
}: CaptureInputProps) {
  const theme = useTheme();
  const [text, setText] = useState('');
  const [asIdea, setAsIdea] = useState(false);
  const [busy, setBusy] = useState(false);

  /* 快捷设置的草稿：都留到提交那一刻才写库 */
  const [sheet, setSheet] = useState<Sheet>(null);
  const [time, setTime] = useState<TaskTime | null>(null);
  const [draft, setDraft] = useState<DateTimeDraft>(() => defaultDraft());
  const [containerId, setContainerId] = useState<string | null>(null);
  const [repeat, setRepeat] = useState<RepeatRule | null>(null);
  /**
   * 提醒提前量：**三态**。
   * `undefined` = 用户没动过这一格（这时才轮到"文字里写了什么"和类型默认值），
   * `null` = 用户明确选了「不提醒」（**压过文字里写的**），`number` = 用户选的具体提前量。
   */
  const [reminder, setReminder] = useState<number | null | undefined>(undefined);

  /**
   * 打字时实时解析一遍，把结果直接喂给"时间 chip"和"提醒 chip"（不再另起一行提示）。
   * 用户自己设过时间就不解析了 —— 手动的意思比识别到的更明确。
   *
   * 提醒要在这里一并算出来（而不是等落库时再算）：**chip 上显示的值必须就是
   * 最终会存进库的值**。否则又会出现"界面说提前 10 分钟、实际存的是不提醒"。
   * 所以这里做的是和 `quickCapture` 同一件事：先分流拿到类型，再过
   * `resolveReminderMinutes`（手动 > 文字写明 > 类型默认 > 不提醒）。
   */
  const parsed = useMemo(() => {
    if (asIdea || text.trim().length < 2 || time) return null;
    const result = parseSchedule(text);
    if (!result.time || !result.label) return null;
    const decision = decideRoute({ text: result.title || text, time: result.time });
    const reminder = resolveReminderMinutes({
      parsed: result.reminder,
      parsedUnspecified: result.reminderUnspecified,
      kind: decision.kind,
      attribute: result.time.attribute,
      repeat: result.repeat,
    });
    return { time: result.time, label: result.label, reminder };
  }, [text, asIdea, time]);

  /**
   * 时间 chip 显示什么：手动设的 > 自动识别的 > 占位「时间」。
   * 识别到的也让它亮起来 —— 用户能看见"系统认出了什么"，而且点一下就能改。
   */
  const timeChipTime = time ?? parsed?.time ?? null;
  const timeChipLabel = timeChipTime ? formatTimeOfTime(timeChipTime) : '时间';

  /**
   * 提醒 chip：手动的 > 文字里认出来的。**默认不提醒** ——
   * 所以它亮起来只有一种原因：这次真的会有通知（文字里写了，或用户点了）。
   */
  const reminderValue = reminder !== undefined ? reminder : (parsed?.reminder ?? null);
  const reminderLabel =
    reminder === null ? '不提醒' : reminderValue == null ? '提醒' : describeReminder(reminderValue);

  const canSubmit = text.trim().length > 0 && !busy;

  const reset = () => {
    setText('');
    setAsIdea(false);
    setTime(null);
    setContainerId(null);
    setRepeat(null);
    setReminder(undefined);
    setDraft(defaultDraft());
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      /*
       * 开了「理解」能力，就先让模型读一遍 —— 它比本地正则更认得出
       * "下周三下午的会改到周五了，提前半小时叫我"这种句子。
       *
       * 它**只是加分项**：没开、没配、网络不通、答得不成形，拿到的都是 null，
       * 原样走本地识别。AI 挂掉不能让"记一件事"这件事挂掉。
       *
       * 读的是 `getState()` 而不是订阅 —— 提交是一次性动作，
       * 没必要为它让整条输入条跟着设置重渲染（想法页/记录页都用着它）。
       */
      const recognized = asIdea
        ? null
        : await understandText(selectCapabilityGate(useSettings.getState()), text.trim());

      await onSubmit(text.trim(), {
        asIdea,
        time,
        containerId,
        repeat,
        reminderMinutesBefore: reminder,
        parsed: recognized,
      });
      reset();
    } finally {
      setBusy(false);
    }
  };

  const listOptions: ChoiceOption[] = [
    { key: '__none__', label: '不归入清单' },
    ...(containers ?? []).map((c) => ({
      key: c.id,
      label: c.title,
      hint: c.kind === 'goal' ? '目标' : c.kind === 'folder' ? '文件夹' : '项目',
    })),
  ];
  const currentContainer = (containers ?? []).find((c) => c.id === containerId) ?? null;

  const repeatOptions: ChoiceOption[] = REPEAT_PRESETS.map((p) => ({
    key: p.id,
    label: p.label,
  }));
  const currentRepeatId =
    REPEAT_PRESETS.find((p) => JSON.stringify(p.rule) === JSON.stringify(repeat))?.id ?? 'none';

  const reminderOptions: ChoiceOption[] = [
    { key: REMINDER_OFF, label: '不提醒' },
    ...REMINDER_PRESETS.map((p) => ({ key: String(p.minutes), label: p.label })),
  ];

  return (
    <View
      style={[
        styles.wrapper,
        { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected },
      ]}>
      <View style={styles.inputRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={submit}
          autoFocus={autoFocus}
          placeholder={placeholder}
          placeholderTextColor={theme.textSecondary}
          returnKeyType="done"
          multiline
          style={[styles.input, { color: theme.text }]}
        />
        <Pressable
          onPress={submit}
          disabled={!canSubmit}
          style={({ pressed }) => [
            styles.submit,
            {
              backgroundColor: canSubmit ? theme.text : theme.backgroundSelected,
              opacity: pressed ? 0.8 : 1,
            },
          ]}>
          <ThemedText
            type="smallBold"
            style={{ color: canSubmit ? theme.background : theme.textSecondary }}>
            {submitLabel}
          </ThemedText>
        </Pressable>
      </View>

      {/* 快捷设置：默认是灰的，设过之后亮起来并显示当前值。
          时间那一格同时承担"自动识别的结果"—— 所以它亮不代表用户设过，
          只代表"这条有时间了"。想改就点它，想清掉长按（只有手动值可清）。 */}
      <View style={styles.quickRow}>
        <QuickButton
          icon="time-outline"
          label={timeChipLabel}
          active={Boolean(timeChipTime)}
          onPress={() => {
            setDraft(timeChipTime ? draftFromTask({ time: timeChipTime }) : defaultDraft());
            setSheet('time');
          }}
          onClear={time ? () => setTime(null) : undefined}
        />
        <QuickButton
          icon="folder-outline"
          label={currentContainer ? currentContainer.title : '清单'}
          active={Boolean(currentContainer)}
          onPress={() => setSheet('list')}
          onClear={currentContainer ? () => setContainerId(null) : undefined}
        />
        <QuickButton
          icon="repeat-outline"
          label={repeat ? describeRepeat(repeat) : '重复'}
          active={Boolean(repeat)}
          onPress={() => setSheet('repeat')}
          onClear={repeat ? () => setRepeat(null) : undefined}
        />
        <QuickButton
          icon="notifications-outline"
          label={reminderLabel}
          active={reminderValue != null}
          onPress={() => setSheet('reminder')}
          onClear={reminder !== undefined ? () => setReminder(undefined) : undefined}
        />
      </View>

      {showIdeaToggle ? (
        <Pressable style={styles.toggleRow} onPress={() => setAsIdea((v) => !v)}>
          <View
            style={[
              styles.miniCheckbox,
              {
                borderColor: asIdea ? theme.text : theme.textSecondary,
                backgroundColor: asIdea ? theme.text : 'transparent',
              },
            ]}>
            {asIdea ? <Ionicons name="checkmark" size={11} color={theme.background} /> : null}
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            这是灵感（进想法库，不提醒）
          </ThemedText>
        </Pressable>
      ) : null}

      <DateTimeSheet
        visible={sheet === 'time'}
        value={draft}
        onChange={setDraft}
        onCancel={() => setSheet(null)}
        title="什么时候做"
        presets={timePresets}
        onConfirm={(value) => {
          const next = draftToTime(value);
          if (next) setTime(next);
          setSheet(null);
        }}
      />

      <ChoiceSheet
        visible={sheet === 'list'}
        title="归入哪个清单"
        options={listOptions}
        selectedKey={containerId ?? '__none__'}
        onClose={() => setSheet(null)}
        onSelect={(key) => {
          setContainerId(key === '__none__' ? null : key);
          setSheet(null);
        }}
      />

      <ChoiceSheet
        visible={sheet === 'repeat'}
        title="重复"
        options={repeatOptions}
        selectedKey={currentRepeatId}
        onClose={() => setSheet(null)}
        onSelect={(key) => {
          const preset = REPEAT_PRESETS.find((p) => p.id === key);
          setRepeat(preset?.rule ?? null);
          setSheet(null);
        }}
      />

      <ChoiceSheet
        visible={sheet === 'reminder'}
        title="提醒时间"
        options={reminderOptions}
        selectedKey={reminderValue == null ? REMINDER_OFF : String(reminderValue)}
        onClose={() => setSheet(null)}
        onSelect={(key) => {
          // 「不提醒」存的是 null，它不是"没设过"（undefined）—— 它会压过文字里写的提醒
          setReminder(key === REMINDER_OFF ? null : Number(key));
          setSheet(null);
        }}
      />
    </View>
  );
}

/** 把已解析出的 TaskTime 显示成"今天 14:00" */
function formatTimeOfTime(time: TaskTime): string {
  const iso = timeAnchor(time);
  if (!iso) return '时间';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '时间';
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${sameDay ? '今天' : `${d.getMonth() + 1}/${d.getDate()}`} ${hh}:${mm}`;
}

function QuickButton({
  icon,
  label,
  active,
  onPress,
  onClear,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  onPress: () => void;
  onClear?: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={active ? `${label}（点一下修改）` : label}
      onPress={onPress}
      onLongPress={onClear}
      style={[
        styles.quickButton,
        {
          backgroundColor: active ? theme.backgroundSelected : 'transparent',
          borderColor: active ? theme.backgroundSelected : theme.backgroundSelected,
        },
      ]}>
      <Ionicons
        name={icon}
        size={13}
        color={active ? theme.text : theme.textSecondary}
      />
      <ThemedText
        type="small"
        themeColor={active ? 'text' : 'textSecondary'}
        numberOfLines={1}
        style={styles.quickLabel}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.two,
  },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  input: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 120,
    paddingTop: 4,
    paddingBottom: 4,
  },
  submit: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  quickButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: '48%',
  },
  quickLabel: { fontSize: 12, lineHeight: 16, flexShrink: 1 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.one,
  },
  miniCheckbox: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
