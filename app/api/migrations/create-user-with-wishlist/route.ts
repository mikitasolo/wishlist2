import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import Item from '@/models/Item';
import { getEnvVars } from '@/lib/env';

// POST /api/migrations/create-user-with-wishlist
// Creates a user with email aliaksei.lepik@gmail.com, a private wishlist, and one item
export async function POST(request: NextRequest) {
  try {
    // Check migration secret
    const authHeader = request.headers.get('X-Migration-Secret');
    const expectedSecret = getEnvVars().MIGRATION_SECRET;
    
    if (!authHeader || authHeader !== expectedSecret) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Invalid migration secret' },
        { status: 401 }
      );
    }

    await connectDB();

    const email = 'aliaksei.lepik@gmail.com';

    // Check if user already exists
    let user = await User.findOne({ email: email.toLowerCase() });
    
    if (user) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'User already exists',
          data: {
            userId: user._id.toString(),
            email: user.email,
          }
        },
        { status: 400 }
      );
    }

    // Create user
    user = await User.create({
      email: email.toLowerCase(),
    });

    // Create private wishlist
    const wishlist = await Wishlist.create({
      name: 'Default wishlist',
      owner: user._id,
      isPublic: false,
    });

    // Create item
    const item = await Item.create({
      wishlist: wishlist._id,
      name: 'велокомпас',
      imageUrl: 'https://a.allegroimg.com/s512/11304c/dd4acefa4e049d3cab5bd8638a03/Beeline-VELO-2-GPS-Kompas-Kompaktowa-nawigacja-na-Rower-Hulajnoge',
      link: 'https://allegro.pl/oferta/beeline-velo-2-gps-kompas-kompaktowa-nawigacja-na-rower-hulajnoge-17404066643',
      status: 'available',
    });

    return NextResponse.json({ 
      success: true, 
      data: {
        user: {
          _id: user._id.toString(),
          email: user.email,
        },
        wishlist: {
          _id: wishlist._id.toString(),
          name: wishlist.name,
          isPublic: wishlist.isPublic,
        },
        item: {
          _id: item._id.toString(),
          name: item.name,
        },
      }
    }, { status: 201 });
  } catch (error) {
    console.error('Error in migration:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to run migration',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

