import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { SCRAPE_SCRIPT, setScrapedText, type ScrapePayload } from '@/entry/scrape-timetable';
import { useTheme } from '@/hooks/use-theme';

/**
 * 在 App 里打开教务系统，把课表抓下来。
 *
 * 为什么要有这一页：教务系统的课表**只在页面上是完整的**。复制成文字之后
 * "哪一格属于星期几"就丢了（7 天是 7 列，空白的格子什么都不剩），
 * 用户只能一条条点星期。而成熟课表软件（WakeUp、超级课程表）走的都是
 * "在 App 里登录 → 打开课表页 → 点导入"这条路：页面上的位置信息还在。
 *
 * 抓完**不在这里落库** —— 只把文本交给导入页，跟粘贴进来的一模一样地
 * 预览、核对、导入。导入只有一条路，才不会有第二套逻辑悄悄跑偏。
 */
const LAST_URL = 'http://'; // 会话内记住上次填的地址，省得每次重敲

export default function ImportBrowserScreen() {
  const theme = useTheme();
  const router = useRouter();
  const webRef = useRef<WebView>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [address, setAddress] = useState(LAST_URL);
  const [target, setTarget] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const open = useCallback(() => {
    const trimmed = address.trim();
    if (!trimmed) return;
    const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    setAddress(url);
    setTarget(url);
    setNote(null);
    setLoading(true);
  }, [address]);

  /**
   * 抓取。
   *
   * 网页那边是**异步**回话的（`postMessage`），所以这里挂一个兜底定时器：
   * 页面里的脚本万一抛错或被 CSP 拦了，按钮不能永远停在"正在读…"。
   */
  const scrape = useCallback(() => {
    if (!target) return;
    setBusy(true);
    setNote('正在读这一页的课表…');
    webRef.current?.injectJavaScript(SCRAPE_SCRIPT);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setBusy(false);
      setNote('没能读到页面内容。确认课表已经显示出来、再点一次；如果一直不行，就用「课表文本」那条路复制粘贴。');
    }, 6000);
  }, [target]);

  const onMessage = useCallback(
    (event: { nativeEvent: { data: string } }) => {
      if (timer.current) clearTimeout(timer.current);
      setBusy(false);
      let payload: ScrapePayload | null = null;
      try {
        payload = JSON.parse(event.nativeEvent.data) as ScrapePayload;
      } catch {
        payload = null;
      }
      if (!payload) {
        setNote('页面回过来的内容看不懂，再点一次试试。');
        return;
      }
      if (!payload.ok || !payload.text) {
        setNote(payload.reason ?? '没读到课表。');
        return;
      }
      // 抓到的文本交给导入页 —— 剩下的路跟粘贴进来的一模一样
      setScrapedText(payload.text);
      router.replace('/import-courses');
    },
    [router],
  );

  return (
    <Screen
      title="从教务系统抓取"
      subtitle={target ? undefined : '填上网址，登录后打开课表页，再点下面那个按钮'}
      scroll={false}
      right={
        <Pressable hitSlop={8} onPress={() => router.back()}>
          <Ionicons name="close" size={24} color={theme.text} />
        </Pressable>
      }
      bottomBar={
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !target || busy }}
          disabled={!target || busy}
          onPress={scrape}
          style={({ pressed }) => [
            styles.primary,
            { backgroundColor: theme.text, opacity: !target ? 0.35 : pressed ? 0.8 : 1 },
          ]}>
          <ThemedText type="smallBold" style={{ color: theme.background }}>
            {busy ? '正在读这一页…' : '抓这一页的课表'}
          </ThemedText>
        </Pressable>
      }>
      <View style={styles.addressRow}>
        <TextInput
          value={address}
          onChangeText={setAddress}
          onSubmitEditing={open}
          placeholder="教务系统网址"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          style={[
            styles.input,
            { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected },
          ]}
        />
        <Pressable
          accessibilityRole="button"
          onPress={open}
          style={({ pressed }) => [
            styles.openButton,
            { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 },
          ]}>
          <ThemedText type="small">打开</ThemedText>
        </Pressable>
      </View>

      {note ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
          {note}
        </ThemedText>
      ) : null}

      <View style={[styles.frame, { borderColor: theme.backgroundSelected }]}>
        {target ? (
          <WebView
            ref={webRef}
            source={{ uri: target }}
            onMessage={onMessage}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            javaScriptEnabled
            domStorageEnabled
            thirdPartyCookiesEnabled
            sharedCookiesEnabled
            // 教务系统的链接常常是"新窗口打开"，不拦的话会跳出去、这一页就空了
            setSupportMultipleWindows={false}
            originWhitelist={['*']}
            style={styles.web}
          />
        ) : (
          <View style={styles.placeholder}>
            <Ionicons name="globe-outline" size={22} color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary">
              上面填网址（比如 jw.xxx.edu.cn），点「打开」
            </ThemedText>
          </View>
        )}
        {target && loading ? (
          <View style={styles.loading} pointerEvents="none">
            <ActivityIndicator />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  input: {
    flex: 1,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    fontSize: 14,
    lineHeight: 20,
  },
  openButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  note: { fontSize: 12, lineHeight: 17, opacity: 0.8 },
  frame: {
    flex: 1,
    minHeight: 320,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  web: { flex: 1, backgroundColor: 'transparent' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  loading: { position: 'absolute', top: Spacing.two, left: 0, right: 0, alignItems: 'center' },
  primary: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
});
