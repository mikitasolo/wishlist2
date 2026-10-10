// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SettingsNav, { SETTINGS_SECTIONS } from '@/components/SettingsNav';

describe('SettingsNav', () => {
  it('links every section, in page order, to its id', () => {
    render(<SettingsNav />);
    const links = screen.getAllByRole('link', { hidden: true });
    expect(links.map((a) => a.getAttribute('href'))).toEqual(
      SETTINGS_SECTIONS.map((s) => `#${s.id}`)
    );
  });

  it('keeps the existing deep links (#groups, #notifications) working', () => {
    const ids = SETTINGS_SECTIONS.map((s) => s.id) as string[];
    expect(ids).toEqual(expect.arrayContaining(['groups', 'notifications']));
  });
});
