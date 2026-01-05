# Point of Sale (POS) System

A full-featured Point of Sale system built with Node.js, Express, SQLite, and vanilla JavaScript.

## Features

- User authentication with JWT
- Till session management (open/close with variance tracking)
- Product catalog with search
- Shopping cart with quantity management
- Sales processing with multiple payment methods (Cash, Card, EFT)
- Stock management and validation
- VAT calculation (15%)
- Real-time balance tracking

## Tech Stack

**Backend:**
- Node.js & Express
- SQLite database
- JWT authentication
- bcryptjs for password hashing

**Frontend:**
- Vanilla JavaScript
- HTML5 & CSS3
- Responsive design

## Installation

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn

### Setup Steps

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd "Point of Sale"
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and update the JWT_SECRET to a secure random string.

4. **Initialize the database**
   ```bash
   npm run init-db
   ```
   This creates the database with demo data.

5. **Start the server**
   ```bash
   npm start
   ```
   Or for development with auto-reload:
   ```bash
   npm run dev
   ```

6. **Access the application**
   Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

## Demo Credentials

- **Username:** demo
- **Password:** demo123

## Usage

1. **Login** with the demo credentials
2. **Open a till session** by clicking "Manage Till" and entering an opening balance
3. **Browse products** and click to add them to cart
4. **Adjust quantities** using the +/- buttons
5. **Select payment method** (Cash/Card/EFT)
6. **Complete sale** to process the transaction
7. **Close till session** at end of day to reconcile cash

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login

### Till Management
- `GET /api/pos/tills` - Get all active tills
- `GET /api/pos/sessions` - Get till sessions
- `POST /api/pos/sessions/open` - Open till session
- `POST /api/pos/sessions/:id/close` - Close till session

### Products & Sales
- `GET /api/pos/products` - Get all products
- `POST /api/pos/sales` - Create new sale
- `GET /api/pos/sessions/:id/sales` - Get sales for session

## Database Schema

- **users** - System users (cashiers, managers)
- **tills** - Physical till registers
- **till_sessions** - Till opening/closing sessions
- **products** - Product catalog
- **sales** - Sales transactions
- **sale_items** - Individual items in each sale

## Project Structure

```
Point of Sale/
├── POS_App/              # Frontend files
│   ├── pos-test.html     # Main POS interface
│   └── ...
├── routes/               # API routes
│   ├── auth.js          # Authentication routes
│   └── pos.js           # POS operations routes
├── middleware/           # Express middleware
│   └── auth.js          # JWT authentication
├── server.js            # Main server file
├── database.js          # Database connection
├── init-database.js     # Database initialization
├── package.json         # Dependencies
└── .env                 # Environment variables
```

## Deployment

### Deploying to Heroku

1. Install Heroku CLI
2. Login to Heroku:
   ```bash
   heroku login
   ```

3. Create a new Heroku app:
   ```bash
   heroku create your-pos-app-name
   ```

4. Set environment variables:
   ```bash
   heroku config:set JWT_SECRET=your-production-secret-key
   heroku config:set NODE_ENV=production
   ```

5. Deploy:
   ```bash
   git push heroku main
   ```

6. Initialize database:
   ```bash
   heroku run npm run init-db
   ```

### Deploying to Render/Railway/Vercel

1. Connect your GitHub repository
2. Set build command: `npm install`
3. Set start command: `npm start`
4. Set environment variables in the dashboard
5. Deploy

**Note:** For production deployments, consider using PostgreSQL instead of SQLite.

## GitHub Setup

1. **Initialize Git repository:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit: POS System"
   ```

2. **Create GitHub repository:**
   - Go to GitHub.com
   - Click "New repository"
   - Name it "pos-system" or similar
   - Don't initialize with README (we already have one)

3. **Push to GitHub:**
   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/pos-system.git
   git branch -M main
   git push -u origin main
   ```

## License

MIT

## Author

Ruan

## Support

For issues or questions, please open an issue on GitHub.
