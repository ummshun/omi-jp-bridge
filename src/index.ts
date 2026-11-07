export interface Env {
  SEEN: KVNamespace;
  SHARED_KEY: string;
  TODOIST_TOKEN?: string;
  TODOIST_PROJECT_ID?: string;
  NOTION_TOKEN?: string;
  NOTION_DATABASE_ID?: string;
}

interface ActionItem { description: string; completed: boolean }
interface Memory {
  id: string;
  started_at: string;
  discarded?: boolean;
  transcript_segments: Array<{ text: string; speaker_name?: string; speaker?: string }>;
  structured: { title: string; emoji?: string; overview?: string; action_items: ActionItem[] };
}

const json = (data: unknown, status = 200) => Response.json(data, { status });
const richText = (content: string) => ({ type: 'text', text: { content } });
const paragraph = (content: string) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [richText(content)] } });

// Array.from counts Unicode code points, so surrogate pairs stay intact.
export function splitText(text: string, size = 2000): string[] {
  const chars = Array.from(text);
  const chunks: string[] = [];
  for (let i = 0; i < chars.length; i += size) chunks.push(chars.slice(i, i + size).join(''));
  return chunks;
}

function validMemory(value: unknown): value is Memory {
  if (!value || typeof value !== 'object') return false;
  const m = value as Partial<Memory>;
  return typeof m.id === 'string' && !!m.id && typeof m.started_at === 'string' &&
    !Number.isNaN(Date.parse(m.started_at)) && Array.isArray(m.transcript_segments) &&
    m.transcript_segments.every(s => s && typeof s.text === 'string') &&
    !!m.structured && typeof m.structured.title === 'string' &&
    Array.isArray(m.structured.action_items) && m.structured.action_items.every(a =>
      a && typeof a.description === 'string' && typeof a.completed === 'boolean');
}

function jst(date: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(date));
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

async function post(url: string, token: string, body: unknown, headers: Record<string, string> = {}, method = 'POST'): Promise<Record<string, unknown>> {
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  try { return (await response.json()) as Record<string, unknown>; } catch { return {}; }
}

const NOTION_VERSION = { 'Notion-Version': '2022-06-28' };
const NOTION_MAX_CHILDREN = 100;

function heading(text: string): unknown {
  return { object: 'block', type: 'heading_2', heading_2: { rich_text: [richText(text)] } };
}

function notionBlocks(memory: Memory): unknown[] {
  const blocks: unknown[] = [];
  if (memory.structured.overview) blocks.push(heading('概要'));
  for (const chunk of splitText(memory.structured.overview ?? '')) blocks.push(paragraph(chunk));
  if (memory.structured.action_items.length > 0) blocks.push(heading('やること'));
  for (const item of memory.structured.action_items) {
    for (const [index, chunk] of splitText(item.description).entries()) {
      blocks.push({ object: 'block', type: 'to_do', to_do: { rich_text: [richText(chunk)], checked: index === 0 && item.completed } });
    }
  }
  if (memory.transcript_segments.length > 0) blocks.push(heading('文字起こし'));
  for (const segment of memory.transcript_segments) {
    const line = `${segment.speaker_name || segment.speaker || '不明'}: ${segment.text}`;
    for (const chunk of splitText(line)) blocks.push(paragraph(chunk));
  }
  return blocks;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') return new Response('ok');
    if (request.method !== 'POST' || url.pathname !== '/omi/memory') return new Response('Not Found', { status: 404 });
    if (!env.SHARED_KEY || url.searchParams.get('key') !== env.SHARED_KEY) return json({ error: 'unauthorized' }, 401);
    let raw: unknown;
    try { raw = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
    if (!validMemory(raw)) return json({ error: 'invalid_memory' }, 400);
    const memory = raw;
    if (memory.discarded) return json({ status: 'discarded' });
    if (await env.SEEN.get(memory.id)) return json({ status: 'duplicate' });

    const errors: string[] = [];
    let todoist = 0;
    let notion = false;
    if (env.TODOIST_TOKEN) {
      for (const [index, item] of memory.structured.action_items.entries()) {
        if (item.completed) continue;
        try {
          await post('https://api.todoist.com/api/v1/tasks', env.TODOIST_TOKEN, {
            content: item.description,
            description: `Omi: ${memory.structured.title}（${jst(memory.started_at)}）`,
            ...(env.TODOIST_PROJECT_ID ? { project_id: env.TODOIST_PROJECT_ID } : {})
          });
          todoist++;
        } catch (error) { errors.push(`todoist item ${index}: ${error instanceof Error ? error.message : 'unknown error'}`); }
      }
    }
    if (env.NOTION_TOKEN && env.NOTION_DATABASE_ID) {
      try {
        const blocks = notionBlocks(memory);
        const page = await post('https://api.notion.com/v1/pages', env.NOTION_TOKEN, {
          parent: { database_id: env.NOTION_DATABASE_ID },
          properties: { Name: { title: [richText(`${memory.structured.emoji ?? ''}${memory.structured.title}`)] } },
          children: blocks.slice(0, NOTION_MAX_CHILDREN)
        }, NOTION_VERSION);
        for (let i = NOTION_MAX_CHILDREN; i < blocks.length; i += NOTION_MAX_CHILDREN) {
          await post(`https://api.notion.com/v1/blocks/${String(page.id)}/children`, env.NOTION_TOKEN,
            { children: blocks.slice(i, i + NOTION_MAX_CHILDREN) }, NOTION_VERSION, 'PATCH');
        }
        notion = true;
      } catch (error) { errors.push(`notion: ${error instanceof Error ? error.message : 'unknown error'}`); }
    }
    if (errors.length === 0) await env.SEEN.put(memory.id, '1');
    console.log(JSON.stringify({ id: memory.id, todoist, notion, error_count: errors.length }));
    return json({ status: 'ok', todoist, notion, errors });
  }
} satisfies ExportedHandler<Env>;
