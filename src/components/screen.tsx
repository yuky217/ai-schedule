import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSettings } from '@/state/settings-store';

/**
 * 页面外壳：统一安全区、页头、最大宽度与底部留白。
 *
 * 所有页面都用它，是为了让"门面最简单"这条原则有个物理落点 ——
 * 页面之间只差中间那块内容，标题字号、间距、留白不会各写各的。
 *
 * **简约模式在这里落地**（副标题那一行）：它是"全局显示偏好"，
 * 由外壳统一执行，比让每个页面各写一遍 `simple ? null : subtitle` 靠谱 ——
 * 后者一定会漏掉某几个页面，而且漏掉的地方没人会发现。
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
  /**
   * 悬浮在内容之上、**不随页面滚动**的元素（首页那颗「＋」）。
   * 摆在右下角，并与内容列同宽，宽屏上不会飘到屏幕最右边去。
   */
  floating?: ReactNode;
  /**
   * 常驻底栏：**不随页面滚动**的主操作（详情页的「开始专注 / 完成」）。
   *
   * 它是滚动区的**兄弟节点**、不是浮在上面的 —— 这样不必再算"内容被遮住多少、
   * 底部该留多少 padding"，两处数字永远对得上。
   */
  bottomBar?: ReactNode;
  /**
   * 盖在整页之上的一层（日历页从右侧拉出的收集箱抽屉）。
   *
   * 它排在最后 = 在最上面，连底栏和悬浮按钮都盖得住 ——
   * 拉出来的这层是"临时的一层"，那时候用户眼里只有它。
   * 容器本身 pointerEvents 是 box-none，空白处的点击照旧穿透到页面。
   */
  overlay?: ReactNode;
}

export function Screen({
  title,
  subtitle,
  right,
  children,
  scroll = true,
  scrollEnabled = true,
  contentStyle,
  floating,
  bottomBar,
  overlay,
}: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const simpleMode = useSettings((state) => state.simpleMode);

  const body = (
    <View style={[styles.content, contentStyle]}>
      {title || right ? (
        <View style={styles.header}>
          <View style={styles.headerText}>
            {title ? <ThemedText type="subtitle">{title}</ThemedText> : null}
            {subtitle && !simpleMode ? (
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
        {bottomBar ? (
          <View
            style={[
              styles.bottomBar,
              {
                backgroundColor: theme.background,
                borderTopColor: theme.backgroundSelected,
                paddingBottom: Spacing.three + insets.bottom,
              },
            ]}>
            <View style={styles.bottomBarInner}>{bottomBar}</View>
          </View>
        ) : null}
        {/*
          悬浮层盖在滚动区之上（同一个父节点里排在后面 = 在上面）。
          box-none 让空白处的点击照旧穿透到下面的内容，只有按钮本身接得住。
        */}
        {floating ? (
          <View style={styles.floatingLayer} pointerEvents="box-none">
            <View
              style={[styles.floatingInner, { maxWidth: MaxContentWidth }]}
              pointerEvents="box-none">
              {floating}
            </View>
          </View>
        ) : null}
        {overlay ? (
          <View style={styles.overlayLayer} pointerEvents="box-none">
            {overlay}
          </View>
        ) : null}
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
  bottomBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  bottomBarInner: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  // 四边手写：RN 0.86 的类型里没有 absoluteFillObject
  floatingLayer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  overlayLayer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  floatingInner: {
    flex: 1,
    width: '100%',
    alignSelf: 'center',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    paddingHorizontal: Spacing.four,
    // 抬到 Tab 栏上面，别压着导航
    paddingBottom: BottomTabInset + Spacing.three,
  },
});
