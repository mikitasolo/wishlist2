import { describe, it, expect, vi, afterEach } from 'vitest';
import { createFreshUploads, releaseUpload } from '@/lib/utils/freshUploads';

// What a form hands back to DELETE /api/upload (WIS-181): an upload made in it
// that it let go of before any save took it, and never one a save may have
// written.

function setup() {
  const release = vi.fn<(url: string) => void>();
  return { release, uploads: createFreshUploads(release) };
}

describe('createFreshUploads', () => {
  it('hands back an upload replaced or removed before a save', () => {
    const { release, uploads } = setup();
    expect(uploads.add('a')).toBe(true);
    uploads.discard('a');
    expect(release).toHaveBeenCalledWith('a');
    // Only once, however often it's let go of.
    uploads.discard('a');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('never hands back an image the form opened with', () => {
    const { release, uploads } = setup();
    uploads.discard('record-image');
    uploads.discardAll();
    uploads.close();
    uploads.saving('record-image')('refused');
    expect(release).not.toHaveBeenCalled();
  });

  it('hands back everything still unsaved when the form goes back or closes', () => {
    const { release, uploads } = setup();
    uploads.add('a');
    uploads.add('b');
    uploads.discardAll();
    expect(release.mock.calls).toEqual([['a'], ['b']]);
    uploads.add('c');
    uploads.close();
    expect(release).toHaveBeenLastCalledWith('c');
  });

  it('keeps an upload a save took, even once the form closes', () => {
    const { release, uploads } = setup();
    uploads.add('a');
    uploads.saving('a')('saved');
    uploads.discard('a');
    uploads.close();
    expect(release).not.toHaveBeenCalled();
  });

  it("keeps an upload whose save can't say whether it landed", () => {
    const { release, uploads } = setup();
    uploads.add('a');
    uploads.saving('a')('unknown');
    uploads.close();
    expect(release).not.toHaveBeenCalled();
  });

  it('keeps an upload while a save carries it, and hands it back only if that save is refused', () => {
    const { release, uploads } = setup();
    uploads.add('a');
    const settle = uploads.saving('a');
    // The form closes, or the photo is replaced, while the save is out.
    uploads.discard('a');
    uploads.close();
    expect(release).not.toHaveBeenCalled();
    settle('refused');
    expect(release).toHaveBeenCalledWith('a');
    // Settling twice changes nothing.
    settle('refused');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('leaves a refused upload the form still shows to the form', () => {
    const { release, uploads } = setup();
    uploads.add('a');
    uploads.saving('a')('refused');
    expect(release).not.toHaveBeenCalled();
    // Then the dialog is cancelled.
    uploads.close();
    expect(release).toHaveBeenCalledWith('a');
  });

  it('keeps an upload two saves carry until neither can still write it', () => {
    const { release, uploads } = setup();
    uploads.add('a');
    const first = uploads.saving('a');
    const second = uploads.saving('a');
    uploads.discard('a');
    first('refused');
    expect(release).not.toHaveBeenCalled();
    second('saved');
    uploads.close();
    expect(release).not.toHaveBeenCalled();
  });

  it('hands back an upload that lands once the form has closed, and tells the form not to take it', () => {
    const { release, uploads } = setup();
    uploads.close();
    expect(uploads.add('late')).toBe(false);
    expect(release).toHaveBeenCalledWith('late');
    // Reopened (a modal that stays mounted), it takes uploads again.
    uploads.open();
    expect(uploads.add('b')).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('ignores a save with no image', () => {
    const { release, uploads } = setup();
    uploads.saving(null)('refused');
    uploads.saving(undefined)('saved');
    uploads.saving('')('unknown');
    expect(release).not.toHaveBeenCalled();
  });
});

describe('releaseUpload', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the URL to DELETE /api/upload, surviving the page being left, and swallows a failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    releaseUpload('https://store/uploads/u1/a.webp');
    expect(fetchMock).toHaveBeenCalledWith('/api/upload', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://store/uploads/u1/a.webp' }),
      keepalive: true,
    });
    await Promise.resolve();
  });
});
