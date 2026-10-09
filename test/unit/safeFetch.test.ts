import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { request as undiciRequest, type Dispatcher } from 'undici';
import {
  createPinnedAgent,
  fetchPublicBytes,
  isPublicAddress,
  parseFetchableUrl,
  pinnedLookup,
  refererFor,
  SafeFetchError,
  type CheckedAddress,
  type SafeFetchDeps,
  type SafeFetchFailure,
} from '@/lib/utils/safeFetch';

// WIS-366: the server fetch of a URL a user gave us. DNS, the dispatcher and
// the request are all injected; nothing here touches the network (the one
// pinning test below talks to a server on loopback, through the real Agent).

describe('isPublicAddress', () => {
  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '11.0.0.0',
    '100.63.255.255', // just below CGNAT
    '100.128.0.0', // just above it
    '172.15.255.255',
    '172.32.0.0',
    '192.169.0.1',
    '223.255.255.255',
    '2606:4700:4700::1111',
    '2a00:1450:4001:82a::200e',
    '::ffff:8.8.8.8', // IPv4-mapped, to a public address
    '::ffff:808:808',
    '64:ff9b::808:808', // NAT64 of 8.8.8.8
    '2002:808:808::1', // 6to4 of 8.8.8.8
  ])('admits %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    // IPv4
    ['0.0.0.0', 'this network'],
    ['0.1.2.3', 'this network'],
    ['10.0.0.1', 'RFC 1918'],
    ['10.255.255.255', 'RFC 1918'],
    ['100.64.0.1', 'CGNAT'],
    ['100.127.255.255', 'CGNAT'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback'],
    ['169.254.169.254', 'cloud metadata'],
    ['169.254.0.1', 'link-local'],
    ['172.16.0.1', 'RFC 1918'],
    ['172.31.255.255', 'RFC 1918'],
    ['192.0.0.8', 'IETF protocol assignments'],
    ['192.0.2.1', 'documentation'],
    ['192.88.99.1', '6to4 relay anycast'],
    ['192.168.1.1', 'RFC 1918'],
    ['198.18.0.1', 'benchmarking'],
    ['198.19.255.255', 'benchmarking'],
    ['198.51.100.1', 'documentation'],
    ['203.0.113.1', 'documentation'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.250', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'broadcast'],
    // IPv6
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['0:0:0:0:0:0:0:1', 'loopback, long form'],
    ['fc00::1', 'unique local'],
    ['fd12:3456:789a::1', 'unique local'],
    ['fe80::1', 'link-local'],
    ['fe80::1%eth0', 'link-local with a zone'],
    ['febf::1', 'link-local'],
    ['ff02::1', 'multicast'],
    ['100::1', 'discard'],
    ['::ffff:10.0.0.1', 'IPv4-mapped private'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:a9fe:a9fe', 'IPv4-mapped metadata, in hex'],
    ['::10.0.0.1', 'IPv4-compatible private'],
    ['::7f00:1', 'IPv4-compatible loopback'],
    ['::ffff:0:10.0.0.1', 'IPv4-translated private'],
    ['64:ff9b::a00:1', 'NAT64 of 10.0.0.1'],
    ['64:ff9b::127.0.0.1', 'NAT64 of loopback'],
    ['64:ff9b:1::808:808', 'NAT64 local-use'],
    ['2002:a00:1::1', '6to4 of 10.0.0.1'],
    ['2002:7f00:1::', '6to4 of loopback'],
    ['2002:a9fe:a9fe::', '6to4 of the metadata address'],
    ['2001:0:4136:e378:8000:63bf:3fff:fdd2', 'Teredo'],
    ['2001:0:5ef5:79fd:0:0:f5ff:fffe', 'Teredo embedding 10.0.0.1'],
    ['2001:db8::1', 'documentation'],
    ['3fff::1', 'documentation'],
    // Not addresses at all
    ['', 'empty'],
    ['localhost', 'a name'],
    ['2130706433', 'decimal IPv4 as text'],
    ['0x7f.1', 'hex IPv4 as text'],
    ['017700000001', 'octal IPv4 as text'],
    ['127.1', 'short IPv4 as text'],
  ])('refuses %s (%s)', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});

describe('parseFetchableUrl', () => {
  it('takes an https URL, with or without the default port', () => {
    expect(parseFetchableUrl('https://cdn.example.com/a.jpg').href).toBe(
      'https://cdn.example.com/a.jpg'
    );
    expect(parseFetchableUrl('https://cdn.example.com:443/a.jpg').hostname).toBe('cdn.example.com');
  });

  it.each([
    ['http://cdn.example.com/a.jpg', 'plain http'],
    ['ftp://cdn.example.com/a.jpg', 'another scheme'],
    ['file:///etc/passwd', 'a file'],
    ['data:image/png;base64,AAAA', 'a data URL'],
    ['javascript:alert(1)', 'script'],
    ['https://cdn.example.com:8443/a.jpg', 'another port'],
    ['https://cdn.example.com:80/a.jpg', 'port 80'],
    ['https://user@cdn.example.com/a.jpg', 'a username'],
    ['https://user:pass@cdn.example.com/a.jpg', 'userinfo'],
    ['not a url', 'not a URL'],
    ['', 'empty'],
    [`https://cdn.example.com/${'a'.repeat(2100)}`, 'too long'],
  ])('refuses %s (%s)', (input) => {
    expect(() => parseFetchableUrl(input)).toThrow(SafeFetchError);
  });

  it('refuses what isn’t a string', () => {
    expect(() => parseFetchableUrl(42)).toThrow(SafeFetchError);
    expect(() => parseFetchableUrl(null)).toThrow(SafeFetchError);
  });
});

describe('refererFor', () => {
  it('sends the product page’s origin only', () => {
    expect(refererFor('https://shop.example.com/p/123?ref=alice#top')).toBe(
      'https://shop.example.com/'
    );
    expect(refererFor('http://shop.example.com:8080/x')).toBe('http://shop.example.com:8080/');
  });

  it('sends nothing for a page that isn’t an http(s) URL', () => {
    expect(refererFor(undefined)).toBeUndefined();
    expect(refererFor('javascript:alert(1)')).toBeUndefined();
    expect(refererFor('nope')).toBeUndefined();
    expect(refererFor(7)).toBeUndefined();
  });
});

describe('pinnedLookup', () => {
  const pinned: CheckedAddress = { address: '93.184.216.34', family: 4 };

  it('answers any name with the checked address, one at a time', () => {
    const callback = vi.fn();
    pinnedLookup(pinned)('rebound.example.com', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4);
  });

  it('answers with only the checked address when asked for all of them', () => {
    const callback = vi.fn();
    pinnedLookup(pinned)('rebound.example.com', { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }]);
  });
});

// The real undici Agent: a connection for a name DNS can never answer
// (`.invalid`, RFC 6761) reaches the server at the pinned address, with Host
// still the name. Plain http on loopback, so no certificate is needed; TLS
// takes the same `connect.lookup`.
describe('createPinnedAgent', () => {
  let server: Server;
  let port: number;
  const seen: { host?: string }[] = [];

  beforeEach(async () => {
    seen.length = 0;
    server = createServer((req, res) => {
      seen.push({ host: req.headers.host });
      res.end('pinned');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('connects to the checked address, whatever DNS would say, keeping the name', async () => {
    const agent = createPinnedAgent(
      { address: '127.0.0.1', family: 4 },
      { connectTimeoutMs: 2000 }
    );
    try {
      const res = await undiciRequest(`http://pinned.invalid:${port}/a.jpg`, { dispatcher: agent });
      expect(await res.body.text()).toBe('pinned');
      expect(seen).toEqual([{ host: `pinned.invalid:${port}` }]);
    } finally {
      await agent.destroy();
    }
  });
});

// ── fetchPublicBytes, with DNS, the dispatcher and the request mocked ──────

const PUBLIC = '93.184.216.34';
const PUBLIC_2 = '151.101.1.69';

interface FakeResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: Readable;
}

function respond(
  statusCode: number,
  headers: Record<string, string> = {},
  chunks: Buffer[] = []
): FakeResponse {
  return { statusCode, headers, body: Readable.from(chunks) };
}

const redirect = (location: string, status = 302) => respond(status, { location });

function harness(dns: Record<string, string[]> = { 'cdn.example.com': [PUBLIC] }) {
  const resolve = vi.fn(async (hostname: string) => {
    const answers = dns[hostname];
    if (!answers) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    return answers.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  });
  const agents: { pinned: CheckedAddress; destroy: ReturnType<typeof vi.fn> }[] = [];
  const createAgent = vi.fn((pinned: CheckedAddress) => {
    const agent = { pinned, destroy: vi.fn().mockResolvedValue(undefined) };
    agents.push(agent);
    return agent as unknown as Dispatcher;
  });
  const request = vi.fn();
  const deps = { resolve, createAgent, request } as unknown as SafeFetchDeps;
  return { resolve, createAgent, request, agents, deps };
}

async function failure(promise: Promise<unknown>): Promise<SafeFetchFailure> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(SafeFetchError);
    return (error as SafeFetchError).reason;
  }
  throw new Error('expected the fetch to fail');
}

describe('fetchPublicBytes', () => {
  it('fetches through an agent pinned to the address it checked', async () => {
    const h = harness();
    h.request.mockResolvedValueOnce(respond(200, {}, [Buffer.from('abc'), Buffer.from('def')]));

    const bytes = await fetchPublicBytes('https://cdn.example.com/a.jpg', {}, h.deps);

    expect(bytes.toString()).toBe('abcdef');
    // Resolved once, and the connection goes to that answer.
    expect(h.resolve).toHaveBeenCalledTimes(1);
    expect(h.resolve).toHaveBeenCalledWith('cdn.example.com');
    expect(h.createAgent).toHaveBeenCalledTimes(1);
    expect(h.agents[0].pinned).toEqual({ address: PUBLIC, family: 4 });
    const [url, init] = h.request.mock.calls[0];
    expect(String(url)).toBe('https://cdn.example.com/a.jpg');
    expect(init.dispatcher).toBe(h.agents[0]);
    expect(init.method).toBe('GET');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // Nothing of the user's travels: no cookie, credentials or forwarded headers.
    expect(Object.keys(init.headers).sort()).toEqual(['accept', 'accept-encoding', 'user-agent']);
    expect(h.agents[0].destroy).toHaveBeenCalled();
  });

  it('sends the product page’s origin as Referer', async () => {
    const h = harness();
    h.request.mockResolvedValueOnce(respond(200, {}, [Buffer.from('x')]));
    await fetchPublicBytes(
      'https://cdn.example.com/a.jpg',
      { referer: 'https://shop.example.com/p/1?u=alice' },
      h.deps
    );
    expect(h.request.mock.calls[0][1].headers.referer).toBe('https://shop.example.com/');
  });

  it('refuses a host if any of its addresses isn’t public, before connecting', async () => {
    for (const answers of [['10.0.0.5'], [PUBLIC, '127.0.0.1'], ['::1'], [PUBLIC, 'fd00::1']]) {
      const h = harness({ 'cdn.example.com': answers });
      expect(await failure(fetchPublicBytes('https://cdn.example.com/a.jpg', {}, h.deps))).toBe(
        'blocked_address'
      );
      expect(h.createAgent).not.toHaveBeenCalled();
      expect(h.request).not.toHaveBeenCalled();
    }
  });

  it.each([
    'https://2130706433/a.jpg',
    'https://0x7f.1/a.jpg',
    'https://017700000001/a.jpg',
    'https://127.1/a.jpg',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/a.jpg',
    'https://[::ffff:127.0.0.1]/a.jpg',
    'https://[::ffff:a9fe:a9fe]/a.jpg',
  ])('refuses the IP literal in %s without asking DNS', async (input) => {
    const h = harness();
    expect(await failure(fetchPublicBytes(input, {}, h.deps))).toBe('blocked_address');
    expect(h.resolve).not.toHaveBeenCalled();
    expect(h.request).not.toHaveBeenCalled();
  });

  it('pins a public IP literal as it stands', async () => {
    const h = harness();
    h.request.mockResolvedValueOnce(respond(200, {}, [Buffer.from('x')]));
    await fetchPublicBytes('https://[2606:4700:4700::1111]/a.jpg', {}, h.deps);
    expect(h.resolve).not.toHaveBeenCalled();
    expect(h.agents[0].pinned).toEqual({ address: '2606:4700:4700::1111', family: 6 });
  });

  it.each([
    'http://cdn.example.com/a.jpg',
    'https://cdn.example.com:8443/a.jpg',
    'https://me:secret@cdn.example.com/a.jpg',
  ])('refuses %s before any lookup', async (input) => {
    const h = harness();
    expect(await failure(fetchPublicBytes(input, {}, h.deps))).toBe('invalid_url');
    expect(h.resolve).not.toHaveBeenCalled();
  });

  it('fails a host that doesn’t resolve, or resolves to nothing', async () => {
    const h = harness({ 'empty.example.com': [] });
    expect(await failure(fetchPublicBytes('https://nowhere.example.com/a', {}, h.deps))).toBe(
      'dns'
    );
    expect(await failure(fetchPublicBytes('https://empty.example.com/a', {}, h.deps))).toBe('dns');
  });

  describe('redirects', () => {
    it('follows one, checking and pinning the new host from scratch', async () => {
      const h = harness({ 'cdn.example.com': [PUBLIC], 'img.example.net': [PUBLIC_2] });
      h.request
        .mockResolvedValueOnce(redirect('https://img.example.net/b.jpg', 301))
        .mockResolvedValueOnce(respond(200, {}, [Buffer.from('img')]));

      const bytes = await fetchPublicBytes('https://cdn.example.com/a.jpg', {}, h.deps);

      expect(bytes.toString()).toBe('img');
      expect(h.resolve.mock.calls).toEqual([['cdn.example.com'], ['img.example.net']]);
      expect(h.agents.map((a) => a.pinned.address)).toEqual([PUBLIC, PUBLIC_2]);
      expect(String(h.request.mock.calls[1][0])).toBe('https://img.example.net/b.jpg');
      expect(h.request.mock.calls[1][1].dispatcher).toBe(h.agents[1]);
      expect(h.agents.every((a) => a.destroy.mock.calls.length === 1)).toBe(true);
    });

    it('resolves a relative Location against the hop it came from', async () => {
      const h = harness();
      h.request
        .mockResolvedValueOnce(redirect('/img/b.jpg', 307))
        .mockResolvedValueOnce(respond(200, {}, [Buffer.from('x')]));
      await fetchPublicBytes('https://cdn.example.com/a/a.jpg', {}, h.deps);
      expect(String(h.request.mock.calls[1][0])).toBe('https://cdn.example.com/img/b.jpg');
      // Every hop is resolved again, even on the same host.
      expect(h.resolve).toHaveBeenCalledTimes(2);
    });

    it('refuses a public → private hop', async () => {
      const h = harness({ 'cdn.example.com': [PUBLIC], 'internal.example.com': ['10.0.0.5'] });
      h.request.mockResolvedValueOnce(redirect('https://internal.example.com/secret'));
      expect(await failure(fetchPublicBytes('https://cdn.example.com/a.jpg', {}, h.deps))).toBe(
        'blocked_address'
      );
      expect(h.request).toHaveBeenCalledTimes(1);
    });

    it('refuses a hop to the metadata address, or to plain http', async () => {
      const h = harness();
      h.request.mockResolvedValueOnce(redirect('https://169.254.169.254/latest/meta-data'));
      expect(await failure(fetchPublicBytes('https://cdn.example.com/a.jpg', {}, h.deps))).toBe(
        'blocked_address'
      );
      h.request.mockResolvedValueOnce(redirect('http://cdn.example.com/a.jpg'));
      expect(await failure(fetchPublicBytes('https://cdn.example.com/a.jpg', {}, h.deps))).toBe(
        'invalid_url'
      );
    });

    it('stops after three', async () => {
      const h = harness();
      h.request.mockResolvedValue(redirect('https://cdn.example.com/again'));
      expect(await failure(fetchPublicBytes('https://cdn.example.com/a.jpg', {}, h.deps))).toBe(
        'too_many_redirects'
      );
      // The first request and three redirects followed.
      expect(h.request).toHaveBeenCalledTimes(4);
    });

    it('treats a redirect with no Location as a failed answer', async () => {
      const h = harness();
      h.request.mockResolvedValueOnce(respond(302));
      expect(await failure(fetchPublicBytes('https://cdn.example.com/a.jpg', {}, h.deps))).toBe(
        'bad_status'
      );
    });
  });

  it('fails any answer but a 2xx', async () => {
    for (const status of [304, 403, 404, 500]) {
      const h = harness();
      h.request.mockResolvedValueOnce(respond(status, {}, [Buffer.from('nope')]));
      expect(await failure(fetchPublicBytes('https://cdn.example.com/a.jpg', {}, h.deps))).toBe(
        'bad_status'
      );
    }
  });

  describe('the size cap', () => {
    it('drops the body once it streams past the cap, whatever Content-Length said', async () => {
      const h = harness();
      const body = Readable.from([Buffer.alloc(6), Buffer.alloc(6), Buffer.alloc(6)]);
      const destroy = vi.spyOn(body, 'destroy');
      h.request.mockResolvedValueOnce({
        statusCode: 200,
        headers: { 'content-length': '3' },
        body,
      });
      expect(
        await failure(fetchPublicBytes('https://cdn.example.com/a.jpg', { maxBytes: 10 }, h.deps))
      ).toBe('too_large');
      expect(destroy).toHaveBeenCalled();
    });

    it('takes a body of exactly the cap', async () => {
      const h = harness();
      h.request.mockResolvedValueOnce(respond(200, {}, [Buffer.alloc(6), Buffer.alloc(4)]));
      const bytes = await fetchPublicBytes('https://cdn.example.com/a', { maxBytes: 10 }, h.deps);
      expect(bytes.length).toBe(10);
    });
  });

  describe('timeouts', () => {
    it('gives up on a request that never answers', async () => {
      const h = harness();
      h.request.mockImplementation(
        (_url: unknown, init: { signal: AbortSignal }) =>
          new Promise((_, reject) =>
            init.signal.addEventListener('abort', () => reject(new Error('aborted')))
          )
      );
      expect(
        await failure(fetchPublicBytes('https://cdn.example.com/a.jpg', { timeoutMs: 30 }, h.deps))
      ).toBe('timeout');
    });

    it('gives up on a body that stalls', async () => {
      const h = harness();
      const body = new Readable({ read() {} });
      body.push(Buffer.from('partial'));
      h.request.mockResolvedValueOnce({ statusCode: 200, headers: {}, body });
      expect(
        await failure(fetchPublicBytes('https://cdn.example.com/a.jpg', { timeoutMs: 30 }, h.deps))
      ).toBe('timeout');
    });

    it('gives up on DNS that never answers', async () => {
      const h = harness();
      h.resolve.mockImplementation(() => new Promise(() => {}));
      expect(
        await failure(fetchPublicBytes('https://cdn.example.com/a.jpg', { timeoutMs: 30 }, h.deps))
      ).toBe('timeout');
      expect(h.request).not.toHaveBeenCalled();
    });

    it('reports undici’s connect timeout as a timeout, other errors as the network', async () => {
      const h = harness();
      h.request.mockRejectedValueOnce(
        Object.assign(new Error('connect'), { code: 'UND_ERR_CONNECT_TIMEOUT' })
      );
      expect(await failure(fetchPublicBytes('https://cdn.example.com/a.jpg', {}, h.deps))).toBe(
        'timeout'
      );
      h.request.mockRejectedValueOnce(Object.assign(new Error('reset'), { code: 'ECONNRESET' }));
      expect(await failure(fetchPublicBytes('https://cdn.example.com/a.jpg', {}, h.deps))).toBe(
        'network'
      );
    });
  });

  it('never carries the URL, host or address in its error', async () => {
    const h = harness({ 'secret-host.example.com': ['10.1.2.3'] });
    try {
      await fetchPublicBytes('https://secret-host.example.com/private/path.jpg', {}, h.deps);
      throw new Error('expected a failure');
    } catch (error) {
      const text = `${(error as Error).message} ${(error as Error).stack ?? ''}`;
      expect(text).not.toContain('secret-host');
      expect(text).not.toContain('10.1.2.3');
      expect(text).not.toContain('private/path');
    }
  });
});
