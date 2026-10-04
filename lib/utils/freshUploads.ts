/**
 * The uploads a form holds that no save has taken yet (WIS-181).
 *
 * `ImageUpload` stores an image as soon as it's cropped, before the form around
 * it is saved. One the form then lets go of (it's cancelled, closed or
 * discarded, or the photo is replaced or removed before a save) would stay in
 * the uploader's folder for good, on their quota, so it's handed back to
 * `DELETE /api/upload`, which frees it only if it's theirs and nothing shows it.
 *
 * What's never handed back:
 *  - an image the form opened with (the record's own, a co-owner's, the
 *    proposer's, a copy's source): only uploads made in this form are tracked;
 *  - an upload a save is carrying while that save is in flight, nor one a save
 *    took ('saved'), nor one whose save failed without saying whether it landed
 *    ('unknown': a timeout, a dropped connection, or a form that can't tell a
 *    refusal from those). The server checks that no record shows the image, but
 *    a save landing just after that check would point at a freed blob, so the
 *    browser never hands back what a save may still write. Such an upload
 *    stays, as every unsaved upload did before.
 *
 * A save the server answered with a refusal ('refused') leaves the upload the
 * form's again, still shown in it, and still handed back when the form lets go.
 * Once the form is closed, anything that turns up for it (an upload finishing
 * late, a refusal answering late) is handed back at once.
 */

export type SaveOutcome = 'saved' | 'refused' | 'unknown';

export interface FreshUploads {
  /**
   * An upload made in this form has landed. False when the form is closed by
   * then: it's handed back at once, and the form mustn't take it.
   */
  add(url: string): boolean;
  /** The form no longer holds `url` (replaced, removed, cleared). */
  discard(url: string | null | undefined): void;
  /** The form went back to what's saved (Discard, or closing it): hand back everything. */
  discardAll(): void;
  /** A save is carrying `url`: call what it returns, once, with how it went. */
  saving(url: string | null | undefined): (outcome: SaveOutcome) => void;
  /** The form is gone: hand back everything, and anything that turns up later. */
  close(): void;
  /** The form is (again) open. */
  open(): void;
}

interface Entry {
  /** The form still shows it. */
  held: boolean;
  /** Saves carrying it that haven't answered. */
  inFlight: number;
}

export function createFreshUploads(release: (url: string) => void): FreshUploads {
  const fresh = new Map<string, Entry>();
  let closed = false;

  const letGo = (url: string, entry: Entry) => {
    if (entry.held || entry.inFlight > 0 || fresh.get(url) !== entry) return;
    fresh.delete(url);
    release(url);
  };

  const discard = (url: string | null | undefined) => {
    const entry = url ? fresh.get(url) : undefined;
    if (!url || !entry) return;
    entry.held = false;
    letGo(url, entry);
  };

  const discardAll = () => {
    for (const url of [...fresh.keys()]) discard(url);
  };

  return {
    add(url) {
      if (closed) {
        release(url);
        return false;
      }
      if (!fresh.has(url)) fresh.set(url, { held: true, inFlight: 0 });
      return true;
    },
    discard,
    discardAll,
    saving(url) {
      const entry = url ? fresh.get(url) : undefined;
      if (!url || !entry) return () => {};
      entry.inFlight += 1;
      let settled = false;
      return (outcome) => {
        if (settled) return;
        settled = true;
        entry.inFlight -= 1;
        // A save that took it, or may have, keeps it for good.
        if (outcome !== 'refused') {
          if (fresh.get(url) === entry) fresh.delete(url);
          return;
        }
        if (closed) entry.held = false;
        letGo(url, entry);
      };
    },
    close() {
      closed = true;
      discardAll();
    },
    open() {
      closed = false;
    },
  };
}

/**
 * Hand an upload back to the server. Fire and forget: a failure only leaves the
 * upload where it was. `keepalive`, so it still goes out when the form closes
 * because the page is being left.
 */
export function releaseUpload(url: string): void {
  try {
    fetch('/api/upload', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // No fetch (a test environment without one): nothing to hand back to.
  }
}
