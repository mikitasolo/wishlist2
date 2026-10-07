import mongoose from 'mongoose';
import PeopleGroup from '@/models/PeopleGroup';
import Follow from '@/models/Follow';
import User from '@/models/User';
import { isDuplicateKeyError } from '@/lib/utils/mongoErrors';
import { isObjectIdParam } from '@/lib/utils/objectId';
import { publicDisplayName } from '@/lib/utils/displayName';
import {
  DUPLICATE_GROUP_NAME,
  GROUP_LIMIT,
  GROUP_MEMBER_LIMIT,
  groupNameKey,
  type GroupPerson,
  type GroupView,
} from '@/lib/utils/groupRules';

/**
 * Groups (WIS-27): private tags on the people you follow. Every read and write
 * of `PeopleGroup` goes through here and is filtered on its owner, so a group
 * that isn't the caller's answers exactly as one that doesn't exist: nobody but
 * its owner can read, list, change or infer it.
 */

export { GROUP_LIMIT, GROUP_MEMBER_LIMIT, DUPLICATE_GROUP_NAME };
export type { GroupPerson, GroupView };

function oid(id: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(id);
}

/** The owner's own group with this id, as a query filter; null when the id can't be one. */
function ownGroupFilter(ownerId: string, groupId: string) {
  if (!isObjectIdParam(groupId)) return null;
  return { _id: oid(groupId), owner: oid(ownerId) };
}

async function follows(ownerId: string, userId: string): Promise<boolean> {
  return !!(await Follow.exists({ follower: oid(ownerId), following: oid(userId) }));
}

/** The caller's groups, oldest first, each with the people in it (still followed and still there). */
export async function listGroups(ownerId: string): Promise<GroupView[]> {
  const groups = await PeopleGroup.find({ owner: oid(ownerId) })
    .select('name members')
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  const ids = [...new Set(groups.flatMap((g) => g.members.map((m) => m.toString())))];
  // Only people still followed, as `groupMemberIds` reads them, so what the
  // owner sees is what acting on the group would reach.
  const followed: mongoose.Types.ObjectId[] = ids.length
    ? await Follow.distinct('following', {
        follower: oid(ownerId),
        following: { $in: ids.map(oid) },
      })
    : [];
  const users = followed.length
    ? await User.find({ _id: { $in: followed } })
        .select('username name image')
        .lean()
    : [];
  const people = new Map<string, GroupPerson>(
    users.map((u) => [
      u._id.toString(),
      {
        id: u._id.toString(),
        username: u.username ?? null,
        displayName: publicDisplayName(u),
        image: u.image ?? null,
      },
    ])
  );
  return groups.map((g) => ({
    id: g._id.toString(),
    name: g.name,
    members: g.members
      .map((m) => people.get(m.toString()))
      .filter((p): p is GroupPerson => !!p)
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  }));
}

export type CreateGroupResult =
  { status: 'created'; group: GroupView } | { status: 'limit' } | { status: 'duplicate' };

/**
 * Make a group. The limit is checked before the insert and again after it: two
 * creates racing at 19 groups both see 21 and both give theirs back, so the
 * owner never ends up over `GROUP_LIMIT` (and can simply try again).
 */
export async function createGroup(ownerId: string, name: string): Promise<CreateGroupResult> {
  const owner = oid(ownerId);
  if ((await PeopleGroup.countDocuments({ owner })) >= GROUP_LIMIT) return { status: 'limit' };
  let created;
  try {
    created = await PeopleGroup.create({ owner, name, nameKey: groupNameKey(name), members: [] });
  } catch (err) {
    if (isDuplicateKeyError(err)) return { status: 'duplicate' };
    throw err;
  }
  if ((await PeopleGroup.countDocuments({ owner })) > GROUP_LIMIT) {
    await PeopleGroup.deleteOne({ _id: created._id, owner });
    return { status: 'limit' };
  }
  return { status: 'created', group: { id: created._id.toString(), name, members: [] } };
}

/** Rename one of the caller's groups. */
export async function renameGroup(
  ownerId: string,
  groupId: string,
  name: string
): Promise<'renamed' | 'not-found' | 'duplicate'> {
  const filter = ownGroupFilter(ownerId, groupId);
  if (!filter) return 'not-found';
  try {
    const res = await PeopleGroup.updateOne(filter, {
      $set: { name, nameKey: groupNameKey(name) },
    });
    return res.matchedCount ? 'renamed' : 'not-found';
  } catch (err) {
    if (isDuplicateKeyError(err)) return 'duplicate';
    throw err;
  }
}

/** Delete one of the caller's groups. Only the tag goes: no list membership or invite changes. */
export async function deleteGroup(ownerId: string, groupId: string): Promise<boolean> {
  const filter = ownGroupFilter(ownerId, groupId);
  if (!filter) return false;
  const res = await PeopleGroup.deleteOne(filter);
  return res.deletedCount > 0;
}

export type AddGroupMemberResult = 'added' | 'not-found' | 'not-following' | 'full';

/**
 * Tag `userId` into one of the caller's groups: only someone the caller
 * follows. The size limit is part of the conditional write, so two adds can't
 * take a group past it. The follow is checked again after the write: an
 * unfollow landing in between (which takes them out of every group first, then
 * we'd put them back) is undone here, so nobody stays tagged who isn't followed.
 */
export async function addGroupMember(
  ownerId: string,
  groupId: string,
  userId: string
): Promise<AddGroupMemberResult> {
  const filter = ownGroupFilter(ownerId, groupId);
  if (!filter) return 'not-found';
  if (!(await PeopleGroup.exists(filter))) return 'not-found';
  if (!isObjectIdParam(userId) || userId === ownerId || !(await follows(ownerId, userId))) {
    return 'not-following';
  }
  const member = oid(userId);
  const res = await PeopleGroup.updateOne(
    { ...filter, [`members.${GROUP_MEMBER_LIMIT - 1}`]: { $exists: false } },
    { $addToSet: { members: member } }
  );
  if (!res.matchedCount) {
    // Full, unless they're in it already (an add repeated), or it went meanwhile.
    const group = await PeopleGroup.findOne(filter).select('members').lean();
    if (!group) return 'not-found';
    if (!group.members.some((m) => m.equals(member))) return 'full';
  }
  if (!(await follows(ownerId, userId))) {
    await PeopleGroup.updateOne(filter, { $pull: { members: member } });
    return 'not-following';
  }
  return 'added';
}

/** Take someone out of one of the caller's groups. Changes no list membership or invite. */
export async function removeGroupMember(
  ownerId: string,
  groupId: string,
  userId: string
): Promise<boolean> {
  const filter = ownGroupFilter(ownerId, groupId);
  if (!filter) return false;
  // A malformed id is in no group: nothing to take out, the group is still there.
  if (!isObjectIdParam(userId)) return !!(await PeopleGroup.exists(filter));
  const res = await PeopleGroup.updateOne(filter, { $pull: { members: oid(userId) } });
  return res.matchedCount > 0;
}

/** Unfollowing someone takes them out of every group of the person who unfollowed. */
export async function removeFromOwnGroups(ownerId: string, userId: string): Promise<void> {
  const member = oid(userId);
  await PeopleGroup.updateMany(
    { owner: oid(ownerId), members: member },
    { $pull: { members: member } }
  );
}

/** Account deletion: its own groups go, and it leaves everyone else's. Repeatable. */
export async function eraseGroupsOf(userId: mongoose.Types.ObjectId): Promise<void> {
  await PeopleGroup.deleteMany({ owner: userId });
  await PeopleGroup.updateMany({ members: userId }, { $pull: { members: userId } });
}

/**
 * The ids of the people in one of `ownerId`'s groups, for acting on a whole
 * group at once (inviting it to a list, WIS-37), or null when it isn't one of
 * theirs (or doesn't exist): the same null either way, so a caller can't tell a
 * group of someone else's from none. Only people the owner still follows and
 * whose account still exists are in it, whatever a racing write left behind.
 * The owner's authority over what they do with it (inviting to a list) is the
 * caller's to check.
 */
export async function groupMemberIds(ownerId: string, groupId: string): Promise<string[] | null> {
  const filter = ownGroupFilter(ownerId, groupId);
  if (!filter) return null;
  const group = await PeopleGroup.findOne(filter).select('members').lean();
  if (!group) return null;
  if (group.members.length === 0) return [];
  const followed: mongoose.Types.ObjectId[] = await Follow.distinct('following', {
    follower: oid(ownerId),
    following: { $in: group.members },
  });
  const existing: mongoose.Types.ObjectId[] = await User.distinct('_id', {
    _id: { $in: followed },
  });
  const keep = new Set(existing.map((id) => id.toString()));
  return group.members.map((m) => m.toString()).filter((id) => keep.has(id));
}
