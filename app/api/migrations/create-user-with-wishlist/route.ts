import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import Item from '@/models/Item';
import WishlistMember from '@/models/WishlistMember';
import { getEnvVars } from '@/lib/env';

// Items data from wishlist.items.json
const itemsData = [
  {
    "imageUrl": "https://flipperzero.one/img/tild6566-3434-4266-b037-646663393733__fpr_web_1.jpg",
    "name": "Flipper Zero",
    "link": "https://flipperzero.one/",
    "status": "completed"
  },
  {
    "imageUrl": "https://m.media-amazon.com/images/I/51N0jRIIopL.jpg",
    "name": "Steam Deck OLED 1TB",
    "link": "https://store.steampowered.com/steamdeck/",
    "status": "available",
    "priceInCents": 85000
  },
  {
    "imageUrl": "https://allegro.stati.pl/AllegroIMG/PRODUCENCI/TP-LINK/Tapo-C225/tp-link-obrotowa-kamera-wewnetrzna-tapo-c225-lifestyle.jpg",
    "name": "TP-LINK Tapo C225",
    "link": "https://www.mediaexpert.pl/komputery-i-tablety/urzadzenia-sieciowe/kamery-ip/kamera-tp-link-tapo-c225",
    "status": "completed"
  },
  {
    "imageUrl": "https://ivroxe.com/mokotow/wp-content/uploads/2023/10/podarunkovij-sertifikat-1-1024x1024.jpg",
    "name": "Ivroxe Gift Voucher",
    "link": "https://ivroxe.com/mokotow/vouchers/",
    "status": "available"
  },
  {
    "imageUrl": "https://i02.appmifile.com/mi-com-product/fly-birds/xiaomi-smart-humidifier-2/25418f65cb3dbed3d703467774113b60.jpg?f=webp",
    "name": "Xiaomi Smart Humidifier 2",
    "link": "https://www.mi.com/pl/product/xiaomi-smart-humidifier-2/",
    "status": "completed"
  },
  {
    "imageUrl": "https://haybcoffee.pl/wp-content/uploads/2021/07/barista-300x300.png",
    "name": "Barista course from HAYB",
    "link": "https://haybcoffee.pl/produkt/kurs-barista",
    "status": "available",
    "priceInCents": 30000
  },
  {
    "imageUrl": "https://i.postimg.cc/6QFzB0Hz/Group-1.png",
    "name": "LELIT58 bottomless filterholder",
    "link": "https://www.amazon.pl/LELIT58-bottomless-filterholder-design-handle/dp/B082BQCKLM/",
    "status": "completed"
  },
  {
    "imageUrl": "https://www.bobovr.com/cdn/shop/files/20240524-201604.jpg?v=1716552997&width=1536",
    "name": "BOBOVR C3 Carrying Case",
    "link": "https://www.bobovr.com/products/c3",
    "status": "available",
    "priceInCents": 7500
  },
  {
    "imageUrl": "https://www.bobovr.com/cdn/shop/files/20240709-170114.png?v=1721718751&width=1536",
    "name": "BOBOVR G3 Plus Controller Grips Cover",
    "link": "https://www.bobovr.com/products/g3plus",
    "status": "available",
    "priceInCents": 3500
  },
  {
    "imageUrl": "https://www.bobovr.com/cdn/shop/files/1_ec2f6fcc-cca6-44d9-bd16-47094c3a0fbc.png?v=1711676221&width=1536",
    "name": "BOBOVR B100U Upgrade Kit",
    "link": "https://www.bobovr.com/products/b100u",
    "status": "available",
    "priceInCents": 6000
  },
  {
    "imageUrl": "https://haybcoffee.pl/wp-content/uploads/2021/07/latter-art-300x300.png",
    "name": "Latte Art course from HAYB",
    "link": "https://haybcoffee.pl/produkt/latte-art/",
    "status": "available",
    "priceInCents": 30000
  },
  {
    "imageUrl": "https://ireland.apollo.olxcdn.com/v1/files/nqydoc6lmtcd2-PL/image;s=4000x3000",
    "name": "Hama Beads / IKEA PYSSLA",
    "status": "completed"
  },
  {
    "imageUrl": "https://assets.mmsrg.com/isr/166325/c1/-/ASSET_MMS_146657251?x=1400&y=700&format=jpg&quality=80&sp=yes&strip=yes&trim&ex=1800&ey=1000&align=center&resizesource&unsharp=1.5x1+0.7+0.02&cox=0&coy=0&cdx=1800&cdy=1800",
    "name": "TP-LINK Archer AXE75",
    "link": "https://mediamarkt.pl/pl/product/_router-tp-link-archer-axe75-wi-fi-6e-axe5400-1486453.html",
    "status": "completed"
  },
  {
    "imageUrl": "https://img.kavosdraugas.lt/837e6f74-cc35-4020-be0b-88bf7c83fbc7/1000x1000/fellelatmos12cl-3png.jpg",
    "name": "Fellow Atmos 1.2l Glass",
    "link": "https://www.coffeedesk.pl/product/8500/Fellow-Atmos-Pojemnik-Prozniowy-1.2L-Szklo",
    "status": "completed",
    "priceInCents": 5400
  },
  {
    "imageUrl": "https://a.allegroimg.com/s1440/11e6ac/80caae624c3a9c1da9b7237edc14/Kawa-ziarnista-spieciality-Brazylia-Daterra-Masterpiece-Geisha-200-g",
    "name": "Brazylia Daterra Masterpiece Geisha 200g (MEDIUM ROAST)",
    "link": "https://allegro.pl/oferta/kawa-ziarnista-spieciality-brazylia-daterra-masterpiece-geisha-200-g-15932567637",
    "status": "completed"
  },
  {
    "name": "Merkur 34C",
    "imageUrl": "https://a.allegroimg.com/original/114ba9/fa1829884b55916ed939c26997d8/Merkur-34-maszynka-do-golenia",
    "priceInCents": 6000,
    "link": "https://amzn.eu/d/4HuDU5y",
    "status": "available"
  },
  {
    "name": "Dunhill Icon",
    "imageUrl": "https://www.elnino-parfum.pl/data/cache/thumb_min500_max1000-min500_max1000-12/products/41834/1522317318/dunhill-icon-absolute-woda-perfumowana-dla-mezczyzn-100-ml-213049.jpg",
    "priceInCents": 4500,
    "link": "https://amzn.eu/d/5UBAjuq",
    "status": "available"
  },
  {
    "name": "Lalique Encre Noire",
    "imageUrl": "https://drogeria.pl/img/imagecache/614001-615000/ac04802ff093ad7f30eea3d6d18e17e9ddcdeae0.jpg",
    "priceInCents": 3000,
    "link": "https://www.notino.pl/lalique/encre-noire-for-men-woda-toaletowa-dla-mczyzn/",
    "status": "available"
  },
  {
    "name": "Aeropress Carafe",
    "imageUrl": "https://cdn-prod.coffeedesk.io/thumbnail/90/1b/31/1730718906/aeropress-serwer-600ml_1920x1920.jpg",
    "priceInCents": 2700,
    "link": "https://www.coffeedesk.pl/product/28061/Aeropress-Serwer-600Ml",
    "status": "available"
  },
  {
    "name": "Fellow Prismo",
    "imageUrl": "https://cdn-prod.coffeedesk.io/thumbnail/25/4c/ac/1730723037/fellow-prismo_1920x1920.jpg",
    "priceInCents": 2800,
    "link": "https://www.coffeedesk.pl/product/5712/Fellow-Prismo",
    "status": "available"
  },
  {
    "name": "Fellow Atmos 1.2l Matte Black",
    "imageUrl": "https://www.wholelattelove.com/cdn/shop/products/Atmos-Hero-MB-L.png?v=1615501530&width=1946",
    "priceInCents": 5400,
    "link": "https://www.coffeedesk.pl/product/8503/Fellow-Atmos-Pojemnik-Prozniowy-1-2L-Stal-Czarny-Mat",
    "status": "available"
  }
];

// POST /api/migrations/create-user-with-wishlist
// Creates a user with email nikita.solo.1134@gmail.com, a wishlist, imports items from JSON, and adds members
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

    const ownerEmail = 'nikita.solo.1134@gmail.com';
    const memberEmails = ['dias008008@gmail.com', 'annahikka@gmail.com'];

    // Find or create owner user
    let owner = await User.findOne({ email: ownerEmail.toLowerCase() });
    
    if (!owner) {
      owner = await User.create({
        email: ownerEmail.toLowerCase(),
      });
    }

    // Check if wishlist already exists for this user
    let wishlist = await Wishlist.findOne({ 
      owner: owner._id, 
      name: 'Default wishlist' 
    });
    
    if (wishlist) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Wishlist already exists for this user',
          data: {
            userId: owner._id.toString(),
            wishlistId: wishlist._id.toString(),
          }
        },
        { status: 400 }
      );
    }

    // Create wishlist
    wishlist = await Wishlist.create({
      name: 'Default wishlist',
      owner: owner._id,
      isPublic: false,
    });

    // Create items from JSON data
    const items = [];
    for (const itemData of itemsData) {
      const item = await Item.create({
        wishlist: wishlist._id,
        name: itemData.name,
        imageUrl: itemData.imageUrl,
        link: itemData.link || null,
        priceInCents: itemData.priceInCents || null,
        status: itemData.status || 'available',
        bookedBy: null, // Clear bookedBy for migration
      });
      items.push(item);
    }

    // Find or create member users and add them to wishlist (without sending emails)
    const members = [];
    for (const memberEmail of memberEmails) {
      let memberUser = await User.findOne({ email: memberEmail.toLowerCase() });
      
      if (!memberUser) {
        memberUser = await User.create({
          email: memberEmail.toLowerCase(),
        });
      }

      // Check if membership already exists
      const existingMembership = await WishlistMember.findOne({
        wishlist: wishlist._id,
        user: memberUser._id,
      });

      if (!existingMembership) {
        const membership = await WishlistMember.create({
          wishlist: wishlist._id,
          user: memberUser._id,
          role: 'member',
        });
        members.push({
          email: memberUser.email,
          membershipId: membership._id.toString(),
        });
      } else {
        members.push({
          email: memberUser.email,
          membershipId: existingMembership._id.toString(),
          note: 'Membership already existed',
        });
      }
    }

    return NextResponse.json({ 
      success: true, 
      data: {
        user: {
          _id: owner._id.toString(),
          email: owner.email,
        },
        wishlist: {
          _id: wishlist._id.toString(),
          name: wishlist.name,
          isPublic: wishlist.isPublic,
        },
        itemsCreated: items.length,
        membersAdded: members.length,
        members: members,
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
