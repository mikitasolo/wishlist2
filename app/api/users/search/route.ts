import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';

// GET /api/users/search?email=... - Search for a user by email (no auth required)
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const email = searchParams.get('email');

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Email parameter is required' },
        { status: 400 }
      );
    }

    await connectDB();

    // Search for user by email (case-insensitive, exact match)
    const user = await User.findOne({
      email: email.toLowerCase().trim(),
    }).select('_id email');

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: user }, { status: 200 });
  } catch (error) {
    console.error('Error searching for user:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to search for user' },
      { status: 500 }
    );
  }
}

