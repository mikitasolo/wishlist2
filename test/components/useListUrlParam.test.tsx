// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useListUrlParam } from '@/lib/hooks/useListUrlParam';

type List = { id: string; slug?: string | null };
const A: List = { id: 'aaa', slug: 'a-list' };
const B: List = { id: 'bbb', slug: null };

function setUrl(url: string) {
  window.history.replaceState(null, '', url);
}

function setup(initial: { list: List | null; urlId: string | null }) {
  return renderHook(
    (props: { list: List | null; urlId: string | null }) =>
      useListUrlParam<string>({
        ...props,
        param: 'p',
        scope: props.list ? props.list.id : null,
        parse: (raw) => raw ?? '',
        serialize: (v) => (v === '' ? null : v),
      }),
    { initialProps: initial }
  );
}

describe('useListUrlParam', () => {
  beforeEach(() => setUrl('/wishlists/a-list'));
  afterEach(() => setUrl('/'));

  it('starts from the URL when it names the list on screen', () => {
    setUrl('/wishlists/a-list?p=hello');
    const { result } = setup({ list: A, urlId: 'a-list' });
    expect(result.current[0]).toBe('hello');
  });

  it('ignores the URL when it does not name the list on screen', () => {
    setUrl('/wishlists/other?p=hello');
    const { result } = setup({ list: A, urlId: 'other' });
    expect(result.current[0]).toBe('');
  });

  it('writes a choice to the URL by replacing, and removes the default', () => {
    const before = window.history.length;
    const { result } = setup({ list: A, urlId: 'a-list' });
    act(() => result.current[1]('x'));
    expect(window.location.search).toBe('?p=x');
    act(() => result.current[1](''));
    expect(window.location.search).toBe('');
    expect(window.history.length).toBe(before);
  });

  it('leaves the URL alone while it names another list', () => {
    setUrl('/wishlists/other');
    const { result } = setup({ list: A, urlId: 'other' });
    act(() => result.current[1]('x'));
    expect(result.current[0]).toBe('x');
    expect(window.location.search).toBe('');
  });

  it('starts another list from its own value, not the old one', () => {
    const { result, rerender } = setup({ list: A, urlId: 'a-list' });
    act(() => result.current[1]('x'));
    setUrl('/wishlists/bbb');
    rerender({ list: B, urlId: 'bbb' });
    expect(result.current[0]).toBe('');
    expect(window.location.search).toBe('');
  });

  it('re-reads the URL on popstate, only while it is this list', () => {
    const { result } = setup({ list: A, urlId: 'a-list' });
    act(() => result.current[1]('x'));
    act(() => {
      setUrl('/wishlists/a-list?p=back');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current[0]).toBe('back');
    act(() => {
      setUrl('/wishlists/elsewhere?p=nope');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current[0]).toBe('back');
  });

  it('puts a non-default value back when the list gets a new slug', () => {
    const { result, rerender } = setup({ list: A, urlId: 'a-list' });
    act(() => result.current[1]('x'));
    // The page moved to the new slug's URL, which carries no parameter.
    setUrl('/wishlists/new-slug');
    rerender({ list: { id: 'aaa', slug: 'new-slug' }, urlId: 'new-slug' });
    expect(result.current[0]).toBe('x');
    expect(window.location.search).toBe('?p=x');
  });

  it('does not write a default value into a new slug URL', () => {
    const { rerender } = setup({ list: A, urlId: 'a-list' });
    setUrl('/wishlists/new-slug');
    rerender({ list: { id: 'aaa', slug: 'new-slug' }, urlId: 'new-slug' });
    expect(window.location.search).toBe('');
  });

  it('never touches the URL without a urlId (link mode)', () => {
    setUrl('/l/token');
    const { result } = setup({ list: A, urlId: null });
    act(() => result.current[1]('x'));
    expect(result.current[0]).toBe('x');
    expect(window.location.search).toBe('');
  });
});
