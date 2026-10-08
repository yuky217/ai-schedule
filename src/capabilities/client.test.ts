import { createServer, type IncomingMessage, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AiCallError, callCapability, chatCompletion, extractJson, resolveChatEndpoint } from './client';
import {
  AiCapability,
  AiDisabledError,
  defaultCapabilityFlags,
  type AiConfig,
} from './types';

/**
 * 接真实模型这条链路，**用真的 HTTP 服务来验**（2026-10-08）。
 *
 * 为什么不 mock fetch：这条链路上出错的概率全在"真实网络"这一侧 ——
 * 地址拼错、鉴权头写错、超时没收住、服务端错误体没解析、模型给的不是纯净 JSON。
 * mock 掉 fetch 等于把这些全部换成"我以为的样子"，测了个寂寞。
 * 所以这里起一个本地服务，让 `fetch` 真的发一次出去。
 *
 * 服务端按路径扮演不同的服务商行为（正常 / 密钥错 / 返回废话 / 不回话），
 * 于是"用户会遇到的那几种失败"在测试里都是真的遇到过的。
 */

interface CapturedRequest {
  path: string;
  authorization: string | undefined;
  body: {
    model?: string;
    messages?: { role: string; content: string }[];
  };
}

let server: Server;
let baseUrl = '';
const captured: CapturedRequest[] = [];

/** 模型"想"返回的东西，由各用例改写 */
let modelReply = '{"title":"开会","timeKind":"none"}';
let replyStatus = 200;
let hangForever = false;

/** 一个完整的日程结果，模拟真实模型对"下周三下午3点开会，提前半小时提醒我"的回答 */
const GOOD_REPLY = JSON.stringify({
  title: '开会',
  timeKind: 'fixed',
  startAt: '2026-10-14T15:00',
  endAt: null,
  dueAt: null,
  timeLabel: '10月14日 15:00',
  location: null,
  repeat: null,
  reminderSpecified: true,
  reminderMinutes: 30,
  note: null,
});

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: CapturedRequest['body'] = {};
      try {
        body = JSON.parse(raw) as CapturedRequest['body'];
      } catch {
        // 保持空对象
      }
      captured.push({
        path: new URL(req.url ?? '/', 'http://127.0.0.1').pathname,
        authorization: req.headers.authorization,
        body,
      });

      if (hangForever) return; // 不回话，用来验超时

      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      if (replyStatus !== 200) {
        send(replyStatus, { error: { message: 'Invalid API key provided' } });
        return;
      }
      send(200, { choices: [{ message: { role: 'assistant', content: modelReply } }] });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return { endpoint: baseUrl, apiKey: 'sk-test', model: 'glm-4.7-flash', ...overrides };
}

function gate(
  overrides: Partial<AiConfig> = {},
  capabilities: AiCapability[] = [AiCapability.Understand],
) {
  const enabled = defaultCapabilityFlags();
  for (const capability of capabilities) enabled[capability] = true;
  return { enabled, config: config(overrides) };
}

beforeEach(() => {
  captured.length = 0;
  modelReply = GOOD_REPLY;
  replyStatus = 200;
  hangForever = false;
});

describe('resolveChatEndpoint', () => {
  it('填 base_url 会自动补上 /chat/completions（DeepSeek、智谱两种形态都能直接粘）', () => {
    expect(resolveChatEndpoint('https://api.deepseek.com')).toBe(
      'https://api.deepseek.com/chat/completions',
    );
    expect(resolveChatEndpoint('https://open.bigmodel.cn/api/paas/v4/')).toBe(
      'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    );
  });

  it('已经写了完整路径就原样用', () => {
    expect(resolveChatEndpoint('https://x.example.com/v1/chat/completions')).toBe(
      'https://x.example.com/v1/chat/completions',
    );
  });
});

describe('chatCompletion', () => {
  it('真的把请求发出去了：地址、鉴权头、模型名都对', async () => {
    await chatCompletion(config(), [{ role: 'user', content: '你好' }]);

    expect(captured).toHaveLength(1);
    expect(captured[0]!.path).toBe('/chat/completions');
    expect(captured[0]!.authorization).toBe('Bearer sk-test');
    expect(captured[0]!.body.model).toBe('glm-4.7-flash');
    expect(captured[0]!.body.messages?.[0]).toEqual({ role: 'user', content: '你好' });
  });

  it('密钥不对：把服务商的原话带回来给用户看（否则手机上只会显示"失败了"）', async () => {
    replyStatus = 401;
    await expect(chatCompletion(config(), [{ role: 'user', content: 'hi' }])).rejects.toThrow(
      /401.*Invalid API key/,
    );
  });

  it('等不到回应就超时，并说清楚是网络问题', async () => {
    hangForever = true;
    await expect(
      chatCompletion(config(), [{ role: 'user', content: 'hi' }], { timeoutMs: 200 }),
    ).rejects.toThrow(/没回应/);
  });
});

describe('extractJson', () => {
  it('包了 ```json 围栏也认（模型最常见的自作主张）', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('前后夹了一句客套也认', () => {
    expect(extractJson('好的，结果如下：{"a":2} 希望有帮助')).toEqual({ a: 2 });
  });

  it('真不是 JSON 就返回 null', () => {
    expect(extractJson('今天天气不错')).toBeNull();
  });
});

describe('callCapability（理解）', () => {
  it('没开启 → AiDisabledError（界面据此降级到本地识别）', async () => {
    const g = { enabled: defaultCapabilityFlags(), config: config() };
    await expect(callCapability(g, { capability: AiCapability.Understand, text: '开会' })).rejects.toThrow(
      AiDisabledError,
    );
  });

  it('没填地址或模型 → AiDisabledError（不算"配置好了"）', async () => {
    await expect(
      callCapability(gate({ endpoint: '' }), { capability: AiCapability.Understand, text: '开会' }),
    ).rejects.toThrow(AiDisabledError);
    await expect(
      callCapability(gate({ model: '' }), { capability: AiCapability.Understand, text: '开会' }),
    ).rejects.toThrow(AiDisabledError);
  });

  it('一段话 → 结构化日程，字段与本地解析器同构', async () => {
    const res = await callCapability(gate(), {
      capability: AiCapability.Understand,
      text: '下周三下午3点开会，提前半小时提醒我',
    });

    const data = res.data as {
      title: string;
      time: { attribute: string; startAt: string };
      reminder: number | null;
    };
    expect(data.title).toBe('开会');
    expect(data.time.attribute).toBe('fixed');
    expect(new Date(data.time.startAt).getHours()).toBe(15);
    expect(data.reminder).toBe(30);
  });

  it('**默认脱敏**：手机号不会原样发给服务商，并如实回报遮蔽了几处', async () => {
    const res = await callCapability(gate(), {
      capability: AiCapability.Understand,
      text: '明天10点和张三开会，电话13812345678',
    });

    const messages = captured[0]!.body.messages ?? [];
    const sent = messages[messages.length - 1]?.content ?? '';
    expect(sent).not.toContain('13812345678');
    expect(sent).toContain('[已遮蔽]');
    expect(res.maskedCount).toBe(1);
  });

  it('模型给了个不成形的结果（没有名字）→ 抛错，让调用方退回本地识别', async () => {
    modelReply = JSON.stringify({ title: '', timeKind: 'fixed', startAt: '2026-10-14T15:00' });
    await expect(
      callCapability(gate(), { capability: AiCapability.Understand, text: '???' }),
    ).rejects.toThrow(AiCallError);
  });

  it('说了 fixed 却给不出合法时间 → 抛错（宁可退回本地，也不用半个结果）', async () => {
    modelReply = JSON.stringify({ title: '开会', timeKind: 'fixed', startAt: '下周随便吧' });
    await expect(
      callCapability(gate(), { capability: AiCapability.Understand, text: '下周开会' }),
    ).rejects.toThrow(AiCallError);
  });

  it('模型回了一坨不是 JSON 的废话 → 抛错，并把它的原话带出来（而不是把废话当日程）', async () => {
    modelReply = '抱歉，我不能回答这个问题。';
    await expect(
      callCapability(gate(), { capability: AiCapability.Understand, text: 'hi' }),
    ).rejects.toThrow(/没有按要求返回 JSON.*抱歉/s);
  });

  it('还没接线的能力（如拆解）→ 不报错、给 null，界面继续走本地路径', async () => {
    const res = await callCapability(gate({}, [AiCapability.Breakdown]), {
      capability: AiCapability.Breakdown,
      text: '写论文',
    });
    expect(res.data).toBeNull();
    expect(captured).toHaveLength(0); // 压根没发请求
  });
});
