# Deployment Guide

## Quick Deploy Options

### Option 1: Deploy to Render (Recommended - FREE)

1. **Create account at [Render.com](https://render.com)**

2. **Push your code to GitHub first** (see GitHub Setup below)

3. **Create New Web Service:**
   - Click "New +" > "Web Service"
   - Connect your GitHub repository
   - Choose "Point of Sale" repo

4. **Configure:**
   - Name: `your-pos-system`
   - Environment: `Node`
   - Build Command: `npm install && npm run init-db`
   - Start Command: `npm start`
   - Instance Type: `Free`

5. **Add Environment Variables:**
   - `JWT_SECRET`: Generate a random string
   - `NODE_ENV`: `production`

6. **Deploy!** Click "Create Web Service"

Your app will be live at: `https://your-pos-system.onrender.com`

---

### Option 2: Deploy to Railway (FREE)

1. **Visit [Railway.app](https://railway.app)**

2. **Click "Start a New Project"**

3. **Deploy from GitHub:**
   - Connect GitHub account
   - Select your "Point of Sale" repository

4. **Add Environment Variables:**
   - Go to Variables tab
   - Add `JWT_SECRET` with a secure random value
   - Add `NODE_ENV` as `production`

5. **Generate Domain:**
   - Go to Settings
   - Click "Generate Domain"

Your app will be live!

---

### Option 3: Deploy to Heroku

1. **Install Heroku CLI**
   ```bash
   npm install -g heroku
   ```

2. **Login:**
   ```bash
   heroku login
   ```

3. **Create app:**
   ```bash
   cd "Point of Sale"
   heroku create your-pos-app-name
   ```

4. **Set environment variables:**
   ```bash
   heroku config:set JWT_SECRET=your-super-secret-key
   heroku config:set NODE_ENV=production
   ```

5. **Deploy:**
   ```bash
   git push heroku main
   ```

6. **Initialize database:**
   ```bash
   heroku run npm run init-db
   ```

7. **Open app:**
   ```bash
   heroku open
   ```

---

## GitHub Setup (Required for most platforms)

1. **Create GitHub repository:**
   - Go to [GitHub.com](https://github.com)
   - Click "New repository"
   - Name: `pos-system`
   - Make it Public or Private
   - Don't initialize with README

2. **Push your code:**
   ```bash
   cd "Point of Sale"
   git add .
   git commit -m "Initial commit: Complete POS System"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/pos-system.git
   git push -u origin main
   ```

---

## Important Notes for Production

### Security
- Change the `JWT_SECRET` in `.env` to a long random string
- Never commit `.env` file (it's in `.gitignore`)
- Use HTTPS in production (most platforms provide this automatically)

### Database
- SQLite works fine for small deployments
- For heavy traffic, consider upgrading to PostgreSQL
- Regular backups recommended

### Environment Variables
Always set these in your hosting platform:
- `JWT_SECRET` - Random secure string (minimum 32 characters)
- `NODE_ENV` - Set to `production`
- `PORT` - Usually set automatically by the platform

---

## Testing Your Deployment

1. Visit your deployed URL
2. Login with:
   - Username: `demo`
   - Password: `demo123`
3. Open a till session
4. Add products to cart
5. Complete a sale
6. Close till session

---

## Custom Domain (Optional)

Most platforms allow you to add a custom domain:
- **Render**: Settings > Custom Domain
- **Railway**: Settings > Domains
- **Heroku**: Settings > Domains

---

## Troubleshooting

**App won't start:**
- Check if database is initialized: Run `npm run init-db` on the server
- Verify environment variables are set correctly

**Can't login:**
- Database might not be initialized
- Check server logs for errors

**Products not showing:**
- Run database initialization script
- Check API endpoints are accessible

---

## Support

If you encounter issues:
1. Check server logs in your hosting platform
2. Verify all environment variables are set
3. Ensure database is initialized
4. Check that all dependencies installed correctly

## Cost

All recommended platforms offer FREE tiers:
- **Render**: Free tier available (sleeps after 15 min inactivity)
- **Railway**: $5 free credit monthly
- **Heroku**: Free tier discontinued, starts at $7/month

For 24/7 uptime, consider Render's paid tier ($7/month) or Railway's usage-based pricing.
