import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { splitText, type Env } from '../src/index';
import memory from '../fixtures/memory.ja.json';

const seen = new Map<string, string>();
const calls: Array<{ url: string; body: any; headers: Headers }> = [];
const env = (): Env => ({
  SHARED_KEY: 'test-key', TODOIST_TOKEN: 'todoist-test', TODOIST_PROJECT_ID: 'project',
  NOTION_TOKEN: 'notion-test', NOTION_DATABASE_ID: 'database',
  SEEN: { get: async (id: string) => seen.get(id) ?? null, put: async (id: string, value: string) => { seen.set(id, value); } } as KVNamespace
});
const send = (body: unknown = memory, key = 'test-key', bindings = env()) => worker.fetch(new Request(`https://example.test/omi/memory?uid=user&key=${key}`, { method: 'POST', body: JSON.stringify(body) }), bindings);

beforeEach(() => {
  seen.clear(); calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit) => {
    calls.push({ url: input, body: JSON.parse(String(init.body)), headers: new Headers(init.headers) });
    return new Response('{}', { status: 200 });
  }));
});

describe('Omi memory webhook', () => {
  it('creates two Todoist tasks and one Notion page with Japanese content', async () => {
    const response = await send();
    expect(await response.json()).toEqual({ status: 'ok', todoist: 2, notion: true, errors: [] });
    expect(calls).toHaveLength(3);
    expect(calls[0].url).toBe('https://api.todoist.com/rest/v2/tasks');
    expect(calls[0].body).toEqual({ content: '登録画面の説明文を短くする', description: 'Omi: 週次プロダクト定例（2026-11-07 09:30）', project_id: 'project' });
    expect(calls[1].body.content).toBe('インタビュー候補者の日程を整理する');
    const page = calls[2].body;
    expect(page.properties.Name.title[0].text.content).toBe('📝週次プロダクト定例');
    expect(calls[2].headers.get('Notion-Version')).toBe('2022-06-28');
    const todos = page.children.filter((b: any) => b.type === 'to_do');
    expect(todos.map((b: any) => b.to_do.checked)).toEqual([false, false, true]);
    expect(page.children.some((b: any) => b.paragraph?.rich_text?.[0]?.text.content.includes('利用者の声'))).toBe(true);
    expect(page.children.every((b: any) => Array.from((b.paragraph ?? b.to_do).rich_text[0].text.content).length <= 2000)).toBe(true);
  });

  it('splits long transcript text at 2000 characters', async () => {
    const long = structuredClone(memory);
    long.transcript_segments = [{ ...long.transcript_segments[0], text: 'あ'.repeat(2501) }];
    await send(long);
    const paragraphs = calls[2].body.children.filter((b: any) => b.type === 'paragraph');
    expect(paragraphs.slice(-2).map((b: any) => Array.from(b.paragraph.rich_text[0].text.content).length)).toEqual([2000, 504]);
    expect(splitText('😀'.repeat(2001)).map(s => Array.from(s).length)).toEqual([2000, 1]);
  });

  it('rejects a wrong key', async () => {
    expect((await send(memory, 'wrong')).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('ignores discarded memories', async () => {
    expect(await (await send({ ...memory, discarded: true })).json()).toEqual({ status: 'discarded' });
    expect(calls).toHaveLength(0);
  });

  it('returns duplicate on a resend', async () => {
    await send();
    expect(await (await send()).json()).toEqual({ status: 'duplicate' });
    expect(calls).toHaveLength(3);
  });

  it('continues Notion after Todoist failure and reports error', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit) => {
      calls.push({ url: input, body: JSON.parse(String(init.body)), headers: new Headers(init.headers) });
      return new Response('{}', { status: input.includes('todoist') ? 503 : 200 });
    }));
    expect(await (await send()).json()).toEqual({ status: 'ok', todoist: 0, notion: true, errors: ['todoist item 0: HTTP 503', 'todoist item 1: HTTP 503'] });
    expect(calls).toHaveLength(3);
    expect(seen.size).toBe(0);
  });

  it('skips unconfigured integrations and responds to health checks', async () => {
    const bindings = env(); delete bindings.TODOIST_TOKEN; delete bindings.NOTION_TOKEN;
    expect(await (await send(memory, 'test-key', bindings)).json()).toEqual({ status: 'ok', todoist: 0, notion: false, errors: [] });
    expect((await worker.fetch(new Request('https://example.test/health'), bindings)).status).toBe(200);
    expect(calls).toHaveLength(0);
  });
});
