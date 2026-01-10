# Quick Start Guide

## Your POS System is Ready!

The server is currently running at: **http://localhost:3000**

## Access the Application

1. Open your web browser
2. Go to: `http://localhost:3000`
3. Login with:
   - Username: `demo`
   - Password: `demo123`

## First Steps

1. **Open a Till Session**
   - Click "Manage Till" button
   - Enter opening balance (e.g., 1000)
   - Click OK

2. **Make Your First Sale**
   - Browse products on the left
   - Click a product to add to cart
   - Adjust quantities with +/- buttons
   - Select payment method
   - Click "Complete Sale"

3. **Close Till Session**
   - Click "Manage Till" button
   - Enter closing balance
   - View variance (difference between expected and actual)

## What's Included

- 10 demo products with stock
- Full shopping cart functionality
- Multiple payment methods (Cash, Card, Account)
- Automatic VAT calculation (15%)
- Till session tracking
- Sales history

## Next Steps

### Put on GitHub

```bash
# 1. Create a new repository on GitHub.com
# 2. Then run these commands:

git remote add origin https://github.com/YOUR-USERNAME/pos-system.git
git branch -M main
git push -u origin main
```

### Deploy to Live Server

See [DEPLOYMENT.md](DEPLOYMENT.md) for step-by-step instructions to deploy on:
- **Render** (Recommended - Free tier)
- **Railway** (Free $5 credit)
- **Heroku** (Paid)

## Server Commands

```bash
# Start server
npm start

# Start with auto-reload (development)
npm run dev

# Reset database
npm run init-db
```

## Troubleshooting

**Server won't start?**
- Make sure port 3000 is not in use
- Check that all dependencies are installed (`npm install`)

**Can't login?**
- Make sure database is initialized (`npm run init-db`)
- Use credentials: demo / demo123

**Products not showing?**
- Reinitialize database: `npm run init-db`

## File Structure

```
Point of Sale/
├── POS_App/           # Frontend files
├── routes/            # API endpoints
├── middleware/        # Authentication
├── server.js          # Main server
├── database.js        # DB connection
├── init-database.js   # DB setup
└── README.md          # Full documentation
```

## Demo Data

**User:**
- Username: demo
- Password: demo123
- Role: cashier

**Products:** 10 items ranging from Coca Cola to Coffee

**Till:** Main Till (TILL-001) at Front Counter

## Need Help?

- Check [README.md](README.md) for full documentation
- Check [DEPLOYMENT.md](DEPLOYMENT.md) for deployment guides
- View server logs in the terminal

---

**Enjoy your new POS System!**
