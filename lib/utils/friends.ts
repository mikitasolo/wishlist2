import mongoose from 'mongoose';
import Follow from '@/models/Follow';

type Id = string | mongoose.Types.ObjectId;

const oid = (id: Id) => new mongoose.Types.ObjectId(id.toString());

/** Ids of users who are mutual follows (friends) of `userId`. */
export async function getFriendIds(userId: Id): Promise<string[]> {
  const me = oid(userId);
  // People I follow
  const following = await Follow.find({ follower: me }).select('following').lean();
  const followingIds = following.map((f) => f.following.toString());
  if (followingIds.length === 0) return [];
  // Of those, the ones who also follow me back
  const mutual = await Follow.find({
    follower: { $in: followingIds.map(oid) },
    following: me,
  })
    .select('follower')
    .lean();
  return mutual.map((f) => f.follower.toString());
}

/** Whether two users are friends (mutual follow). */
export async function areFriends(a: Id, b: Id): Promise<boolean> {
  if (a.toString() === b.toString()) return false;
  const edges = await Follow.countDocuments({
    $or: [
      { follower: oid(a), following: oid(b) },
      { follower: oid(b), following: oid(a) },
    ],
  });
  return edges === 2;
}

/** Follow relationship of `viewer` toward `target`. */
export async function getFollowInfo(
  viewer: Id,
  target: Id
): Promise<{ isFollowing: boolean; followsYou: boolean; isFriend: boolean }> {
  if (viewer.toString() === target.toString()) {
    return { isFollowing: false, followsYou: false, isFriend: false };
  }
  const [out, back] = await Promise.all([
    Follow.exists({ follower: oid(viewer), following: oid(target) }),
    Follow.exists({ follower: oid(target), following: oid(viewer) }),
  ]);
  return {
    isFollowing: !!out,
    followsYou: !!back,
    isFriend: !!out && !!back,
  };
}
