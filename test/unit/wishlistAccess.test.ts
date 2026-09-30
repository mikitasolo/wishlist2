import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { isHiddenByArchive } from '@/lib/utils/wishlistAccess';

const A = new mongoose.Types.ObjectId();
const B = new mongoose.Types.ObjectId();

describe('isHiddenByArchive', () => {
  const archived = { owners: [A, B], archived: true };

  it('hides an archived list from anyone who is not one of its owners', () => {
    expect(isHiddenByArchive(archived, new mongoose.Types.ObjectId().toString())).toBe(true);
  });

  it('hides it from a signed-out viewer', () => {
    expect(isHiddenByArchive(archived, null)).toBe(true);
    expect(isHiddenByArchive(archived, undefined)).toBe(true);
  });

  it('never hides it from any of its owners', () => {
    expect(isHiddenByArchive(archived, A.toString())).toBe(false);
    expect(isHiddenByArchive(archived, B.toString())).toBe(false);
  });

  it('hides nothing on a list that is not archived', () => {
    expect(isHiddenByArchive({ owners: [A], archived: false }, null)).toBe(false);
    expect(isHiddenByArchive({ owners: [A] }, B.toString())).toBe(false);
  });
});
