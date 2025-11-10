import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import { sendInvitationEmail } from '@/lib/email';

/**
 * POST /api/migrations/create-admin
 * 
 * Creates an admin user via API endpoint (protected by secret key)
 * 
 * Usage:
 *   curl -X POST https://your-domain.com/api/migrations/create-admin \
 *     -H "Content-Type: application/json" \
 *     -H "X-Migration-Secret: your-secret-key" \
 *     -d '{"email": "user@example.com"}'
 * 
 * Environment Variables Required:
 *   - MIGRATION_SECRET: Secret key to protect this endpoint
 */
export async function POST(request: NextRequest) {
  try {
    // Verify secret key from header
    const secretKey = request.headers.get('X-Migration-Secret');
    const expectedSecret = process.env.MIGRATION_SECRET;

    if (!expectedSecret) {
      console.error('MIGRATION_SECRET environment variable is not set');
      return NextResponse.json(
        { message: 'Migration endpoint is not configured' },
        { status: 500 }
      );
    }

    if (!secretKey || secretKey !== expectedSecret) {
      return NextResponse.json(
        { message: 'Unauthorized - Invalid secret key' },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json(
        { message: 'Email is required' },
        { status: 400 }
      );
    }

    await connectDB();

    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    
    if (existingUser) {
      // User already exists - return without updating
      return NextResponse.json(
        {
          message: 'User already exists',
        },
        { status: 409 }
      );
    }

    // Create new admin user
    const user = await User.create({
      email: normalizedEmail,
      role: 'admin',
      isInvited: true,
      invitedBy: 'system',
      isArchived: false,
      emailVerified: null,
    });

    // Send invitation email
    let emailSent = false;
    let emailError: string | null = null;

    try {
      await sendInvitationEmail(normalizedEmail, 'Mikita Salasniuk (Wishlist Admin)');
      emailSent = true;
    } catch (error: any) {
      emailError = error.message || 'Failed to send email';
      console.error('Failed to send invitation email:', error);
    }

    return NextResponse.json(
      {
        message: 'Admin user created successfully',
        emailSent,
        emailError: emailError || undefined,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Error in create-admin migration:', error);
    return NextResponse.json(
      {
        message: error.message || 'Failed to create admin user',
      },
      { status: 500 }
    );
  }
}

