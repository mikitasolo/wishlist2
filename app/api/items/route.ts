import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Item from '@/models/Item';

// GET /api/items - Get all items (public)
// Admin and public users don't see bookedBy to avoid spoiling surprises
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    
    await connectDB();
    const items = await Item.find({}).sort({ createdAt: -1 });
    
    // Filter items based on user role
    const filteredItems = items.map((item) => {
      const itemObj = item.toObject();
      
      // Hide bookedBy from admin and non-authenticated users
      if (!session?.user || session.user.role === 'admin') {
        // For admin and public: hide booking details completely
        if (itemObj.status === 'booked') {
          return {
            ...itemObj,
            status: 'available', // Show as available to avoid spoiling
            bookedBy: undefined,
          };
        }
        return { ...itemObj, bookedBy: undefined };
      }
      
      // For regular authenticated users: keep all data (they need to see what they booked)
      return itemObj;
    });
    
    return NextResponse.json({ success: true, data: filteredItems }, { status: 200 });
  } catch (error) {
    console.error('Error fetching items:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch items' },
      { status: 500 }
    );
  }
}

// POST /api/items - Create a new item (admin only)
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

    await connectDB();
    const body = await request.json();
    
    const item = await Item.create({
      name: body.name,
      imageUrl: body.imageUrl,
      price: body.price,
      link: body.link,
      status: body.status || 'available',
      bookedBy: body.bookedBy || null,
    });

    return NextResponse.json({ success: true, data: item }, { status: 201 });
  } catch (error) {
    console.error('Error creating item:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create item' },
      { status: 500 }
    );
  }
}

