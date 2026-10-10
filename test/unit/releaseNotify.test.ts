import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  classify,
  buildMessages,
  closedIssueIds,
  announceRelease,
} from '@/scripts/releaseNotify.mjs';

describe('classify', () => {
  it('groups by conventional prefix and strips it', () => {
    expect(classify('feat(ui)!: add a thing')).toEqual(['✨ Features', 'add a thing']);
    expect(classify('fix: a bug')).toEqual(['🐛 Fixes', 'a bug']);
  });
  it('puts unprefixed and unknown prefixes in Other', () => {
    expect(classify('Update stuff')[0]).toBe('📌 Other');
    expect(classify('wip: x')[0]).toBe('📌 Other');
  });
});

describe('buildMessages', () => {
  const compare = { url: 'https://github.com/o/r/compare/a...b', from: 'a', to: 'b' };

  it('orders sections, escapes HTML and links the range in one message', () => {
    const msgs = buildMessages(['chore: tidy', 'feat: add <b>', 'fix: x'], {
      title: 'app',
      compare,
    });
    expect(msgs).toHaveLength(1);
    const [msg] = msgs;
    expect(msg).toContain('released to production\n');
    expect(msg.indexOf('Features')).toBeLessThan(msg.indexOf('Fixes'));
    expect(msg.indexOf('Fixes')).toBeLessThan(msg.indexOf('Chores'));
    expect(msg).toContain('• add &lt;b&gt;');
    expect(msg).toContain('Compare a…b');
  });

  it('keeps the given (oldest-first) order within a section', () => {
    const [msg] = buildMessages(['feat: first', 'fix: x', 'feat: second']);
    expect(msg.indexOf('first')).toBeLessThan(msg.indexOf('second'));
  });

  it('splits a long release into numbered parts, in order, dropping nothing', () => {
    const subjects = Array.from({ length: 200 }, (_, i) => `feat: ${'x'.repeat(60)} ${i}`);
    const msgs = buildMessages(subjects, { title: 'app', compare });
    expect(msgs.length).toBeGreaterThan(1);
    for (const [i, msg] of msgs.entries()) {
      expect(msg.length).toBeLessThan(4096);
      expect(msg).toContain(`released to production (${i + 1}/${msgs.length})`);
      expect(msg.includes('Compare a…b')).toBe(i === msgs.length - 1);
    }
    const listed = msgs
      .join('\n')
      .match(/x \d+$/gm)
      ?.map((m) => Number(m.slice(2)));
    expect(listed).toEqual(subjects.map((_, i) => i));
    expect(msgs.join('\n')).not.toMatch(/more commit/);
  });
});

describe('closedIssueIds', () => {
  it('reads closing keywords and lists, uppercased and de-duplicated', () => {
    expect(
      closedIssueIds(['feat: x\n\nCloses WIS-12', 'Fixes: wis-3, WIS-4 and WIS-5\nCloses WIS-12'])
    ).toEqual(['WIS-12', 'WIS-3', 'WIS-4', 'WIS-5']);
  });
  it('ignores contributing references', () => {
    expect(closedIssueIds(['Part of WIS-9', 'Ref WIS-10', 'see WIS-11'])).toEqual([]);
  });
});

describe('announceRelease', () => {
  afterEach(() => vi.unstubAllGlobals());
  const commits = [{ subject: 'feat: a', body: 'Closes WIS-1' }];

  it('prints previews and calls nothing without credentials', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const log = { log: vi.fn(), warn: vi.fn() };
    await announceRelease(commits, { env: {}, log });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log.log.mock.calls.flat().join('\n')).toContain('WIS-1');
  });

  it('warns, never throws or leaks the token, when Telegram rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 401 })));
    const log = { log: vi.fn(), warn: vi.fn() };
    await expect(
      announceRelease(commits, {
        env: { TELEGRAM_BOT_TOKEN: 'SECRET', TELEGRAM_CHAT_ID: '1' },
        log,
      })
    ).resolves.toBeUndefined();
    const out = [...log.log.mock.calls, ...log.warn.mock.calls].flat().join('\n');
    expect(out).toContain('401');
    expect(out).not.toContain('SECRET');
  });

  it('posts every part in order and stops at the first failure', async () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      subject: `feat: ${'x'.repeat(60)} ${i}`,
      body: '',
    }));
    const texts: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      texts.push(JSON.parse(init.body).text);
      return texts.length === 2 ? new Response('nope', { status: 500 }) : new Response('{}');
    });
    vi.stubGlobal('fetch', fetchMock);
    const log = { log: vi.fn(), warn: vi.fn() };
    await announceRelease(many, { env: { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1' }, log });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(texts[0]).toMatch(/\(1\/\d+\)/);
    expect(texts[1]).toMatch(/\(2\/\d+\)/);
    expect(log.warn.mock.calls.flat().join()).toMatch(/stopped after 1 of \d+/);
  });

  it('moves only On Staging issues to the first completed status', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: { body: string }) => {
      const { query } = JSON.parse(init.body);
      if (query.includes('issueUpdate')) {
        return Response.json({ data: { issueUpdate: { success: true } } });
      }
      return Response.json({
        data: {
          issue: {
            id: 'u1',
            state: { name: 'On Staging' },
            team: {
              states: {
                nodes: [
                  { id: 's2', name: 'Later', position: 5 },
                  { id: 's1', name: 'Done', position: 1 },
                ],
              },
            },
          },
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const log = { log: vi.fn(), warn: vi.fn() };
    await announceRelease(commits, { env: { LINEAR_API_KEY: 'k' }, log });
    const mutation = fetchMock.mock.calls
      .map((c) => JSON.parse(c[1].body))
      .find((b) => b.variables.stateId);
    expect(mutation.variables).toEqual({ id: 'u1', stateId: 's1' });
    expect(log.log.mock.calls.flat().join('\n')).toContain('WIS-1: On Staging → Done');
  });
});
