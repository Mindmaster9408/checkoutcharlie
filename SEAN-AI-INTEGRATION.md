# Sean AI Integration Guide

## Overview

Sean is your AI learning assistant integrated into Checkout Charlie. Sean learns from every interaction to help optimize your POS system and provide intelligent insights.

---

## What Sean Learns

### 1. **Every Button Click**
Sean tracks every button press to understand:
- Most used features
- Cashier workflow patterns
- Common actions
- User preferences

### 2. **Every Product Scan**
Sean learns:
- Product barcodes and associations
- What sells when (time of day, day of week)
- Popular products
- Category patterns

### 3. **Every Transaction**
Sean analyzes:
- Payment method preferences
- Average transaction values
- Transaction duration
- Peak sales times

### 4. **Cashier Behavior**
Sean monitors:
- Transaction speed
- Accuracy rate
- Most used shortcuts
- Efficiency patterns

### 5. **Product Data**
Sean builds knowledge of:
- Barcodes → Product names
- Product categories
- Unit of measure
- VAT requirements
- Supplier patterns by location

---

## Sean AI Features

### 🤖 **Auto-Fill Product Details**

When adding a new product:

1. Click **"Ask Sean"** button
2. Sean barcode or type product name
3. Sean automatically fills:
   - Product name
   - Category (based on keywords)
   - Unit of measure (kg, L, ea, etc.)
   - VAT rate (15% or 0%)
   - Whether VAT applies

**Example:**
```
Input: "White Sugar 5kg"
Sean suggests:
- Category: Groceries
- Unit: kg
- Weight: 5
- VAT: 15% (Yes)
```

### 📊 **Sales Insights**

Get intelligent reports:
- Peak selling hours
- Top products by revenue
- Cashier performance metrics
- Sales pattern predictions

### 🎯 **Smart Suggestions**

Sean suggests:
- Similar products when scanning barcodes
- Optimal pricing based on patterns
- Stock reorder times
- Category assignments

---

## API Endpoints

### Learn from Interaction
```http
POST /api/sean/learn/interaction
{
  "interactionType": "button_click",
  "component": "add_to_cart",
  "productId": 1,
  "metadata": {
    "quantity": 1,
    "screen": "till"
  }
}
```

### Learn Product from Barcode
```http
POST /api/sean/learn/product
{
  "barcode": "6001234567890",
  "description": "White Sugar 5kg",
  "location": "Cape Town"
}
```

**Response:**
```json
{
  "success": true,
  "productSuggestion": {
    "product_name": "White Sugar 5kg",
    "category": "Groceries",
    "unit_of_measure": "kg",
    "vat_rate": 15,
    "requires_vat": true
  }
}
```

### Ask Sean to Assist
```http
POST /api/sean/assist/product
{
  "barcode": "6001234567890",
  "description": "White Sugar 5kg"
}
```

### Get Sales Insights
```http
GET /api/sean/insights/sales-patterns?startDate=2026-01-01
```

**Response:**
```json
{
  "insights": {
    "peak_hours": ["10:00-12:00", "16:00-18:00"],
    "top_products": [
      {
        "product_name": "Coca Cola",
        "total_sold": 145,
        "revenue": 1883.55
      }
    ]
  }
}
```

### Get Cashier Behavior
```http
GET /api/sean/insights/cashier-behavior?userId=1
```

---

## Audit Trail

Every interaction is logged for compliance and learning:

```http
GET /api/audit/trail?userId=1&startDate=2026-01-01
```

**Logged Events:**
- Button clicks
- Product scans
- Sales transactions
- Price changes
- Till operations
- Settings changes

---

## VAT Management

### Check VAT Settings
```http
GET /api/vat/settings
```

### Update VAT Registration
```http
PUT /api/vat/settings
{
  "is_vat_registered": true,
  "vat_number": "4123456789",
  "vat_rate": 15.0
}
```

### Get Products with VAT Info
```http
GET /api/vat/products
```

**Response:**
```json
{
  "is_vat_registered": true,
  "products": [
    {
      "id": 1,
      "product_name": "White Sugar 5kg",
      "price_excluding_vat": 39.99,
      "vat_amount": 6.00,
      "price_including_vat": 45.99,
      "vat_rate": 15
    }
  ]
}
```

---

## Sean's Learning Process

### Stage 1: Initial Learning (Confidence: 0.5)
- First time seeing a barcode
- Learns basic product info
- Makes educated guesses on category/VAT

### Stage 2: Pattern Recognition (Confidence: 0.7)
- Seen product 5+ times
- Understands sales patterns
- Can predict category accurately

### Stage 3: Expert Knowledge (Confidence: 0.9+)
- Seen product 20+ times
- Knows exact specifications
- Can auto-fill all details
- Suggests similar products

---

## Integration with External Systems

Sean's API allows connection to:
- Inventory management systems
- Accounting software
- Analytics platforms
- Supply chain management
- Customer loyalty programs

**Webhook Support:**
- Real-time event notifications
- Stock level alerts
- Sales completed
- Audit trail exports

---

## Database Tables

### `audit_trail`
Complete log of every action

### `sean_product_knowledge`
Product learning database

### `sean_sales_patterns`
Sales trend analysis

### `sean_cashier_behavior`
Cashier performance tracking

### `sean_button_interactions`
UI usage patterns

### `vat_settings`
VAT configuration

---

## Usage Example

### Adding a Product with Sean

1. **Scan barcode**: `6001234567890`
2. **Type description**: "White Sugar 5kg"
3. **Click "Ask Sean"**
4. **Sean fills**:
   - Name: White Sugar 5kg
   - Category: Groceries
   - Unit: kg
   - VAT: 15%
5. **You only add**: Cost & Price
6. **Save!**

### Learning Over Time

**First Cape Town store scans sugar:**
- Sean: "This looks like sugar, probably Groceries, has VAT"

**After 100+ scans across stores:**
- Sean: "This is White Sugar 5kg, Groceries category, 15% VAT, typically costs R32-35, sells for R40-50"

---

## Privacy & Security

- All learning is anonymized
- No personal data stored
- Audit trail for compliance
- Encrypted API communication
- Role-based access control

---

## Future Enhancements

Sean will learn to:
- Predict stock reorder points
- Suggest dynamic pricing
- Detect fraudulent patterns
- Optimize staff scheduling
- Forecast sales trends
- Auto-categorize suppliers

---

## Getting Started

1. **Initialize Sean**: Already done ✓
2. **Start using**: Sean learns automatically
3. **View insights**: Check `/api/sean/insights/*`
4. **Optimize**: Use Sean's suggestions

**Sean gets smarter every day!** 🚀
