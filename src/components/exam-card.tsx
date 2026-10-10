import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { ExamFields, examDraftFrom, examDraftSpan, type ExamDraft } from '@/components/exam-fields';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { describeEvent, type CalEvent } from '@/domain/event';
import { useTheme } from '@/hooks/use-theme';

/**
 * 日视图上"这天有几场考试"的那张卡，**并且是改/删它们的地方**（2026-10-10）。
 *
 * 为什么把编辑放在日历上而不是另开一个考试管理页：考试是按天看的，
 * "周三那场记错时间了"这个念头出现的时候，人就在日视图里。多一页专门的管理页，
 * 换来的是每次改一个数字都要先离开日历。
 *
 * 编辑是**改完自动存**（800ms 防抖），不设保存按钮 —— 与详情页/项目页
 * 输入即存同一条规矩（只靠 onBlur 的话，手势返回、安卓返回键、点 Tab 走
 * 都不会触发 blur，那一屏的字直接丢）。
 * 防抖期间不落库：打字过程中每敲一个字就写一次库、还把考试提醒全撤重排一遍，
 * 是纯粹的浪费。
 *
 * 保存前会校验（`examDraftSpan`）：名字空着、时刻认不出、结束早于开始 ——
 * 这三种状态一律**不写库**，让用户继续改。半个小时后他发现考试时间变成了
 * 自己没打过的数字，比"没保存上"难解释得多。
 */
export interface ExamCardProps {
  exams: readonly CalEvent[];
  onUpdate: (id: string, patch: Partial<CalEvent>) => Promise<void> | void;
  onRemove: (id: string) => Promise<void> | void;
}

const SAVE_DEBOUNCE_MS = 800;

export function ExamCard({ exams, onUpdate, onRemove }: ExamCardProps) {
  const theme = useTheme();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ExamDraft | null>(null);

  /** 展开那一刻的快照：没改动就不该写库（写一次就够把提醒全撤重排一遍） */
  const openedRef = useRef<ExamDraft | null>(null);
  /** 回调放 ref：否则父层每次渲染换个新函数，都会把防抖重新计时 */
  const updateRef = useRef(onUpdate);
  updateRef.current = onUpdate;

  const open = useCallback((event: CalEvent) => {
    const next = examDraftFrom(event);
    openedRef.current = next;
    setDraft(next);
    setEditingId(event.id);
  }, []);

  const close = useCallback(() => {
    setEditingId(null);
    setDraft(null);
    openedRef.current = null;
  }, []);

  useEffect(() => {
    if (!editingId || !draft || !openedRef.current) return;
    if (sameDraft(draft, openedRef.current)) return;

    const span = examDraftSpan(draft);
    const title = draft.title.trim();
    if (!span || !title) return;

    const timer = setTimeout(() => {
      openedRef.current = { ...draft };
      void updateRef.current(editingId, {
        title,
        startAt: span.startAt,
        endAt: span.endAt,
        location: draft.location.trim() || null,
      });
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, editingId]);

  return (
    <Card title={`考试 · ${exams.length} 场`} hint="考试不带完成态。点一下可以改时间、地点，或者删掉">
      {exams.map((event) => {
        const isEditing = editingId === event.id;
        return (
          <View key={event.id} style={styles.item}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${event.title}，${describeEvent(event)}`}
              onPress={() => (isEditing ? close() : open(event))}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' },
              ]}>
              <ThemedText type="smallBold" numberOfLines={1} style={styles.title}>
                {event.title}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {describeEvent(event)}
              </ThemedText>
              <Ionicons
                name={isEditing ? 'chevron-up' : 'chevron-down'}
                size={13}
                color={theme.textSecondary}
              />
            </Pressable>

            {isEditing && draft ? (
              <View style={styles.editor}>
                <ExamFields draft={draft} onChange={setDraft} />
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    close();
                    void onRemove(event.id);
                  }}
                  style={({ pressed }) => [
                    styles.danger,
                    { borderColor: theme.backgroundSelected, opacity: pressed ? 0.6 : 1 },
                  ]}>
                  <ThemedText type="small" themeColor="textSecondary">
                    删掉这场考试
                  </ThemedText>
                </Pressable>
              </View>
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}

/** 两个草稿是不是一样（Date 需要比时刻，不能比引用） */
function sameDraft(a: ExamDraft, b: ExamDraft): boolean {
  return (
    a.title === b.title &&
    a.startText === b.startText &&
    a.endText === b.endText &&
    a.location === b.location &&
    a.date.getTime() === b.date.getTime()
  );
}

const styles = StyleSheet.create({
  item: { gap: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two,
  },
  title: { flex: 1 },
  editor: { gap: Spacing.two, paddingBottom: Spacing.one },
  danger: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
