import mongoose, { Schema, Model } from 'mongoose';

/**
 * A group (WIS-27): a private tag its owner puts on people they follow, such as
 * "Family" or "Close friends". Only the owner ever reads it: nobody is told
 * which groups they're in, what they're called, or that any exist. One person
 * can be in any number of the owner's groups.
 *
 * Every read and write goes through `lib/utils/peopleGroups.ts`, filtered on
 * `owner`, which keeps the limits (`GROUP_LIMIT` groups, `GROUP_MEMBER_LIMIT`
 * people in each) and the rule that only people the owner follows are in one:
 * unfollowing takes them out (`DELETE /api/users/[id]/follow`), and deleting
 * an account deletes its groups and takes it out of everyone else's
 * (`deleteAccount`). A group is never linked to a list: deleting one, or
 * taking someone out, changes no membership or invite.
 */
const PeopleGroupSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    // The name folded for the per-owner uniqueness check (`groupNameKey`).
    nameKey: { type: String, required: true },
    members: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
  },
  { timestamps: true }
);

// One name per owner, whatever its case; also the owner's groups in one read.
// The collection is new, so autoIndex builds these on an empty collection and
// no migration is needed.
PeopleGroupSchema.index({ owner: 1, nameKey: 1 }, { unique: true });
// The groups someone is in (unfollow, account deletion).
PeopleGroupSchema.index({ members: 1 });

export interface IPeopleGroup {
  _id: mongoose.Types.ObjectId;
  owner: mongoose.Types.ObjectId;
  name: string;
  nameKey: string;
  members: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const PeopleGroup: Model<IPeopleGroup> =
  mongoose.models.PeopleGroup || mongoose.model<IPeopleGroup>('PeopleGroup', PeopleGroupSchema);

export default PeopleGroup;
