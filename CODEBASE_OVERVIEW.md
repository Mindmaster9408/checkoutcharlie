# POS System - Comprehensive Codebase Overview

## 📋 Table of Contents
1. [Project Overview](#project-overview)
2. [Architecture & Tech Stack](#architecture--tech-stack)
3. [Database Structure](#database-structure)
4. [API Routes & Endpoints](#api-routes--endpoints)
5. [Key Features](#key-features)
6. [Authentication & Security](#authentication--security)
7. [File Structure](#file-structure)
8. [Configuration & Setup](#configuration--setup)

---

## 🎯 Project Overview

**Enterprise Point of Sale (POS) System** - A comprehensive, multi-tenant retail management platform built with Node.js, Express, and PostgreSQL. Designed for retail operations with advanced reporting, inventory management, employee scheduling, and loss prevention capabilities.

### Current Version: 1.0.0
- **Repository**: Point of Sale Project
- **License**: MIT
- **Primary Use**: Retail/Multi-Location Store Management

---

## 🏗️ Architecture & Tech Stack

### Backend Stack
- **Runtime**: Node.js
- **Framework**: Express.js 4.18.2
- **Database**: PostgreSQL (primary) with pg driver 8.11.3
- **Authentication**: JWT (jsonwebtoken 9.0.2)
- **Password Hashing**: bcryptjs 2.4.3
- **Environment**: dotenv 16.3.1
- **CORS**: Enabled for cross-origin requests

### Frontend Stack
- **Framework**: Vanilla JavaScript (HTML5 + CSS3)
- **Location**: `/POS_App` folder
- **Features**: Service Worker support, PWA manifest

### Development Tools
- **Dev Server**: nodemon 3.0.1
- **Package Manager**: npm

---

## 🗄️ Database Structure

### Multi-Tenant Architecture
The system is designed to support multiple companies/organizations:
- **companies**: Base tenant entities
- **locations**: Multi-level hierarchy (HQ → Region → District → Store → Warehouse)
- **users**: User management with role-based access
- **user_company_access**: Links users to companies with specific roles
- **firm_company_access**: Links accounting firms to managed companies

### Core Tables

#### 1. **User Management**
- `users`: User accounts with authentication
- `user_company_access`: Multi-company user assignments
- `user_location_access`: Location-based user access
- `user_sessions`: Device tracking and session management
- `mfa_backup_codes`: Multi-factor authentication support
- `password_history`: Password change tracking

#### 2. **POS Operations**
- `tills`: Physical till terminals per location
- `till_sessions`: Till open/close sessions with cash tracking
- `sales`: Individual transactions
- `sale_items`: Line items in transactions
- `sale_returns`: Return transaction tracking
- `sale_return_items`: Return item details

#### 3. **Product Management**
- `products`: Product catalog with pricing & VAT
- `product_companies`: Product sharing across companies
- `product_daily_discounts`: Daily discount rules
- `barcode_settings`: Company-specific barcode configuration
- `barcode_history`: Barcode assignment audit trail

#### 4. **Inventory Management**
- `inventory`: Stock levels by product/location/warehouse
- `warehouses`: Warehouse definitions
- `stock_adjustments`: Stock movement tracking
- `stock_transfers`: Inter-location stock transfers
- `stock_transfer_items`: Transfer line items
- `reorder_rules`: Automatic reorder thresholds

#### 5. **Supplier & Purchasing**
- `suppliers`: Supplier master data
- `product_suppliers`: Product-to-supplier mappings
- `purchase_orders`: PO creation and tracking
- `purchase_order_items`: PO line items
- `goods_receipts`: Goods received note (GRN) tracking
- `goods_receipt_items`: GRN line item details

#### 6. **Customer Management**
- `customers`: Customer database with contact info
- `loyalty_programs`: Loyalty program definitions
- `loyalty_tiers`: Tier structure for programs
- `customer_loyalty`: Customer program enrollment
- `loyalty_transactions`: Points tracking

#### 7. **Promotions & Pricing**
- `promotions`: Promotion/coupon definitions
- `promotion_usage`: Promotion application tracking
- `promotion_approvals`: Approval workflow for promotions
- `price_overrides`: Price change authorization audit trail

#### 8. **Accounting & VAT**
- `vat_settings`: Company VAT registration and rates
- `company_settings`: Till float, receipt format, printer config
- `accounting_firms`: Accounting firm definitions
- `integration_configs`: Third-party integrations

#### 9. **Employee & Scheduling**
- `shift_schedules`: Employee shift assignments
- `time_entries`: Clock in/out tracking
- `sso_configurations`: Single sign-on provider setup

#### 10. **Analytics & Loss Prevention**
- `daily_sales_summary`: Pre-aggregated daily metrics
- `hourly_sales_summary`: Hourly transaction summary
- `product_performance`: Product sales analytics
- `kpi_targets`: KPI goal setting
- `cash_variances`: Till variance tracking
- `employee_variance_summary`: Employee performance metrics
- `loss_prevention_rules`: Anomaly detection rules
- `loss_prevention_alerts`: Alert tracking and investigation

#### 11. **AI & Learning**
- `sean_product_knowledge`: AI product knowledge base

#### 12. **Audit & Security**
- `audit_trail`: System action logging
- `scheduled_reports`: Automated report scheduling

---

## 🔌 API Routes & Endpoints

### Authentication Routes (`/api/auth`)
**File**: `routes/auth.js` (1561 lines)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/login` | User login - returns token & accessible companies |
| POST | `/select-company` | Select company context for session |
| POST | `/logout` | Logout and invalidate session |
| POST | `/register` | User registration (business owners) |
| POST | `/change-password` | Password change |
| GET | `/verify-token` | Token validation |

**Features**:
- JWT-based authentication (8-hour tokens)
- Multi-company support
- Super admin portal access
- Role-based company access
- Accounting firm access routing

---

### POS Routes (`/api/pos`)
**File**: `routes/pos.js` (1732 lines)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/tills` | Get active tills for company |
| GET | `/sessions` | Get till sessions (role-filtered) |
| POST | `/sessions/open` | Open new till session |
| POST | `/sessions/close` | Close till with cash reconciliation |
| GET | `/sales` | Get sales transactions |
| POST | `/sales` | Create new sale/transaction |
| GET | `/sales/:id` | Get transaction details |
| POST | `/sales/:id/return` | Process return |
| POST | `/sales/:id/void` | Void transaction (manager only) |
| GET | `/products` | Get product list with stock |
| POST | `/products` | Create product |
| PUT | `/products/:id` | Update product |
| GET | `/customers` | Get customer list |
| POST | `/customers` | Create customer |

**Key Features**:
- Barcode scanning
- Real-time stock validation
- Multiple payment methods (Cash, Card, Account)
- VAT calculation
- Till session management with cash counting
- Shopping cart management
- Return processing

---

### Inventory Routes (`/api/inventory`)
**File**: `routes/inventory.js` (368 lines)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/` | Get multi-location inventory |
| GET | `/location/:id` | Inventory for specific location |
| GET | `/product/:id` | Product across all locations |
| POST | `/adjust` | Stock adjustment |
| GET | `/low-stock` | Products below reorder point |

**Key Features**:
- Multi-location inventory tracking
- Stock reservations and on-order tracking
- Reorder point warnings
- Warehouse management
- Stock valuation

---

### Suppliers & Purchase Orders (`/api/suppliers`, `/api/purchase-orders`)
**Files**: `routes/suppliers.js`, `routes/purchase-orders.js`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/suppliers` | List suppliers |
| POST | `/api/suppliers` | Create supplier |
| GET | `/api/purchase-orders` | List POs |
| POST | `/api/purchase-orders` | Create PO |
| POST | `/api/purchase-orders/:id/approve` | Approve PO |
| POST | `/api/purchase-orders/:id/goods-receipt` | Receive goods |

**Key Features**:
- Supplier master data
- Multi-supplier product mapping
- Purchase order lifecycle
- Goods receipt matching
- Payment terms tracking

---

### Reports Routes (`/api/reports`)
**File**: `routes/reports.js`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/sales-summary` | Daily sales aggregates |
| GET | `/gross-profit` | Profit analysis |
| GET | `/gross-profit-person` | Staff performance |
| GET | `/gross-profit-product` | Product profitability |
| GET | `/vat-detail` | VAT line item report |
| GET | `/vat-summary` | Daily VAT totals |
| GET | `/sales-by-payment` | Payment method breakdown |
| GET | `/sales-by-category` | Category performance |
| GET | `/hourly-sales` | Peak hour analysis |
| GET | `/integration/inventory-sync` | Export for integration |

**Features**:
- Date range filtering
- CSV export
- Real-time calculations
- Dashboard metrics

---

### Additional Routes

| Route | File | Purpose |
|-------|------|---------|
| `/api/sean` | `routes/sean-ai.js` | AI product learning & suggestions |
| `/api/audit` | `routes/audit.js` | Audit trail management |
| `/api/vat` | `routes/vat.js` | VAT compliance reporting |
| `/api/barcode` | `routes/barcode.js` | Barcode generation & management |
| `/api/customers` | `routes/customers.js` | Customer CRUD operations |
| `/api/locations` | `routes/locations.js` | Multi-location management |
| `/api/employees` | `routes/employees.js` | Employee management |
| `/api/scheduling` | `routes/scheduling.js` | Shift scheduling |
| `/api/transfers` | `routes/transfers.js` | Stock transfer workflow |
| `/api/loyalty` | `routes/loyalty.js` | Loyalty program management |
| `/api/promotions` | `routes/promotions.js` | Promotions & coupons |
| `/api/analytics` | `routes/analytics.js` | Business intelligence |

---

## ✨ Key Features

### 1. **Till Management**
- Open/close till sessions
- Opening/closing balance tracking
- Real-time session validation
- Multi-till support per location
- Cash counting by denomination
- Variance tracking (over/short)
- Color-coded variance indicators

### 2. **Sales Processing**
- Barcode scanning interface
- Shopping cart with quantity adjustments
- Multiple payment methods:
  - Cash with change calculation
  - Card payments
  - Customer account billing
- Stock validation before sale
- Real-time VAT calculation
- Receipt generation
- Sale voiding (manager authorized)
- Return processing

### 3. **Product Catalog**
- Full CRUD operations
- Barcode/SKU support
- Category and brand organization
- Unit of measure support (ea, kg, L, etc.)
- Cost and unit price tracking
- Gross profit calculation
- VAT rate configuration
- Stock quantity management
- Active/Inactive status
- CSV export

### 4. **Customer Management**
- Complete customer database
- Company/individual support
- Full contact information
- Tax reference tracking
- Customer type classification
- Active/Inactive filtering
- Search and export capabilities

### 5. **Multi-Location Inventory**
- Hierarchical location structure (HQ → Region → District → Store)
- Warehouse management
- Stock transfers between locations
- Inventory per location/warehouse
- Reorder point automation
- Safety stock calculations
- Stock reservation tracking
- Bin location management

### 6. **Purchase Order Management**
- PO creation and tracking
- Multi-supplier support
- Expected delivery dates
- Goods receipt matching
- Payment terms management
- PO approval workflows

### 7. **Comprehensive Reporting**
- **Sales Reports**: Daily summary, by payment method, by category, hourly analysis
- **Profit Reports**: Gross profit by transaction, staff, product
- **VAT Reports**: Detail and summary
- **Inventory Reports**: Stock levels, low stock alerts
- **Employee Reports**: Performance metrics, cash variances
- **Date range filtering**
- **CSV export capabilities**

### 8. **Loss Prevention**
- Cash variance tracking
- Employee variance summary
- Anomaly detection rules
- Alert system with escalation
- Investigation workflow
- Audit trail logging

### 9. **Employee Management**
- User role hierarchy (15+ roles)
- Multi-location assignments
- Shift scheduling
- Time tracking (clock in/out)
- Manager assignments
- Employment status tracking
- Salary/hourly rate tracking

### 10. **Loyalty Program**
- Program configuration
- Tier structure with benefits
- Points tracking
- Lifetime spending calculation
- Tier qualification rules
- Points expiry management
- Redemption tracking

### 11. **Promotions & Discounts**
- Promotion/coupon management
- Time-based promotions
- Location-specific rules
- Customer tier targeting
- Usage limits and tracking
- Approval workflows
- Stackable discount support

### 12. **Security & Audit**
- JWT authentication
- bcryptjs password hashing
- Role-based access control (RBAC)
- Multi-factor authentication support
- Audit trail for all actions
- Session tracking with device info
- Password history

### 13. **AI Integration (Sean AI)**
- Product knowledge learning
- Barcode recognition
- Auto-fill product details
- Category suggestions
- Unit of measure learning
- Confidence scoring

---

## 🔐 Authentication & Security

### JWT Authentication
**File**: `middleware/auth.js`
- 8-hour token expiry for regular users
- 24-hour token expiry for super admins
- Bearer token in Authorization header
- Token refresh mechanisms

### Role-Based Access Control
**File**: `config/permissions.js`

**Role Hierarchy (15+ roles)**:
```
CORPORATE LEVEL (100-85):
  - corporate_admin (100): Full system access
  - corporate_finance (90): Financial reports
  - corporate_ops (85): Operations oversight

REGIONAL LEVEL (70-65):
  - regional_manager (70): Multiple districts
  - regional_analyst (65): Regional reporting

DISTRICT LEVEL (50-45):
  - district_manager (50): Multiple stores
  - district_trainer (45): Training

STORE LEVEL (30-5):
  - store_manager (30): Full store access
  - assistant_manager (25): Most operations
  - shift_supervisor (20): Shift oversight
  - senior_cashier (15): Advanced POS
  - cashier (10): Basic POS
  - trainee (5): Limited supervised access

LEGACY:
  - accountant: Multi-company via firm
  - business_owner: Company owner
  - admin: Store-level admin
```

### Password Security
- bcryptjs with salt rounds: 10
- Password history tracking
- Password change requirements
- MFA backup codes support

### Company Context
- All queries filtered by company_id
- Users can access multiple companies
- Primary company designation
- Company-specific settings and permissions

---

## 📁 File Structure

```
Point of Sale/
├── server.js                          # Main Express app with DB init
├── database.js                        # PostgreSQL connection pool
├── package.json                       # Dependencies
├── Procfile                          # Heroku deployment config
├── .env                              # Environment variables (not tracked)
│
├── 📚 Documentation
│   ├── README.md                     # Full feature documentation
│   ├── QUICKSTART.md                 # Quick start guide
│   ├── DEPLOYMENT.md                 # Deployment instructions
│   ├── BARCODE-SYSTEM.md            # Barcode implementation
│   ├── SEAN-AI-INTEGRATION.md        # AI learning features
│   ├── API-DOCUMENTATION.md          # Detailed API docs
│   └── CODEBASE_OVERVIEW.md          # This file
│
├── 🗂️ Config
│   └── permissions.js                # RBAC configuration
│
├── 🔐 Middleware
│   └── auth.js                       # JWT & permission middleware
│
├── 🛣️ Routes
│   ├── auth.js                       # Authentication endpoints
│   ├── pos.js                        # POS operations (sales, tills)
│   ├── sean-ai.js                    # AI learning endpoints
│   ├── audit.js                      # Audit trail
│   ├── vat.js                        # VAT compliance
│   ├── barcode.js                    # Barcode management
│   ├── customers.js                  # Customer CRUD
│   ├── inventory.js                  # Inventory management
│   ├── locations.js                  # Multi-location management
│   ├── employees.js                  # Employee management
│   ├── scheduling.js                 # Shift scheduling
│   ├── transfers.js                  # Stock transfers
│   ├── suppliers.js                  # Supplier management
│   ├── purchase-orders.js            # PO management
│   ├── promotions.js                 # Promotions
│   ├── loyalty.js                    # Loyalty programs
│   ├── reports.js                    # Reporting
│   ├── loss-prevention.js            # Loss prevention
│   ├── analytics.js                  # Analytics/BI
│   └── receipts.js                   # Receipt generation
│
├── 💻 Frontend
│   └── POS_App/
│       ├── index.html                # Main UI
│       ├── manifest.json             # PWA manifest
│       ├── service-worker.js         # Offline support
│       └── supabase-config.js        # Cloud config (if used)
│
└── 🔧 Setup Scripts
    ├── init-database.js              # SQLite init (legacy)
    ├── init-database-pg.js           # PostgreSQL init
    ├── init-sean-ai.js               # AI setup
    ├── init-barcodes.js              # Barcode setup
    └── fix-user-company-links.js     # Migration script
```

---

## ⚙️ Configuration & Setup

### Environment Variables
```env
PORT=8080                             # Server port
DATABASE_URL=postgres://...           # PostgreSQL connection string
JWT_SECRET=your-secret-key            # JWT signing key
NODE_ENV=production                   # production or development
```

### Database Initialization
```bash
# Full setup (PostgreSQL)
npm run setup-pg

# Individual commands
npm run init-db-pg                    # Create tables and seed data
npm run init-sean                     # Initialize AI tables
npm run init-barcodes                 # Initialize barcode settings
```

### Development Commands
```bash
npm install                           # Install dependencies
npm start                             # Run production server
npm run dev                           # Run with auto-reload (nodemon)
```

### Deployment
- **Zeabur**: Recommended with internal PostgreSQL
- **Render**: Free tier with PostgreSQL
- **Railway**: Free $5 credit with PostgreSQL
- **Heroku**: Paid tier with PostgreSQL

---

## 🚀 Key Architectural Patterns

### 1. **Multi-Tenant Architecture**
- All tables have `company_id` column
- User-company relationships stored in `user_company_access`
- Firm-company relationships for accounting firms
- All queries filtered by company context

### 2. **Hierarchical Location Management**
```
Company
  └─ Location (HQ)
      ├─ Location (Region)
      │   ├─ Location (District)
      │   │   └─ Location (Store)
      │   │       ├─ Warehouse
      │   │       └─ Till
      │   └─ Location (District)
      │       └─ Location (Store)
      └─ Location (Region)
          └─ Location (District)
```

### 3. **Role-Based Access Control**
- Permissions defined as `CATEGORY.ACTION` (e.g., `POS.MAKE_SALE`)
- Roles assigned permission sets
- Middleware enforces at endpoint level
- Scope controls (store-level vs company-level access)

### 4. **Audit Trail**
- All user actions logged to `audit_trail` table
- User ID, timestamp, event type, IP address
- Event data stored as JSON
- Query support for compliance reporting

### 5. **Real-Time Analytics**
- Pre-aggregated tables: `daily_sales_summary`, `hourly_sales_summary`
- Product performance tracking
- Employee variance monitoring
- KPI target management

---

## 📊 Database Statistics

- **Tables**: 60+ (including multi-tenant support tables)
- **Relations**: Complex multi-level hierarchy
- **Indexes**: On company_id, foreign keys, and frequent queries
- **Scalability**: Designed for multi-location enterprises

---

## 🔄 Data Flow Examples

### Sales Transaction Flow
```
1. User scans barcode → Product lookup
2. Add to cart → Stock check
3. Apply promotions → Discount calculation
4. Select payment method → Payment processing
5. VAT calculation → Receipt generation
6. Update inventory → Stock deduction
7. Record sale → audit_trail entry
8. Update cash summary → daily_sales_summary
9. Calculate employee metrics → employee_variance_summary
```

### Stock Transfer Flow
```
1. Create transfer request → stock_transfers (draft)
2. Approval → Update status
3. Ship from location → Update quantities
4. Goods receipt → GRN creation
5. Quantity matching → Variance tracking
6. Finalize → Update inventory at destination
```

---

## 🎯 Next Steps for Development

1. **Performance Optimization**
   - Add database indexes for frequent queries
   - Implement query caching
   - Optimize API response times

2. **Feature Enhancements**
   - Mobile app development
   - Advanced BI dashboards
   - Real-time notifications

3. **Integration**
   - Third-party accounting software
   - Payment gateway integration
   - ERP system connectors

4. **Scalability**
   - Microservices architecture
   - Message queuing (RabbitMQ/Kafka)
   - Distributed caching (Redis)

5. **Security**
   - OAuth 2.0 implementation
   - SAML for enterprise SSO
   - End-to-end encryption for sensitive data

---

**Last Updated**: February 2, 2026
**Total Lines of Code**: ~10,000+
**Documentation**: Complete
