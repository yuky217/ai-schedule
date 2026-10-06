import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { MonthPicker } from '@/components/month-picker';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { Mark } from '@/domain/container';
import { MarkKind } from '@/domain/enums';
import { describeMark, sortMarkViews } from '@/domain/marks';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';
import { dayKeyOf, parseDayKey } from '@/utils/datetime';

/**
 * 纪念日（主文档 5.3 的"标记"）。
 *
 * 它是**独立于任务**的一种东西：不提醒、不排程、不进收集箱。
 * 倒数日（还剩几天）和正数日（已经多少天）是两种完全不同的情绪 ——
 * 前者是期待，后者是坚持，所以列表里正数日排在后面，不去抢"即将发生"的位置。
 *
 * 一个细节：开了"每年重复"的倒数日会自动滚到下一次周年，
 * 所以生日、结婚纪念这类日子只需要录一次。
 */
export default function MarksScreen() {
  const theme = useTheme();
  const router = useRouter();

  const marks = useAppStore((state) => state.marks);
  const createMark = useAppStore((state) => state.createMark);
  const updateMark = useAppStore((state) => state.updateMark);
  const removeMark = useAppStore((state) => state.removeMark);

  const [creating, setCreating] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftKind, setDraftKind] = useState<MarkKind>(MarkKind.Countdown);
  const [draftDate, setDraftDate] = useState<string | null>(null);
  const [draftDateEditing, setDraftDateEditing] = useState(false);
  const [draftYearly, setDraftYearly] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState(false);

  const views = useMemo(() => sortMarkViews(marks.map((mark) => describeMark(mark))), [marks]);
  const editing = marks.find((mark) => mark.id === editingId) ?? null;

  const resetDraft = () => {
    setDraftTitle('');
    setDraftKind(MarkKind.Countdown);
    setDraftDate(null);
    setDraftYearly(false);
    setDraftDateEditing(false);
  };

  const submit = async () => {
    const title = draftTitle.trim();
    const date = draftDate ?? dayKeyOf(new Date().toISOString());
    if (!title || !date) return;
    await createMark({ title, kind: draftKind, date, repeatYearly: draftYearly });
    resetDraft();
    setCreating(false);
  };

  return (
    <Screen
      title="纪念日"
      subtitle="不提醒、不催办，只把日子摆在你眼前"
      right={
        <Pressable hitSlop={8} onPress={() => setCreating((value) => !value)}>
          <Ionicons name={creating ? 'close' : 'add'} size={24} color={theme.text} />
        </Pressable>
      }>
      {creating ? (
        <Card title="加一个日子">
          <TextInput
            value={draftTitle}
            onChangeText={setDraftTitle}
            placeholder="是什么日子"
            placeholderTextColor={theme.textSecondary}
            autoFocus
            style={[
              styles.input,
              {
                color: theme.text,
                backgroundColor: theme.background,
                borderColor: theme.backgroundSelected,
              },
            ]}
          />

          <View style={styles.chips}>
            <Chip
              label="还剩几天"
              active={draftKind === MarkKind.Countdown}
              theme={theme}
              onPress={() => setDraftKind(MarkKind.Countdown)}
            />
            <Chip
              label="已经多少天"
              active={draftKind === MarkKind.CountUp}
              theme={theme}
              onPress={() => setDraftKind(MarkKind.CountUp)}
            />
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() => setDraftDateEditing((value) => !value)}
            style={({ pressed }) => [
              styles.settingRow,
              { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
            ]}>
            <Ionicons name="calendar-outline" size={16} color={theme.textSecondary} />
            <ThemedText type="small">
              {draftDate ? draftDate.replace(/-/g, '/') : '选一天'}
            </ThemedText>
            <Ionicons name="chevron-forward" size={14} color={theme.textSecondary} />
          </Pressable>
          {draftDateEditing ? (
            <MonthPicker
              value={draftDate}
              onChange={(key) => setDraftDate(key)}
              onDone={() => setDraftDateEditing(false)}
            />
          ) : null}

          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <ThemedText type="smallBold">每年重复</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
                生日、纪念日这类只需要录一次
              </ThemedText>
            </View>
            <Switch value={draftYearly} onValueChange={setDraftYearly} />
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() => void submit()}
            style={({ pressed }) => [
              styles.primary,
              { backgroundColor: theme.text, opacity: pressed ? 0.8 : 1 },
            ]}>
            <ThemedText type="smallBold" style={{ color: theme.background }}>
              记下来
            </ThemedText>
          </Pressable>
        </Card>
      ) : null}

      {views.length ? (
        <View style={styles.list}>
          {views.map((view) => {
            const isEditing = editingId === view.mark.id;
            return (
              <View key={view.mark.id} style={styles.item}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${view.mark.title}，${view.headline}${view.caption}`}
                  onPress={() => {
                    setEditingId(isEditing ? null : view.mark.id);
                    setEditingDate(false);
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
                  ]}>
                  <View style={styles.dayBlock}>
                    <ThemedText style={styles.headline}>{view.headline}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.caption}>
                      {view.caption}
                    </ThemedText>
                  </View>
                  <View style={styles.rowBody}>
                    <ThemedText type="smallBold" numberOfLines={2}>
                      {view.mark.title}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
                      {view.mark.date.replace(/-/g, '/')}
                      {view.mark.repeatYearly ? ' · 每年' : ''}
                      {view.mark.kind === MarkKind.CountUp ? ' · 正数' : ' · 倒数'}
                    </ThemedText>
                  </View>
                  <Ionicons
                    name={isEditing ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={theme.textSecondary}
                  />
                </Pressable>

                {isEditing && editing ? (
                  <Card>
                    <TextInput
                      defaultValue={editing.title}
                      onEndEditing={(e) => {
                        const next = e.nativeEvent.text.trim();
                        if (next && next !== editing.title) void updateMark(editing.id, { title: next });
                      }}
                      placeholder="是什么日子"
                      placeholderTextColor={theme.textSecondary}
                      style={[
                        styles.input,
                        {
                          color: theme.text,
                          backgroundColor: theme.background,
                          borderColor: theme.backgroundSelected,
                        },
                      ]}
                    />

                    <View style={styles.chips}>
                      <Chip
                        label="还剩几天"
                        active={editing.kind === MarkKind.Countdown}
                        theme={theme}
                        onPress={() => void updateMark(editing.id, { kind: MarkKind.Countdown })}
                      />
                      <Chip
                        label="已经多少天"
                        active={editing.kind === MarkKind.CountUp}
                        theme={theme}
                        onPress={() => void updateMark(editing.id, { kind: MarkKind.CountUp })}
                      />
                    </View>

                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setEditingDate((value) => !value)}
                      style={({ pressed }) => [
                        styles.settingRow,
                        { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
                      ]}>
                      <Ionicons name="calendar-outline" size={16} color={theme.textSecondary} />
                      <ThemedText type="small">{editing.date.replace(/-/g, '/')}</ThemedText>
                      <Ionicons name="chevron-forward" size={14} color={theme.textSecondary} />
                    </Pressable>
                    {editingDate ? (
                      <MonthPicker
                        value={editing.date}
                        onChange={(key) => {
                          if (key) void updateMark(editing.id, { date: key });
                        }}
                        onDone={() => setEditingDate(false)}
                      />
                    ) : null}

                    <View style={styles.switchRow}>
                      <View style={styles.switchText}>
                        <ThemedText type="smallBold">每年重复</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
                          倒数日会自动滚到下一次周年
                        </ThemedText>
                      </View>
                      <Switch
                        value={editing.repeatYearly}
                        onValueChange={(value) => void updateMark(editing.id, { repeatYearly: value })}
                      />
                    </View>

                    <Pressable
                      accessibilityRole="button"
                      onPress={async () => {
                        await removeMark(editing.id);
                        setEditingId(null);
                      }}
                      style={({ pressed }) => [
                        styles.danger,
                        { borderColor: theme.backgroundSelected, opacity: pressed ? 0.6 : 1 },
                      ]}>
                      <ThemedText type="small" themeColor="textSecondary">
                        删除这个纪念日
                      </ThemedText>
                    </Pressable>
                  </Card>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : (
        <EmptyState
          icon="heart-outline"
          title="还没有纪念日"
          hint="点右上角的加号，记一个还剩几天的日子，或者已经坚持了多少天"
        />
      )}

      <Card>
        <View style={styles.tipRow}>
          <Ionicons name="information-circle-outline" size={16} color={theme.textSecondary} />
          <ThemedText type="small" themeColor="textSecondary" style={styles.tipText}>
            纪念日独立于任务：不占日历、不提醒、不进收集箱，只是让日子有个地方待着。
            首页会挑几个最近要发生的显示出来。
          </ThemedText>
        </View>
      </Card>

      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backRow}>
        <ThemedText type="small" themeColor="textSecondary">
          返回
        </ThemedText>
      </Pressable>
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
  list: { gap: Spacing.two },
  item: { gap: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  dayBlock: { alignItems: 'center', minWidth: 56 },
  headline: { fontSize: 22, lineHeight: 26, fontWeight: '700', fontVariant: ['tabular-nums'] },
  caption: { fontSize: 10, lineHeight: 13 },
  rowBody: { flex: 1, gap: Spacing.half },
  input: {
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 14,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
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
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  switchText: { flex: 1, gap: Spacing.half },
  footnote: { fontSize: 12, lineHeight: 16, opacity: 0.8 },
  primary: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
  },
  danger: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tipRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  tipText: { flex: 1, lineHeight: 18 },
  backRow: { alignItems: 'center', paddingVertical: Spacing.two },
});
