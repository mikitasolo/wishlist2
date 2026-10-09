import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  classify,
  buildMessage,
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

describe('buildMessage', () => {
  it('orders sections, escapes HTML and links the range', () => {
    const msg = buildMessage(['chore: tidy', 'feat: add <b>', 'fix: x'], {
      title: 'app',
      compare: { url: 'https://github.com/o/r/compare/a...b', from: 'a', to: 'b' },
    });
    expect(msg.indexOf('Features')).toBeLessThan(msg.indexOf('Fixes'));
    expect(msg.indexOf('Fixes')).toBeLessThan(msg.indexOf('Chores'));
    expect(msg).toContain('• add &lt;b&gt;');
    expect(msg).toContain('Compare a…b');
  });
  it('stays under the Telegram cap and says how many were dropped', () => {
    const subjects = Array.from({ length: 200 }, (_, i) => `feat: ${'x'.repeat(60)} ${i}`);
    const msg = buildMessage(subjects);
    expect(msg.length).toBeLessThan(4096);
    expect(msg).toMatch(/…and \d+ more commit/);
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
