# 🎁 Wishlist Application

A beautiful, modern wishlist application built with Next.js, React, TypeScript, and MongoDB. Share your wishlist with friends who can view and book items they plan to gift you.

## ✨ Features

- 🎁 View wishlist items with beautiful card layout
- 🖼️ Display items with images, prices, and product links
- 📌 Book items (mark as reserved for gift-giving)
- ✅ Mark items as completed
- 🎨 Beautiful, modern UI with Tailwind CSS
- 📱 Fully responsive design
- 🔍 Filter items by status (All, Available, Booked, Completed)
- 📊 Real-time statistics dashboard
- 🔒 Read-only for friends (items managed manually or via admin interface)

## 🛠️ Tech Stack

- **Frontend**: Next.js 14, React 18, TypeScript
- **Styling**: Tailwind CSS
- **Database**: MongoDB with Mongoose
- **Deployment**: Vercel
- **Image Optimization**: Next.js Image component

## 📋 Prerequisites

Before you begin, ensure you have:

- Node.js 18+ installed
- A MongoDB database (MongoDB Atlas recommended)
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

### 3. Set up environment variables

Create a `.env.local` file in the root directory:

```bash
MONGODB_URI=your_mongodb_connection_string_here
```

**To get your MongoDB connection string:**

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Sign in or create an account
3. Create a cluster (free tier available)
4. Click "Connect" on your cluster
5. Choose "Connect your application"
6. Copy the connection string
7. Replace `<password>` with your database user password
8. Replace `<database>` with your database name (e.g., `wishlist`)

Example:
```
MONGODB_URI=mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/wishlist?retryWrites=true&w=majority
```

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to see the application.

## 🌐 Deploying to Vercel

### Option 1: Deploy via Vercel Dashboard

1. Push your code to GitHub, GitLab, or Bitbucket
2. Go to [Vercel](https://vercel.com)
3. Click "New Project"
4. Import your repository
5. Vercel will automatically detect Next.js
6. Add your environment variable:
   - Key: `MONGODB_URI`
   - Value: Your MongoDB connection string
7. Click "Deploy"

### Option 2: Deploy via Vercel CLI

1. Install Vercel CLI:
```bash
npm i -g vercel
```

2. Login to Vercel:
```bash
vercel login
```

3. Deploy:
```bash
vercel
```

4. Follow the prompts and add your environment variables when asked

5. For production deployment:
```bash
vercel --prod
```

### Setting Environment Variables in Vercel

After deployment, you can manage environment variables in the Vercel Dashboard:

1. Go to your project in Vercel Dashboard
2. Navigate to Settings → Environment Variables
3. Add `MONGODB_URI` with your connection string
4. Choose which environments to apply it to (Production, Preview, Development)
5. Save and redeploy if necessary

## 🎯 Use Case

This wishlist is designed to be **shared with friends and family**. They can:
- View all your wishlist items
- Book items they plan to gift you (so others know it's taken)
- Mark items as completed when gifted
- Filter items by status

Items are managed directly in MongoDB or via an admin interface (to be built separately). The public-facing site is **read-only except for booking/completion status**.

## 📦 Project Structure

```
wishlist2/
├── app/                      # Next.js app directory
│   ├── api/                 # API routes
│   │   └── items/          # Items CRUD endpoints
│   ├── globals.css         # Global styles
│   ├── layout.tsx          # Root layout
│   └── page.tsx            # Main wishlist page
├── components/              # React components
│   ├── AddItemModal.tsx    # Modal for adding items (for future admin use)
│   └── WishlistItem.tsx    # Individual item card
├── lib/                     # Utility functions
│   └── mongodb.ts          # MongoDB connection
├── models/                  # Mongoose models
│   └── Item.ts             # Item schema
├── public/                  # Static assets
├── .env.local              # Local environment variables (create this)
├── .env.example            # Example environment variables
├── .gitignore              # Git ignore rules
├── next.config.js          # Next.js configuration
├── package.json            # Dependencies
├── postcss.config.js       # PostCSS configuration
├── tailwind.config.ts      # Tailwind CSS configuration
├── tsconfig.json           # TypeScript configuration
└── vercel.json             # Vercel deployment configuration
```

## 🔌 API Endpoints

### Get all items
```
GET /api/items
Response: { success: true, data: [...items] }
```

### Create a new item
```
POST /api/items
Body: {
  name: string (required)
  imageUrl: string (required)
  price?: string
  link?: string
  isBooked?: boolean
  isCompleted?: boolean
}
Response: { success: true, data: item }
```

### Update an item
```
PATCH /api/items/[id]
Body: {
  name?: string
  imageUrl?: string
  price?: string
  link?: string
  isBooked?: boolean      // Used by friends to book/reserve items
  isCompleted?: boolean   // Used by friends to mark as gifted
}
Response: { success: true, data: item }
```

### Delete an item
```
DELETE /api/items/[id]
Response: { success: true, data: {} }
```

**Note:** The public-facing UI only allows updating `isBooked` and `isCompleted` fields. POST and DELETE operations are available via API for admin/manual management.

## 📝 Item Schema

```typescript
{
  name: string          // Required - Item name
  imageUrl: string      // Required - Image URL
  price?: string        // Optional - Price
  link?: string         // Optional - Product link
  isCompleted: boolean  // Default: false - Completion status
  isBooked: boolean     // Default: false - Booking status
}
```

## 🎨 Customization

### Colors

The app uses a pink/purple color scheme. To customize, edit `tailwind.config.ts`:

```typescript
colors: {
  primary: {
    // Your custom colors
  },
}
```

### Background

Edit the gradient in `app/globals.css`:

```css
:root {
  --background-start-rgb: 252, 231, 243;
  --background-end-rgb: 255, 255, 255;
}
```

## 🐛 Troubleshooting

### MongoDB Connection Issues

- Ensure your IP address is whitelisted in MongoDB Atlas (Network Access)
- Verify your database user has the correct permissions
- Check that your connection string is correctly formatted

### Build Errors

- Clear Next.js cache: `rm -rf .next`
- Delete node_modules and reinstall: `rm -rf node_modules && npm install`
- Ensure all environment variables are set

### Vercel Deployment Issues

- Check that environment variables are set in Vercel Dashboard
- Review build logs in Vercel for specific errors
- Ensure your MongoDB cluster allows connections from anywhere (0.0.0.0/0)

## 📄 License

MIT License - feel free to use this project for personal or commercial purposes.

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

## 👤 Author

Created with ❤️ for wishlist management

---

**Happy wishing! 🎁✨**

