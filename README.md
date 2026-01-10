# Point of Sale (POS) System

A comprehensive Point of Sale system built with Node.js, Express, SQLite, and vanilla JavaScript. Designed for retail operations with advanced reporting, customer management, and integration capabilities.

## 🎯 Core Features

### 1. **User Authentication & Security**
- JWT-based authentication with 8-hour session tokens
- bcryptjs password hashing
- Role-based access control
- Secure API endpoints with Bearer token authorization

### 2. **Till Management**
- Open/close till sessions with opening balance
- Real-time session tracking
- Multi-till support
- Session duration monitoring
- Automatic session validation

### 3. **Cash Up & Reconciliation**
- Detailed cash counting by denomination (R200 - 10c)
- Real-time variance calculation
- Over/Short tracking (color-coded: green/red)
- Session notes and documentation
- Expected vs. Counted cash comparison
- Automatic till closure with variance logging

### 4. **Product Management**
- Full CRUD operations (Create, Read, Update, Delete)
- Product catalog with:
  - Barcode/SKU support
  - Category and brand organization
  - Unit of measure (ea, kg, L, etc.)
  - Cost and unit price tracking
  - Gross profit calculation (amount & percentage)
  - VAT/Tax rate configuration (15% SA standard)
  - Stock quantity management
  - Active/Inactive status
- Grid and table view modes
- Real-time product search
- Category filtering
- CSV export functionality

### 5. **Sales Processing**
- Barcode scanning interface
- Shopping cart with quantity adjustments
- Multiple payment methods:
  - **💵 Cash** - with change calculation
  - **💳 Card** - card payments
  - **👤 Account** - customer account billing
- Stock validation and automatic deduction
- VAT calculation per line item
- Real-time subtotal and total calculation
- Sales receipt generation

### 6. **Customer Management**
- Complete customer database with:
  - Company and contact person details
  - Contact information (phone, email)
  - Full physical address (street, suburb, city, province, postal code)
  - Tax reference number
  - Customer type classification (Regular, Wholesale, VIP, etc.)
  - Active/Inactive status
- Customer search and filtering
- Customer CRUD operations
- Export customer list to CSV
- Active customer filtering

### 7. **Comprehensive Reporting**

#### **Sales Reports:**
- **Gross Profit Report** - Transaction-level profit analysis with margins
- **Gross Profit by Person** - Staff performance tracking
- **Gross Profit by Product** - Product profitability analysis
- **Daily Sales Summary** - Daily sales aggregates
- **Sales by Payment Method** - Payment type breakdown
- **Sales by Category** - Category performance
- **Hourly Sales Analysis** - Peak hour identification

#### **VAT Reports:**
- **VAT Detail Report** - Line item VAT breakdown
- **VAT Summary Report** - Daily VAT totals

#### **Report Features:**
- Date range filtering (from/to dates)
- Dashboard cards with key metrics
- Sortable tables
- CSV export for all reports
- Real-time data refresh

### 8. **System Integrations**

#### **Inventory Management Sync**
- **Endpoint:** `GET /api/reports/integration/inventory-sync`
- **Purpose:** Export sold items for inventory system updates
- **Data Provided:**
  - Product details (SKU, name, category, brand)
  - Quantity sold per product
  - Cost price and unit price
  - Total cost and revenue
  - Stock levels
- **Use Case:** Sync with external inventory management systems

#### **Accounting System Sync**
- **Endpoint:** `GET /api/reports/integration/accounting-sync`
- **Purpose:** Export complete invoices for accounting software
- **Data Provided:**
  - Invoice details (sale ID, date/time, payment method, status)
  - Customer information
  - Line items with VAT breakdown
  - Subtotals, VAT totals, and grand totals
  - Profit calculations
- **Use Case:** Import into QuickBooks, Xero, Sage, or custom accounting systems

#### **Sean AI Integration**
- **Endpoint:** `GET /api/sean/*`
- **Purpose:** AI-powered product knowledge and customer assistance
- **Features:**
  - Product information queries
  - Smart product recommendations
  - Natural language product search
  - Customer support assistance
- **Database Tables:**
  - `sean_product_knowledge` - AI training data for products
  - `sean_conversations` - Conversation history

#### **Barcode System**
- **Endpoint:** `GET /api/barcode/*`
- **Purpose:** Barcode generation and management
- **Features:**
  - Generate barcodes for products
  - Barcode format configuration
  - Barcode validation
  - Print-ready barcode generation
- **Database:** `barcode_settings` table

### 9. **Audit & Compliance**
- **Endpoint:** `GET /api/audit/*`
- **Database Table:** `audit_trail`
- **Tracked Events:**
  - User actions
  - Sales transactions
  - Product changes
  - Till session activities
  - Security events
- **Audit Data:**
  - Timestamp
  - User ID
  - Action type
  - Entity affected
  - Old and new values

### 10. **VAT/Tax Management**
- **Endpoint:** `GET /api/vat/*`
- 15% South African standard VAT rate
- Per-product VAT configuration
- Automatic VAT calculation on sales
- VAT-inclusive and exclusive pricing
- VAT reporting and summaries

## 💻 Tech Stack

**Backend:**
- **Node.js 14+** - JavaScript runtime
- **Express 4.18** - Web application framework
- **SQLite3 5.1** - Embedded database
- **JWT (jsonwebtoken 9.0)** - Authentication tokens
- **bcryptjs 2.4** - Password hashing
- **dotenv 16.0** - Environment configuration
- **cors** - Cross-origin resource sharing

**Frontend:**
- **Vanilla JavaScript** - No frameworks, pure JS
- **HTML5 & CSS3** - Modern web standards
- **Responsive Design** - Mobile-friendly interface
- **Purple Gradient Theme** - #667eea → #764ba2

**Database Schema (15+ Tables):**
- `users` - System users (cashiers, managers)
- `tills` - Physical till registers
- `till_sessions` - Till opening/closing with variance tracking
- `products` - Product catalog with pricing and stock
- `sales` - Sales transactions
- `sale_items` - Line items per sale
- `customers` - Customer database
- `audit_trail` - System audit log
- `sean_product_knowledge` - AI training data
- `sean_conversations` - AI conversation history
- `barcode_settings` - Barcode configuration
- And more...

## 📦 Installation

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn
- Git

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
   Edit `.env` and update:
   ```
   JWT_SECRET=your-super-secret-jwt-key-change-this
   PORT=3000
   NODE_ENV=development
   ```

4. **Initialize the database**
   ```bash
   npm run init-db
   ```
   This creates:
   - SQLite database (`pos_database.db`)
   - All tables with proper schema
   - Demo user account
   - Sample products and data

5. **Initialize Sean AI (optional)**
   ```bash
   npm run init-sean-ai
   ```

6. **Initialize Barcodes (optional)**
   ```bash
   npm run init-barcodes
   ```

7. **Start the server**
   ```bash
   npm start
   ```
   Or for development with auto-reload:
   ```bash
   npm run dev
   ```

8. **Access the application**
   Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

## 🔐 Demo Credentials

- **Username:** demo
- **Password:** demo123

## 🚀 Usage Guide

### Basic Workflow

1. **Login** with demo credentials
2. **Open Till Session:**
   - Click "Manage Till" 
   - Select till and enter opening balance (e.g., R500.00)
   - Click "Open Session"
3. **Process Sales:**
   - Scan barcode or click products to add to cart
   - Adjust quantities with +/- buttons
   - Select payment method (💵 Cash / 💳 Card / 👤 Account)
   - Click "Complete Sale"
4. **Manage Products:**
   - Go to Settings → Products
   - Add/Edit/Delete products
   - Set pricing, stock, VAT rates
   - Export product list
5. **Manage Customers:**
   - Go to Settings → Customers
   - Add customer details
   - Track customer accounts
   - Export customer list
6. **View Reports:**
   - Click "Reports" tab
   - Select report type from sidebar
   - Set date range filters
   - Export to CSV
7. **Cash Up (End of Day):**
   - Click "Cash Up" tab
   - Count cash by denomination
   - System calculates variance
   - Add notes if needed
   - Click "Complete Cash Up & Close Till"

## 📡 API Documentation

## 📡 API Documentation

### Authentication
- `POST /api/auth/login` - User login (returns JWT token)
  ```json
  Body: { "username": "demo", "password": "demo123" }
  Response: { "token": "jwt-token-here", "user": {...} }
  ```

### Till Management
- `GET /api/pos/tills` - Get all active tills
- `GET /api/pos/sessions` - Get till sessions
- `GET /api/pos/sessions/current` - Get current active session
- `POST /api/pos/sessions/open` - Open new till session
  ```json
  Body: { "till_id": 1, "opening_balance": 500.00 }
  ```
- `POST /api/pos/sessions/:id/close` - Close till session with cash up
  ```json
  Body: { 
    "closing_balance": 1250.00, 
    "expected_balance": 1200.00,
    "variance": 50.00,
    "notes": "Extra R50 found in drawer"
  }
  ```

### Products & Sales
- `GET /api/pos/products` - Get all active products
- `POST /api/pos/products` - Create new product
- `PUT /api/pos/products/:id` - Update product
- `DELETE /api/pos/products/:id` - Delete (deactivate) product
- `POST /api/pos/sales` - Create new sale
  ```json
  Body: {
    "items": [
      { "product_id": 1, "quantity": 2, "unit_price": 25.00 }
    ],
    "payment_method": "CASH",
    "amount_tendered": 100.00
  }
  ```
- `GET /api/pos/sessions/:id/sales` - Get sales for specific session
- `GET /api/pos/sales` - Get all sales (with filters)

### Customer Management
- `GET /api/customers` - Get all customers
- `GET /api/customers/search?q=query` - Search customers
- `GET /api/customers/:id` - Get customer by ID
- `POST /api/customers` - Create new customer
  ```json
  Body: {
    "name": "Company Name",
    "contact_person": "John Doe",
    "contact_number": "0123456789",
    "email": "john@company.com",
    "street_address": "123 Main St",
    "suburb": "Suburb",
    "city": "City",
    "province": "Province",
    "postal_code": "1234",
    "tax_reference": "TAX123456",
    "company": "Company Name",
    "customer_type": "Wholesale"
  }
  ```
- `PUT /api/customers/:id` - Update customer
- `DELETE /api/customers/:id` - Delete (deactivate) customer

### Reports - Sales
- `GET /api/reports/sales/gross-profit?from=YYYY-MM-DD&to=YYYY-MM-DD`
  - Transaction-level profit analysis with margins
- `GET /api/reports/sales/gross-profit-by-person?from=YYYY-MM-DD&to=YYYY-MM-DD`
  - Staff performance tracking
- `GET /api/reports/sales/gross-profit-by-product?from=YYYY-MM-DD&to=YYYY-MM-DD`
  - Product profitability analysis
- `GET /api/reports/sales/daily-summary?from=YYYY-MM-DD&to=YYYY-MM-DD`
  - Daily sales aggregates
- `GET /api/reports/sales/by-payment-method?from=YYYY-MM-DD&to=YYYY-MM-DD`
  - Payment type breakdown
- `GET /api/reports/sales/by-category?from=YYYY-MM-DD&to=YYYY-MM-DD`
  - Category performance
- `GET /api/reports/sales/hourly?from=YYYY-MM-DD&to=YYYY-MM-DD`
  - Peak hour identification

### Reports - VAT
- `GET /api/reports/vat/detail?from=YYYY-MM-DD&to=YYYY-MM-DD`
  - Line item VAT breakdown
- `GET /api/reports/vat/summary?from=YYYY-MM-DD&to=YYYY-MM-DD`
  - Daily VAT totals

### Integration Endpoints
- `GET /api/reports/integration/inventory-sync?from=YYYY-MM-DD&to=YYYY-MM-DD`
  - Export sold items for inventory system updates
  - Returns: Product sales with quantities, costs, revenue
- `GET /api/reports/integration/accounting-sync?from=YYYY-MM-DD&to=YYYY-MM-DD`
  - Export complete invoices for accounting software
  - Returns: Full invoice data with line items, VAT, totals

### Sean AI
- `GET /api/sean/*` - AI-powered product knowledge and assistance
  - Product queries
  - Recommendations
  - Customer support

### Barcode Management
- `GET /api/barcode/*` - Barcode generation and configuration

### Audit Trail
- `GET /api/audit/*` - System audit logs and activity tracking

### VAT Management
- `GET /api/vat/*` - VAT calculations and reports

**Note:** All endpoints (except login) require Bearer token authentication:
```
Authorization: Bearer <your-jwt-token>
```

## Database Schema

- **users** - System users (cashiers, managers)
- **tills** - Physical till registers
- **till_sessions** - Till opening/closing sessions with variance tracking
- **products** - Product catalog with SKU, pricing, stock, VAT
- **sales** - Sales transactions with payment methods
- **sale_items** - Individual line items in each sale
- **customers** - Customer database with full details
- **audit_trail** - System activity and security audit log
- **sean_product_knowledge** - AI training data for products
- **sean_conversations** - AI conversation history
- **barcode_settings** - Barcode system configuration

## 🔌 Integration Guide

### Inventory Management System Integration

Use the inventory sync endpoint to update your external inventory system:

```javascript
// Example: Fetch sold items for inventory update
const response = await fetch(
  'http://localhost:3000/api/reports/integration/inventory-sync?from=2026-01-01&to=2026-01-07',
  { headers: { 'Authorization': 'Bearer YOUR_TOKEN' } }
);
const data = await response.json();

// Process each product
data.products.forEach(product => {
  // Update your inventory system
  inventorySystem.updateStock(
    product.product_code,
    -product.quantity_sold  // Reduce stock
  );
});
```

**Data Provided:**
- Product SKU and details
- Quantity sold
- Cost and revenue
- Current stock levels

### Accounting System Integration

Export sales data to QuickBooks, Xero, Sage, or custom accounting systems:

```javascript
// Example: Fetch invoices for accounting
const response = await fetch(
  'http://localhost:3000/api/reports/integration/accounting-sync?from=2026-01-01&to=2026-01-07',
  { headers: { 'Authorization': 'Bearer YOUR_TOKEN' } }
);
const data = await response.json();

// Process each invoice
data.invoices.forEach(invoice => {
  accountingSystem.createInvoice({
    invoiceNumber: invoice.sale_id,
    date: invoice.sale_date,
    customer: invoice.customer_name,
    lineItems: invoice.line_items.map(item => ({
      description: item.product_name,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      vatAmount: item.vat_amount,
      total: item.total_amount
    })),
    subtotal: invoice.subtotal,
    vatTotal: invoice.vat_total,
    grandTotal: invoice.total_amount,
    paymentMethod: invoice.payment_method
  });
});
```

**Data Provided:**
- Complete invoice details
- Line items with VAT breakdown
- Payment information
- Profit calculations

### Sean AI Integration

The Sean AI system provides intelligent product assistance:

```javascript
// Query product information
const response = await fetch(
  'http://localhost:3000/api/sean/query',
  {
    method: 'POST',
    headers: { 
      'Authorization': 'Bearer YOUR_TOKEN',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: "What products do you have for gardening?"
    })
  }
);
```

**Use Cases:**
- Natural language product search
- Product recommendations
- Customer assistance
- Product knowledge queries

## 📁 Project Structure

```
Point of Sale/
├── POS_App/                    # Frontend application
│   └── checkout-charlie.html   # Main POS interface (single-page app)
├── routes/                     # API route handlers
│   ├── auth.js                # Authentication endpoints
│   ├── pos.js                 # POS operations (till, products, sales)
│   ├── customers.js           # Customer management
│   ├── reports.js             # Sales & VAT reports + integrations
│   ├── sean-ai.js             # AI assistance
│   ├── barcode.js             # Barcode system
│   ├── audit.js               # Audit trail
│   └── vat.js                 # VAT management
├── middleware/                 # Express middleware
│   └── auth.js                # JWT authentication middleware
├── server.js                   # Main Express server
├── database.js                 # SQLite database connection
├── init-database.js            # Database schema & initialization
├── init-sean-ai.js             # Sean AI setup
├── init-barcodes.js            # Barcode system setup
├── package.json                # Dependencies & scripts
├── .env                        # Environment variables (not in git)
├── .env.example                # Environment template
├── Procfile                    # Heroku deployment config
├── README.md                   # This file
├── API-DOCUMENTATION.md        # Detailed API docs
├── BARCODE-SYSTEM.md          # Barcode system guide
├── SEAN-AI-INTEGRATION.md     # AI integration guide
├── DEPLOYMENT.md              # Deployment instructions
└── QUICKSTART.md              # Quick start guide
```

## 🚢 Deployment

### Deploying to Heroku

1. **Install Heroku CLI**
   ```bash
   npm install -g heroku
   ```

2. **Login to Heroku:**
   ```bash
   heroku login
   ```

3. **Create a new Heroku app:**
   ```bash
   heroku create your-pos-app-name
   ```

4. **Set environment variables:**
   ```bash
   heroku config:set JWT_SECRET=your-production-secret-key-here
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

7. **Open your app:**
   ```bash
   heroku open
   ```

### Deploying to Render

1. Create account at [render.com](https://render.com)
2. Click "New +" → "Web Service"
3. Connect your GitHub repository
4. Configure:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment Variables:**
     - `JWT_SECRET` = your-secret-key
     - `NODE_ENV` = production
5. Click "Create Web Service"
6. Once deployed, run init-db via SSH or dashboard

### Deploying to Railway

1. Create account at [railway.app](https://railway.app)
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your repository
4. Add environment variables in Settings:
   - `JWT_SECRET`
   - `NODE_ENV`
5. Railway auto-detects Node.js and deploys
6. Run database init via Railway CLI

**⚠️ Production Notes:**
- For production, consider migrating to **PostgreSQL** instead of SQLite
- Set strong `JWT_SECRET` (use: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
- Enable HTTPS/SSL
- Set up regular database backups
- Configure CORS properly for your domain
- Use environment-specific configs

## 🔧 Development

### Available Scripts

```bash
npm start          # Start production server
npm run dev        # Start with nodemon (auto-reload)
npm run init-db    # Initialize/reset database
npm run init-sean-ai    # Initialize Sean AI
npm run init-barcodes   # Initialize barcode system
```

### Environment Variables

Create a `.env` file in the root directory:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# Security
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# Database (SQLite - auto-created)
DATABASE_PATH=./pos_database.db

# Optional: External API Keys
SEAN_AI_API_KEY=your-api-key-if-needed
```

### Adding New Features

1. **New API Endpoint:**
   - Add route handler in `routes/` folder
   - Register route in `server.js`
   - Add authentication middleware if needed

2. **New Database Table:**
   - Update `init-database.js` with new table schema
   - Run `npm run init-db` (⚠️ drops existing data)

3. **New Frontend Section:**
   - Update `checkout-charlie.html`
   - Add tab/section in navigation
   - Create corresponding JavaScript functions

## 🛡️ Security Features

- **JWT Authentication** - Secure token-based auth
- **Password Hashing** - bcryptjs with salt rounds
- **SQL Injection Protection** - Parameterized queries
- **CORS Configuration** - Controlled cross-origin access
- **Audit Trail** - Complete activity logging
- **Session Validation** - Token expiry and refresh
- **Input Validation** - Server-side validation

## 📊 Reporting Features Summary

| Report Type | Description | Key Metrics |
|------------|-------------|-------------|
| Gross Profit | Transaction-level analysis | Revenue, Cost, Profit, Margin% |
| GP by Person | Staff performance | Sales per user, Profit per user |
| GP by Product | Product profitability | Best/worst sellers, Margins |
| Daily Summary | Daily aggregates | Total sales, Avg transaction |
| Payment Method | Payment breakdown | Cash/Card/Account totals |
| By Category | Category performance | Revenue per category |
| Hourly Sales | Peak hour analysis | Hourly transaction patterns |
| VAT Detail | Line item VAT | VAT per item, Totals |
| VAT Summary | Daily VAT totals | Daily VAT collected |

## 🔗 Integration Summary

| System | Endpoint | Purpose | Data Format |
|--------|----------|---------|-------------|
| **Inventory** | `/api/reports/integration/inventory-sync` | Stock updates | JSON (products, quantities, costs) |
| **Accounting** | `/api/reports/integration/accounting-sync` | Invoice export | JSON (invoices, line items, VAT) |
| **Sean AI** | `/api/sean/*` | Product assistance | JSON (queries, responses) |
| **Barcode** | `/api/barcode/*` | Barcode generation | JSON/Image |

## 📞 Support & Documentation

- **API Documentation:** See `API-DOCUMENTATION.md`
- **Barcode System:** See `BARCODE-SYSTEM.md`
- **Sean AI:** See `SEAN-AI-INTEGRATION.md`
- **Deployment:** See `DEPLOYMENT.md`
- **Quick Start:** See `QUICKSTART.md`

## 🎓 Learning Resources

- [Express.js Documentation](https://expressjs.com/)
- [SQLite Documentation](https://www.sqlite.org/docs.html)
- [JWT Introduction](https://jwt.io/introduction)
- [REST API Best Practices](https://restfulapi.net/)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 🐛 Troubleshooting

### Common Issues

**Issue:** Database not found
```bash
# Solution: Initialize database
npm run init-db
```

**Issue:** JWT token errors
```bash
# Solution: Check .env file has JWT_SECRET set
# Generate new secret:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Issue:** Port already in use
```bash
# Solution: Kill existing process
# Windows:
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
# Linux/Mac:
killall node
```

**Issue:** Products not loading
- Check if database is initialized
- Verify JWT token in localStorage
- Check browser console for errors

## 🗺️ Roadmap

### Planned Features
- [ ] Stock take/inventory count functionality
- [ ] Supplier management
- [ ] Purchase orders
- [ ] Multi-site/branch support
- [ ] Advanced user roles and permissions
- [ ] Email receipts
- [ ] SMS notifications
- [ ] Mobile app (React Native)
- [ ] Cloud backup
- [ ] Advanced analytics dashboard
- [ ] Loyalty program
- [ ] Gift cards/vouchers
- [ ] Layaway/quotations

## 📜 License

MIT License - See LICENSE file for details

## 👨‍💻 Author

**Ruan**

## 🙏 Acknowledgments

- Express.js team for the excellent framework
- SQLite for the lightweight database
- JWT for secure authentication
- All open-source contributors

## 📧 Contact & Support

For issues, questions, or feature requests:
- Open an issue on GitHub
- Email: [your-email@example.com]

---

**Built with ❤️ for retail excellence**

*Last Updated: January 2026*
