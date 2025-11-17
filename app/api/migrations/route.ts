import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Item from '@/models/Item';

/**
 * POST /api/migrations - Run database migrations
 * Requires X-Migration-Secret header to match MIGRATION_SECRET env variable
 */
export async function POST(request: NextRequest) {
  try {
    // Validate migration secret
    const secret = request.headers.get('X-Migration-Secret');
    const expectedSecret = process.env.MIGRATION_SECRET;

    if (!expectedSecret) {
      return NextResponse.json(
        { success: false, error: 'MIGRATION_SECRET environment variable is not set' },
        { status: 500 }
      );
    }

    if (secret !== expectedSecret) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Invalid migration secret' },
        { status: 401 }
      );
    }

    await connectDB();

    // Find all items
    const items = await Item.find({}).lean();

    let migrated = 0;
    let skipped = 0;
    let errors = 0;
    const errorMessages: string[] = [];

    for (const item of items) {
      try {
        // Use raw item from lean() query to access priceInCents field that's not in schema
        const hasPriceObject =
          item.price && typeof item.price === 'object' && 'value' in item.price;
        // Check if priceInCents field exists (even if null) - use 'in' operator to check for field existence
        const hasOldPriceInCents = 'priceInCents' in item;

        if (!hasOldPriceInCents) {
          // No priceInCents field to migrate or remove
          skipped++;
          continue;
        }

        const priceInCents = (item as any).priceInCents;

        if (hasPriceObject || priceInCents == null) {
          // Item already has price object, or priceInCents is null - just remove the field
          await Item.collection.updateOne(
            { _id: item._id },
            {
              $unset: {
                priceInCents: '',
              },
            }
          );
          migrated++;
          continue;
        }

        // Migrate: convert priceInCents to price object
        // Use collection.updateOne to bypass Mongoose schema validation
        // This allows us to unset fields that aren't in the schema
        await Item.collection.updateOne(
          { _id: item._id },
          {
            $set: {
              price: {
                value: priceInCents,
                currency: 'usd',
              },
            },
            $unset: {
              priceInCents: '',
            },
          }
        );

        migrated++;
      } catch (error) {
        errors++;
        const errorMessage = `Error migrating item ${item._id}: ${
          error instanceof Error ? error.message : String(error)
        }`;
        errorMessages.push(errorMessage);
        console.error(errorMessage);
      }
    }

    return NextResponse.json({
      success: errors === 0,
      migrated,
      skipped,
      errors,
      errorMessages: errorMessages.length > 0 ? errorMessages : undefined,
    });
  } catch (error) {
    console.error('Migration API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Migration failed',
      },
      { status: 500 }
    );
  }
}
