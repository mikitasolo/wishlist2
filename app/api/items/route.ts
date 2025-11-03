import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Item from '@/models/Item';

// GET /api/items - Get all items
export async function GET() {
  try {
    await connectDB();
    const items = await Item.find({}).sort({ createdAt: -1 });
    return NextResponse.json({ success: true, data: items }, { status: 200 });
  } catch (error) {
    console.error('Error fetching items:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch items' },
      { status: 500 }
    );
  }
}

// POST /api/items - Create a new item
export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const body = await request.json();
    
    const item = await Item.create({
      name: body.name,
      imageUrl: body.imageUrl,
      price: body.price,
      link: body.link,
      isCompleted: body.isCompleted || false,
      isBooked: body.isBooked || false,
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

