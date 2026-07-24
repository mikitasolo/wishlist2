import { describe, it, expect } from 'vitest';
import { isPrivateIp, assertPublicUrl } from '@/lib/utils/ssrf';

describe('isPrivateIp', () => {
  // regression: SSRF — these are exactly the destinations an attacker targets.
  it('flags loopback, private, link-local, and metadata addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '127.5.5.5',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254', // cloud metadata
      '100.64.0.1', // CGNAT
      '0.0.0.0',
      '255.255.255.255',
      '::1',
      '::',
      'fc00::1',
      'fe80::1',
      '::ffff:127.0.0.1', // IPv4-mapped loopback
      'not-an-ip',
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it('allows genuine public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  // 172.16.0.0/12 spans 172.16–172.31; 172.32 is public.
  it('handles CIDR boundaries', () => {
    expect(isPrivateIp('172.15.255.255')).toBe(false);
    expect(isPrivateIp('172.32.0.0')).toBe(false);
  });
});

describe('assertPublicUrl', () => {
  it('accepts normal http/https URLs', () => {
    expect(assertPublicUrl('https://example.com/product/1').hostname).toBe('example.com');
    expect(assertPublicUrl('http://shop.example.com:80/x').protocol).toBe('http:');
  });

  it('rejects non-web protocols', () => {
    expect(() => assertPublicUrl('file:///etc/passwd')).toThrow();
    expect(() => assertPublicUrl('ftp://example.com')).toThrow();
    expect(() => assertPublicUrl('gopher://example.com')).toThrow();
  });

  it('rejects embedded credentials and non-standard ports', () => {
    expect(() => assertPublicUrl('http://user:pass@example.com')).toThrow();
    expect(() => assertPublicUrl('http://example.com:22')).toThrow();
    expect(() => assertPublicUrl('http://example.com:6379')).toThrow();
  });

  // regression: SSRF — private IP literals and internal hostnames must be blocked.
  it('rejects internal hosts and private IP literals', () => {
    expect(() => assertPublicUrl('http://localhost/')).toThrow();
    expect(() => assertPublicUrl('http://127.0.0.1/')).toThrow();
    expect(() => assertPublicUrl('http://169.254.169.254/latest/meta-data/')).toThrow();
    expect(() => assertPublicUrl('http://192.168.0.1/')).toThrow();
    expect(() => assertPublicUrl('http://foo.internal/')).toThrow();
    expect(() => assertPublicUrl('http://[::1]/')).toThrow();
  });

  it('rejects garbage input', () => {
    expect(() => assertPublicUrl('not a url')).toThrow();
    expect(() => assertPublicUrl('')).toThrow();
  });
});
