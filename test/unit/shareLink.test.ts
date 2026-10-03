import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  canUseShareSheet,
  LINK_AUDIENCE_TEXT,
  linkAudience,
  shareOrCopy,
} from '@/lib/utils/shareLink';

afterEach(() => vi.unstubAllGlobals());

describe('linkAudience', () => {
  it('names who a list opens for, by its visibility', () => {
    expect(linkAudience({ visibility: 'everyone' })).toBe('anyone');
    expect(linkAudience({ visibility: 'friends' })).toBe('friends-and-members');
    expect(linkAudience({ visibility: 'private' })).toBe('members');
  });

  it('is owners only on an archived list, whatever its visibility says', () => {
    for (const visibility of ['everyone', 'friends', 'private'] as const) {
      expect(linkAudience({ visibility, archived: true })).toBe('owners');
    }
  });

  it('fails closed on a missing visibility: members, never anyone', () => {
    expect(linkAudience({})).toBe('members');
    expect(linkAudience({ visibility: null, archived: null })).toBe('members');
  });

  it('has a line for every audience', () => {
    expect(LINK_AUDIENCE_TEXT).toEqual({
      anyone: 'Anyone with the link can view.',
      'friends-and-members': 'Only friends of the owners, and people on the list, can open it.',
      members: 'Only people on the list can open it.',
      owners: "Archived: the link won't open for anyone but the owners.",
    });
  });
});

describe('canUseShareSheet', () => {
  it('is false where there is no browser (a server render)', () => {
    expect(canUseShareSheet()).toBe(false);
  });

  it('needs both the Web Share API and a coarse pointer', () => {
    const matchMedia = (coarse: boolean) => () => ({ matches: coarse });
    vi.stubGlobal('window', { matchMedia: matchMedia(true) });
    vi.stubGlobal('navigator', { share: vi.fn() });
    expect(canUseShareSheet()).toBe(true);

    vi.stubGlobal('window', { matchMedia: matchMedia(false) });
    expect(canUseShareSheet()).toBe(false);

    vi.stubGlobal('window', { matchMedia: matchMedia(true) });
    vi.stubGlobal('navigator', {});
    expect(canUseShareSheet()).toBe(false);

    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { share: vi.fn() });
    expect(canUseShareSheet()).toBe(false);
  });
});

describe('shareOrCopy', () => {
  const link = { url: 'https://example.com/wishlists/birthday', title: 'Birthday' };

  function stubNavigator(share?: () => Promise<void>, copy = vi.fn().mockResolvedValue(undefined)) {
    vi.stubGlobal('navigator', { share, clipboard: { writeText: copy } });
    return copy;
  }

  it('hands the link to the share sheet when asked to', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const copy = stubNavigator(share);
    expect(await shareOrCopy(link, { sheet: true })).toBe('shared');
    expect(share).toHaveBeenCalledWith(link);
    expect(copy).not.toHaveBeenCalled();
  });

  it('leaves out a missing title', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stubNavigator(share);
    await shareOrCopy({ url: link.url }, { sheet: true });
    expect(share).toHaveBeenCalledWith({ url: link.url });
  });

  it('reports a cancelled sheet, and copies nothing', async () => {
    const copy = stubNavigator(() =>
      Promise.reject(Object.assign(new Error(), { name: 'AbortError' }))
    );
    expect(await shareOrCopy(link, { sheet: true })).toBe('cancelled');
    expect(copy).not.toHaveBeenCalled();
  });

  it('copies when the sheet fails for any other reason', async () => {
    const copy = stubNavigator(() =>
      Promise.reject(Object.assign(new Error(), { name: 'NotAllowedError' }))
    );
    expect(await shareOrCopy(link, { sheet: true })).toBe('copied');
    expect(copy).toHaveBeenCalledWith(link.url);
  });

  it('copies without the sheet, or when there is none', async () => {
    const share = vi.fn();
    const copy = stubNavigator(share);
    expect(await shareOrCopy(link, { sheet: false })).toBe('copied');
    expect(share).not.toHaveBeenCalled();

    stubNavigator(undefined, copy);
    expect(await shareOrCopy(link, { sheet: true })).toBe('copied');
    expect(copy).toHaveBeenCalledTimes(2);
  });

  it('reports a sheet that failed and a copy that failed after it', async () => {
    stubNavigator(
      () => Promise.reject(Object.assign(new Error(), { name: 'NotAllowedError' })),
      vi.fn().mockRejectedValue(new Error('no user activation'))
    );
    expect(await shareOrCopy(link, { sheet: true })).toBe('unshared');
  });

  it('reports a copy that failed', async () => {
    stubNavigator(undefined, vi.fn().mockRejectedValue(new Error('denied')));
    expect(await shareOrCopy(link, { sheet: false })).toBe('failed');
  });
});
