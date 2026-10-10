// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import Callout from '@/components/Callout';
import Panel, { PanelRow, PanelSection } from '@/components/Panel';
import Spinner from '@/components/Spinner';
import { TONE_CLASSES } from '@/lib/utils/statusTones';

beforeEach(() => cleanup());

describe('Callout', () => {
  it('announces a danger callout as an alert', () => {
    render(<Callout tone="danger">That link didn’t work.</Callout>);
    expect(screen.getByRole('alert')).toHaveTextContent('That link didn’t work.');
  });

  it.each(['info', 'warning'] as const)('reads a %s callout in place, as a note', (tone) => {
    render(<Callout tone={tone}>Worth knowing.</Callout>);
    expect(screen.getByRole('note')).toHaveTextContent('Worth knowing.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('takes another role when it says something that just happened', () => {
    render(
      <Callout tone="info" role="status">
        Saved.
      </Callout>
    );
    expect(screen.getByRole('status')).toHaveTextContent('Saved.');
  });

  it.each(['info', 'warning', 'danger'] as const)('colours itself from the %s tone', (tone) => {
    render(<Callout tone={tone}>Text</Callout>);
    const box = screen.getByText('Text').parentElement!;
    for (const c of TONE_CLASSES[tone].notice.split(' ')) expect(box).toHaveClass(c);
    expect(box.querySelector('svg')).not.toBeNull();
  });
});

describe('Panel', () => {
  it('is a section titled by an h2, with its description and content', () => {
    render(
      <Panel title="Profile" description="How people see you.">
        <p>Content</p>
      </Panel>
    );
    const heading = screen.getByRole('heading', { level: 2, name: 'Profile' });
    expect(heading.closest('section')).toHaveClass('rounded-2xl', 'shadow-sm', 'p-5', 'sm:p-6');
    expect(screen.getByText('How people see you.')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('is the form when asked, and submits it', () => {
    const onSubmit = vi.fn((e) => e.preventDefault());
    render(
      <Panel as="form" title="Pick a username" onSubmit={onSubmit}>
        <button type="submit">Save</button>
      </Panel>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Pick a username' }).closest('form')).not.toBeNull();
  });

  it('is named by its heading when it says so (a region)', () => {
    render(
      <Panel aria-labelledby="t" title="Show prices in EUR?" titleId="t">
        x
      </Panel>
    );
    expect(screen.getByRole('region', { name: 'Show prices in EUR?' })).toBeInTheDocument();
  });

  it('as a list, puts its header over rows divided by a line', () => {
    render(
      <Panel variant="list" title="Members">
        <PanelRow>Alice</PanelRow>
        <PanelRow>Bob</PanelRow>
      </Panel>
    );
    const rows = screen.getByText('Alice').parentElement!;
    expect(rows).toHaveClass('divide-y');
    expect(rows.children).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Members' }).parentElement).toHaveClass('border-b');
  });

  it('as a list, hands the panel’s corners to the rows wrapper', () => {
    // regression: the wrapper is a plain div, so the rows' `rounded-t-[inherit]` inherited
    // radius 0 from it and a group heading's background painted square over the corners.
    const { rerender } = render(
      <Panel variant="list">
        <PanelRow>Alice</PanelRow>
      </Panel>
    );
    expect(screen.getByText('Alice').parentElement).toHaveClass('rounded-[inherit]');
    rerender(
      <Panel variant="list" title="Members">
        <PanelRow>Alice</PanelRow>
      </Panel>
    );
    const rows = screen.getByText('Alice').parentElement!;
    expect(rows).toHaveClass('rounded-b-[inherit]');
    expect(rows).not.toHaveClass('rounded-[inherit]');
  });

  it('keeps a sub-section’s title, description and content side by side', () => {
    render(
      <PanelSection title="Danger zone" description="This can't be undone.">
        <button type="button">Delete wishlist</button>
      </PanelSection>
    );
    const section = screen.getByRole('heading', { level: 3, name: 'Danger zone' }).parentElement!;
    expect(section).toHaveTextContent("This can't be undone.");
    expect(screen.getByRole('button', { name: 'Delete wishlist' }).parentElement).toBe(section);
  });
});

describe('Spinner', () => {
  it('is silent unless it has to say what’s happening', () => {
    const { container, rerender } = render(<Spinner />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    rerender(<Spinner label="Uploading" />);
    expect(screen.getByRole('status', { name: 'Uploading' })).toHaveClass('spinner');
  });
});
