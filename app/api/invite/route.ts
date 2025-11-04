import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import Session from '@/models/Session';
import { sendInvitationEmail } from '@/lib/email';

// POST /api/invite - Invite a new user (admin only)
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    // Check if user is authenticated and is admin
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Admin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { email, role = 'user' } = body;

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Email is required' },
        { status: 400 }
      );
    }

    await connectDB();

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return NextResponse.json(
        { success: false, error: 'User already invited' },
        { status: 400 }
      );
    }

    // Create invited user
    const user = await User.create({
      email: email.toLowerCase(),
      role,
      isInvited: true,
      invitedBy: session.user.email,
    });

    // Send invitation email
    await sendInvitationEmail(email, session.user.email || 'Admin');

    return NextResponse.json({ success: true, data: user }, { status: 201 });
  } catch (error) {
    console.error('Error inviting user:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to invite user' },
      { status: 500 }
    );
  }
}

// GET /api/invite - Get all invited users (admin only)
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    // Check if user is authenticated and is admin
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Admin access required' },
        { status: 403 }
      );
    }

    await connectDB();
    const users = await User.find({}).sort({ createdAt: -1 }).select('-__v');

    return NextResponse.json({ success: true, data: users }, { status: 200 });
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch users' },
      { status: 500 }
    );
  }
}

// PATCH /api/invite - Update user (archive/unarchive) (admin only)
export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    // Check if user is authenticated and is admin
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Admin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { userId, isArchived } = body;

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'User ID is required' },
        { status: 400 }
      );
    }

    await connectDB();

    // Prevent admins from archiving themselves
    const userToUpdate = await User.findById(userId);
    if (userToUpdate?.email === session.user.email) {
      return NextResponse.json(
        { success: false, error: 'Cannot archive yourself' },
        { status: 400 }
      );
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { isArchived },
      { new: true }
    );

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    // If archiving (not unarchiving), delete all active sessions for this user
    if (isArchived) {
      try {
        // Delete all sessions for this user using the Session model
        const result = await Session.deleteMany({ userId: user._id });
        console.log(`Deleted ${result.deletedCount} session(s) for archived user: ${user.email}`);
      } catch (error) {
        console.error('Error deleting sessions:', error);
        // Continue even if session deletion fails
      }
    }

    return NextResponse.json({ success: true, data: user }, { status: 200 });
  } catch (error) {
    console.error('Error updating user:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update user' },
      { status: 500 }
    );
  }
}

