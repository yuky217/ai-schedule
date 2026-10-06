import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * 页面外壳：统一安全区、页头、最大宽度与底部留白。
 *
 * 所有页面都用它，是为了让"门面最简单"这条原则有个物理落点 ——
 * 页面之间只差中间那块内容，标题字号、间距、留白不会各写各的。
 */
export interface ScreenProps {
  title?: string;
  subtitle?: string;
  /** 页头右侧的操作区（如设置按钮） */
  right?: ReactNode;
  children: ReactNode;
  scroll?: boolean;
  /** 拖拽期间传 false，避免手指竖直移动时页面跟着滚 */
  scrollEnabled?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}

export function Screen({
  title,
  subtitle,
  right,
  children,
  scroll = true,
  scrollEnabled = true,
  contentStyle,
}: ScreenProps) {
  const theme = useTheme();

  const body = (
    <View style={[styles.content, contentStyle]}>
      {title || right ? (
        <View style={styles.header}>
          <View style={styles.headerText}>
            {title ? <ThemedText type="subtitle">{title}</ThemedText> : null}
            {subtitle ? (
              <ThemedText type="small" themeColor="textSecondary">
                {subtitle}
              </ThemedText>
            ) : null}
          </View>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        {scroll ? (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            scrollEnabled={scrollEnabled}
            keyboardShouldPersistTaps="handled">
            {body}
          </ScrollView>
        ) : (
          body
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: BottomTabInset + Spacing.five,
  },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.four,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  headerText: { flex: 1, gap: Spacing.one },
});
