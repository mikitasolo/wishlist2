# 🎁 Wishlist Application

A beautiful, modern wishlist application built with Next.js, React, TypeScript, and MongoDB. Share your wishlist with friends who can view and book items they plan to gift you.

## ✨ Features

- 🔐 **Three User Modes:**
  - **Public**: View-only access (no sign-in required)
  - **Authorized**: Book/unbook items with magic link authentication
  - **Admin**: Full CRUD operations + user management
  
- 🎁 View wishlist items with beautiful card layout
- 🖼️ Display items with images, prices, and product links
- 📌 Book items (mark as reserved for gift-giving)
- ✅ Mark items as completed
- 🎨 Beautiful, modern UI with Tailwind CSS
- 📱 Fully responsive design
- 🔍 Filter items by status (All, Available, Booked, Completed)
- 📊 Real-time statistics dashboard
- 🔒 Invitation-only authentication system
- ✉️ Magic link sign-in (no passwords needed)
- 👥 User management for admins
- 📧 Email notifications via Brevo

## 🛠️ Tech Stack

- **Frontend**: Next.js 14 (App Router), React 18, TypeScript
- **Authentication**: NextAuth.js with magic link
- **Email**: Brevo (Sendinblue) API
- **Styling**: Tailwind CSS
- **Database**: MongoDB with Mongoose
- **Deployment**: Vercel

## 📋 Prerequisites

Before you begin, ensure you have:

- Node.js 18+ installed
- A MongoDB database (MongoDB Atlas recommended)
- A Brevo (Sendinblue) account for sending emails
- npm or yarn package manager

## 🚀 Local Development Setup

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd wishlist2
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up MongoDB

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a cluster (free tier available)
3. Create a database user
4. Whitelist your IP address
5. Get your connection string

### 4. Set up Brevo (for magic link emails)

1. Sign up at [Brevo](https://www.brevo.com/)
2. Go to [API Settings](https://account.brevo.com/advanced/api)
3. Generate an API key
4. Verify your sender email address in Brevo

### 5. Configure environment variables

Create a `.env.local` file in the root directory:

```bash
# MongoDB
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/wishlist?retryWrites=true&w=majority

# NextAuth
NEXTAUTH_SECRET=your_secret_here  # Generate with: openssl rand -base64 32
NEXTAUTH_URL=http://localhost:3000

# Brevo Email
BREVO_API_KEY=your_brevo_api_key_here
EMAIL_FROM=noreply@yourdomain.com  # Must be verified in Brevo
```

**To generate NEXTAUTH_SECRET:**
```bash
openssl rand -base64 32
```

### 6. Create your admin user

Run the seeding script to create your admin account:

```bash
npm run seed-admin
```

Enter your email address when prompted. This will create an admin user in the database.

### 7. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the application.

### 8. Sign in as admin

1. Go to [http://localhost:3000/auth/signin](http://localhost:3000/auth/signin)
2. Enter your admin email
3. Check your email for the magic link
4. Click the link to sign in

## 🌐 Deploying to Vercel

### 1. Push your code to GitHub

```bash
git add .
git commit -m "Initial commit"
git push origin main
```

### 2. Deploy to Vercel

1. Go to [Vercel](https://vercel.com) and sign in
2. Click "New Project"
3. Import your GitHub repository
4. Configure environment variables (see below)
5. Deploy!

### 3. Set up environment variables in Vercel

In your Vercel project settings → Environment Variables, add:

| Variable | Value | Environment |
|----------|-------|-------------|
| `MONGODB_URI` | Your MongoDB connection string | Production, Preview, Development |
| `NEXTAUTH_SECRET` | Your generated secret | Production, Preview, Development |
| `NEXTAUTH_URL` | Your production URL (e.g., `https://wishlist.vercel.app`) | Production |
| `NEXTAUTH_URL` | Auto-generated preview URL | Preview |
| `NEXTAUTH_URL` | `http://localhost:3000` | Development |
| `BREVO_API_KEY` | Your Brevo API key | Production, Preview, Development |
| `EMAIL_FROM` | Your verified sender email | Production, Preview, Development |

### 4. Create admin user in production

After deployment, run the seed script against your production database:

```bash
# Set MONGODB_URI to your production database
MONGODB_URI="your_production_mongodb_uri" npm run seed-admin
```

## 👥 User Management

### Three User Modes

1. **Public (Unauthenticated)**
   - Can view all wishlist items
   - Cannot book or modify items
   - See "Sign in to book" prompts

2. **Authorized Users**
   - Invited by admin
   - Sign in via magic link
   - Can book/unbook items
   - Can mark items as completed
   - Cannot add/delete items

3. **Admin**
   - Full access to admin panel
   - Can create/edit/delete items
   - Can invite new users
   - Can view all users
   - Access to `/admin` dashboard

### Inviting Users

As an admin:

1. Go to `/admin`
2. Click on "Users" tab
3. Enter user's email
4. Select role (user or admin)
5. Click "Invite"

The user will receive an invitation email and can then sign in using the magic link.

## 📁 Project Structure

```
wishlist2/
├── app/
│   ├── admin/
│   │   └── page.tsx                # Admin panel
│   ├── api/
│   │   ├── auth/
│   │   │   └── [...nextauth]/
│   │   │       └── route.ts        # NextAuth API route
│   │   ├── invite/
│   │   │   └── route.ts            # User invitation API
│   │   └── items/
│   │       ├── route.ts            # Items CRUD
│   │       └── [id]/
│   │           └── route.ts        # Individual item operations
│   ├── auth/
│   │   ├── signin/
│   │   │   └── page.tsx            # Sign in page
│   │   ├── error/
│   │   │   └── page.tsx            # Auth error page
│   │   └── verify-request/
│   │       └── page.tsx            # Email sent confirmation
│   ├── globals.css                  # Global styles
│   ├── layout.tsx                   # Root layout with SessionProvider
│   └── page.tsx                     # Main wishlist page
├── components/
│   ├── AddItemModal.tsx            # Modal for adding items
│   ├── AuthButton.tsx              # Sign in/out button
│   ├── SessionProvider.tsx         # NextAuth session provider
│   └── WishlistItem.tsx            # Individual item card
├── lib/
│   ├── auth.ts                     # NextAuth configuration
│   ├── email.ts                    # Brevo email functions
│   └── mongodb.ts                  # MongoDB connection
├── models/
│   ├── Item.ts                     # Item schema
│   └── User.ts                     # User schema with roles
├── scripts/
│   └── seed-admin.ts               # Admin user creation script
├── types/
│   └── next-auth.d.ts              # NextAuth type extensions
├── .env.local                       # Local environment variables (create this)
├── .env.example                     # Example environment variables
├── .gitignore                       # Git ignore rules
├── next.config.js                   # Next.js configuration
├── package.json                     # Dependencies
├── tailwind.config.ts               # Tailwind CSS configuration
├── tsconfig.json                    # TypeScript configuration
└── vercel.json                      # Vercel deployment configuration
```

## 🔌 API Endpoints

### Authentication

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/api/auth/signin` | POST | Sign in with email | No |
| `/api/auth/signout` | POST | Sign out | Yes |
| `/api/auth/callback/email` | GET | Magic link callback | No |

### Items

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/api/items` | GET | Get all items | No (public) |
| `/api/items` | POST | Create item | Admin only |
| `/api/items/[id]` | PATCH | Update item | Yes (limited for users) |
| `/api/items/[id]` | DELETE | Delete item | Admin only |

**PATCH permissions:**
- **Users**: Can only update `isBooked` and `isCompleted`
- **Admins**: Can update all fields

### User Management

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/api/invite` | POST | Invite new user | Admin only |
| `/api/invite` | GET | List all users | Admin only |

## 📝 Data Models

### Item Schema

```typescript
{
  name: string          // Required - Item name
  imageUrl: string      // Required - Image URL
  price?: string        // Optional - Price
  link?: string         // Optional - Product link
  isCompleted: boolean  // Default: false - Completion status
  isBooked: boolean     // Default: false - Booking status
  createdAt: Date       // Auto-generated
  updatedAt: Date       // Auto-generated
}
```

### User Schema

```typescript
{
  email: string         // Required - User email (unique)
  role: 'user' | 'admin' // Required - User role
  isInvited: boolean    // Required - Invitation status
  invitedBy?: string    // Optional - Email of inviter
  createdAt: Date       // Auto-generated
  updatedAt: Date       // Auto-generated
}
```

## 🔐 Security Features

- ✅ Invitation-only authentication
- ✅ Magic link authentication (no password storage)
- ✅ Role-based access control
- ✅ JWT session tokens
- ✅ Protected API routes
- ✅ CSRF protection (NextAuth built-in)

## 🐛 Troubleshooting

### MongoDB Connection Issues

- Ensure your IP is whitelisted in MongoDB Atlas
- Verify database user permissions
- Check connection string format

### Email Not Sending

- Verify Brevo API key is correct
- Check that sender email is verified in Brevo
- Look for errors in terminal logs
- Ensure EMAIL_FROM matches verified sender

### Magic Link Not Working

- Check that NEXTAUTH_URL matches your domain
- Verify NEXTAUTH_SECRET is set
- Ensure link hasn't expired (24 hours)
- Check spam folder

### "Access Denied" on Sign In

- User must be invited first by an admin
- Check that user exists in database with `isInvited: true`
- Verify email address matches exactly

### Admin Panel Not Accessible

- Ensure you're signed in
- Verify your user has `role: 'admin'` in database
- Check browser console for errors

## 📄 License

MIT License - feel free to use this project for personal or commercial purposes.

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

## 👤 Author

Created with ❤️ for wishlist management

---

**Happy wishing! 🎁✨**
