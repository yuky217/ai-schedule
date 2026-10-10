import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { MonthPicker } from '@/components/month-picker';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { buildEventSpan, type CalEvent } from '@/domain/event';
import { describeClock, parseClock } from '@/domain/timetable';
import { useTheme } from '@/hooks/use-theme';
import { parseDayKey, toDayKey } from '@/utils/datetime';

/**
 * 一场考试的四个字段：名字、哪天、几点到几点、在哪。
 *
 * 抽成独立组件是因为有两处要填同样的东西：**手动加一场考试**
 * （`exam-sheet`，从导入考试页进）和**改一场已经有的**（`exam-card` 的展开态）。
 * 两处各写一遍的话，"结束时间不能早于开始"这类判断迟早只在一边生效。
 *
 * ## 两个刻意的决定
 *
 * 1. **时刻用打字而不是滚轮。** 考试的时间用户手里就是现成的数字
 *    （"7月8日下午两点半开考"），让他先滚 14 下小时轮再滚 30 下分钟轮，
 *    不如打四个字符。作息表那边（`clock-sheet`）用的是同一套判断。
 * 2. **地点不设必填样式。** 教务数据里也常有缺席的考场，手动加的时候
 *    还没定考场更是常事 —— 留空就不只是"少填一个字段"。
 */
export interface ExamDraft {
  title: string;
  date: Date;
  /** 文本形式的时刻（'14:30'）：用户打到一半也算合法的中间态 */
  startText: string;
  endText: string;
  location: string;
}

/** 考试常见时段：上午 9:00 开考、两小时 */
export const EXAM_DEFAULT_START_MINUTES = 9 * 60;
export const EXAM_DEFAULT_MINUTES = 120;

/** 新课草稿：日期由调用方给（当前正对着的那天） */
export function defaultExamDraft(date: Date): ExamDraft {
  return {
    title: '',
    date,
    startText: describeClock(EXAM_DEFAULT_START_MINUTES),
    endText: describeClock(EXAM_DEFAULT_START_MINUTES + EXAM_DEFAULT_MINUTES),
    location: '',
  };
}

/** 从已有的一场考试回到草稿（改的时候用） */
export function examDraftFrom(event: CalEvent): ExamDraft {
  const start = new Date(event.startAt);
  const end = event.endAt ? new Date(event.endAt) : null;
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = end ? end.getHours() * 60 + end.getMinutes() : startMinutes + EXAM_DEFAULT_MINUTES;
  return {
    title: event.title,
    date: start,
    startText: describeClock(startMinutes),
    endText: describeClock(endMinutes),
    location: event.location ?? '',
  };
}

/**
 * 草稿 → 落库用的起止时刻。
 *
 * 认不出时刻、或者结束不晚于开始 → null。**不替用户补一个值**：
 * 把"14:00 到 13:00"顺手改成"14:00 到 15:00"会让他以为自动纠正过，
 * 而真正该做的是把按钮灰着，让他看见还差点什么。
 */
export function examDraftSpan(draft: ExamDraft): { startAt: string; endAt: string } | null {
  const start = parseClock(draft.startText);
  const end = parseClock(draft.endText);
  if (start == null || end == null) return null;
  return buildEventSpan(draft.date, start, end);
}

export interface ExamFieldsProps {
  draft: ExamDraft;
  onChange: (next: ExamDraft) => void;
  /** 新建时自动聚焦标题；编辑已有的时不抢焦点 */
  autoFocusTitle?: boolean;
}

export function ExamFields({ draft, onChange, autoFocusTitle }: ExamFieldsProps) {
  const theme = useTheme();
  const [dateOpen, setDateOpen] = useState(false);

  const field = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];

  return (
    <View style={styles.wrap}>
      <TextInput
        autoFocus={autoFocusTitle}
        value={draft.title}
        onChangeText={(title) => onChange({ ...draft, title })}
        placeholder="考什么？"
        placeholderTextColor={theme.textSecondary}
        returnKeyType="done"
        style={field}
      />

      <Pressable
        accessibilityRole="button"
        onPress={() => setDateOpen((open) => !open)}
        style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
        <Ionicons name="calendar-outline" size={15} color={theme.textSecondary} />
        <ThemedText type="small" style={styles.grow}>
          {format(draft.date, 'M月d日 EEE', { locale: zhCN })}
        </ThemedText>
        <Ionicons name="chevron-forward" size={13} color={theme.textSecondary} />
      </Pressable>
      {dateOpen ? (
        <MonthPicker
          value={toDayKey(draft.date)}
          onChange={(key) => {
            const picked = parseDayKey(key);
            if (picked) onChange({ ...draft, date: picked });
          }}
          onDone={() => setDateOpen(false)}
        />
      ) : null}

      <View style={styles.timeRow}>
        <TextInput
          value={draft.startText}
          onChangeText={(startText) => onChange({ ...draft, startText })}
          keyboardType="numbers-and-punctuation"
          returnKeyType="done"
          style={[field, styles.clock, styles.clockInput]}
        />
        <ThemedText type="small" themeColor="textSecondary">
          –
        </ThemedText>
        <TextInput
          value={draft.endText}
          onChangeText={(endText) => onChange({ ...draft, endText })}
          keyboardType="numbers-and-punctuation"
          returnKeyType="done"
          style={[field, styles.clock, styles.clockInput]}
        />
        <ThemedText type="small" themeColor="textSecondary" style={styles.grow}>
          开考 · 结束
        </ThemedText>
      </View>

      <TextInput
        value={draft.location}
        onChangeText={(location) => onChange({ ...draft, location })}
        placeholder="在哪考（可不填）"
        placeholderTextColor={theme.textSecondary}
        returnKeyType="done"
        style={field}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  input: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  grow: { flex: 1 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  clock: { textAlign: 'center', fontVariant: ['tabular-nums'] },
  clockInput: { width: 72, paddingHorizontal: Spacing.one },
});
