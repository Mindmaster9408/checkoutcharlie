# Checkout Charlie API Documentation

## Base URL
```
http://localhost:3000/api
```

## Authentication
All API endpoints (except login) require JWT Bearer token authentication.

```
Authorization: Bearer <your-token>
```

---

## Authentication Endpoints

### POST /auth/login
Login to the system

**Request:**
```json
{
  "username": "demo",
  "password": "demo123"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "username": "demo",
    "fullName": "Demo User",
    "role": "cashier"
  }
}
```

---

## Product Endpoints

### GET /pos/products
Get all active products

**Response:**
```json
{
  "products": [
    {
      "id": 1,
      "product_code": "PROD-001",
      "product_name": "Coca Cola 330ml",
      "description": "Refreshing soft drink",
      "category": "Beverages",
      "unit_price": 12.99,
      "cost_price": 8.50,
      "stock_quantity": 100,
      "vat_rate": 15,
      "is_vat_registered": true,
      "is_active": 1
    }
  ]
}
```

### POST /pos/products
Create new product

**Request:**
```json
{
  "product_code": "PROD-123",
  "product_name": "White Sugar 5kg",
  "description": "White refined sugar",
  "category": "Groceries",
  "unit_price": 45.99,
  "cost_price": 32.00,
  "stock_quantity": 50,
  "vat_rate": 15,
  "is_vat_registered": true,
  "unit_of_measure": "kg"
}
```

### PUT /pos/products/:id
Update existing product

### DELETE /pos/products/:id
Deactivate product

### GET /pos/products/barcode/:barcode
Search product by barcode

---

## Till Session Endpoints

### GET /pos/sessions
Get till sessions (with optional status filter)

**Query Parameters:**
- `status`: "open" or "closed"

### POST /pos/sessions/open
Open new till session

**Request:**
```json
{
  "tillId": 1,
  "openingBalance": 1000.00
}
```

### POST /pos/sessions/:id/close
Close till session

**Request:**
```json
{
  "closingBalance": 2500.00,
  "notes": "End of day"
}
```

---

## Sales Endpoints

### POST /pos/sales
Create new sale

**Request:**
```json
{
  "tillSessionId": 1,
  "items": [
    {
      "productId": 1,
      "quantity": 2
    }
  ],
  "paymentMethod": "CASH"
}
```

### GET /pos/sales
Get all sales (with filters)

**Query Parameters:**
- `tillSessionId`: Filter by session
- `startDate`: Filter by date range
- `endDate`: Filter by date range

---

## Sean AI Integration Endpoints

### POST /api/sean/learn/interaction
Record user interaction for Sean to learn

**Request:**
```json
{
  "interactionType": "button_click",
  "component": "add_to_cart",
  "productId": 1,
  "userId": 1,
  "tillSessionId": 1,
  "timestamp": "2026-01-05T10:30:00Z",
  "metadata": {
    "quantity": 1,
    "price": 12.99
  }
}
```

### POST /api/sean/learn/product
Sean learns about a new product from barcode scan

**Request:**
```json
{
  "barcode": "6001234567890",
  "description": "White Sugar 5kg",
  "scannedBy": 1,
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
    "requires_vat": true,
    "similar_products": [
      {
        "name": "White Sugar 2kg",
        "barcode": "6001234567891"
      }
    ]
  }
}
```

### POST /api/sean/assist/product
Ask Sean to help fill product details

**Request:**
```json
{
  "barcode": "6001234567890",
  "description": "White Sugar 5kg"
}
```

**Response:**
```json
{
  "success": true,
  "productData": {
    "product_name": "White Sugar 5kg",
    "searchable_name": "sugar white 5kg",
    "category": "Groceries",
    "unit_of_measure": "kg",
    "weight": 5,
    "vat_rate": 15,
    "requires_vat": true,
    "suggested_category": "Groceries",
    "similar_products": []
  }
}
```

### GET /api/sean/insights/sales-patterns
Get sales pattern insights from Sean

**Query Parameters:**
- `tillSessionId`: Optional
- `startDate`: Optional
- `endDate`: Optional

**Response:**
```json
{
  "insights": {
    "peak_hours": ["10:00-12:00", "16:00-18:00"],
    "top_products": [
      {
        "product_name": "Coca Cola 330ml",
        "total_sold": 145,
        "revenue": 1883.55
      }
    ],
    "cashier_performance": [
      {
        "cashier_name": "Demo User",
        "transactions": 56,
        "avg_transaction_time": "2.5 minutes"
      }
    ]
  }
}
```

### GET /api/sean/insights/cashier-behavior
Get cashier behavior analysis

**Response:**
```json
{
  "cashier_id": 1,
  "cashier_name": "Demo User",
  "behavior_patterns": {
    "avg_transaction_time": "2.5 minutes",
    "most_used_features": [
      "barcode_scan",
      "quantity_adjust",
      "payment_cash"
    ],
    "error_rate": 0.02,
    "efficiency_score": 95
  }
}
```

---

## Audit Trail Endpoints

### GET /api/audit/trail
Get complete audit trail

**Query Parameters:**
- `userId`: Filter by user
- `tillSessionId`: Filter by session
- `eventType`: Filter by event type
- `startDate`: Date range start
- `endDate`: Date range end

**Response:**
```json
{
  "audit_entries": [
    {
      "id": 1,
      "user_id": 1,
      "user_name": "Demo User",
      "event_type": "product_scan",
      "event_data": {
        "product_id": 1,
        "product_name": "Coca Cola 330ml",
        "quantity": 1
      },
      "till_session_id": 1,
      "ip_address": "127.0.0.1",
      "timestamp": "2026-01-05T10:30:00Z"
    }
  ]
}
```

### POST /api/audit/log
Log audit event

**Request:**
```json
{
  "eventType": "button_click",
  "eventData": {
    "button": "add_to_cart",
    "product_id": 1
  },
  "tillSessionId": 1
}
```

---

## External Integration Endpoints

### POST /api/integration/webhook
Receive webhooks from external systems

**Request:**
```json
{
  "source": "inventory_system",
  "event": "stock_update",
  "data": {
    "product_code": "PROD-001",
    "new_stock": 150
  }
}
```

### GET /api/integration/export/sales
Export sales data for external systems

**Query Parameters:**
- `format`: "json" or "csv"
- `startDate`: Date range
- `endDate`: Date range

---

## VAT Management Endpoints

### GET /api/vat/settings
Get VAT registration settings

**Response:**
```json
{
  "is_vat_registered": true,
  "vat_rate": 15,
  "vat_number": "4123456789"
}
```

### PUT /api/vat/settings
Update VAT settings

### GET /api/vat/products
Get products with VAT information

**Response:**
```json
{
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

## Webhooks

Your system can send webhooks to external systems for:
- New sales completed
- Stock levels changed
- Till sessions opened/closed
- Products added/updated

Configure webhook URLs in Settings > Integrations

---

## Rate Limiting

- 100 requests per minute per API key
- 1000 requests per hour per API key

---

## Error Codes

- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `429` - Too Many Requests
- `500` - Internal Server Error

**Error Response Format:**
```json
{
  "error": "Error message here",
  "code": "ERROR_CODE",
  "details": {}
}
```

---

## Sean AI Learning Model

Sean continuously learns from:
1. **Every button click** - What cashiers do most
2. **Every product scan** - What sells when
3. **Every transaction** - Payment patterns
4. **Every search query** - What users look for
5. **Every barcode scan** - Product associations
6. **Till session patterns** - Peak times, rush hours
7. **Cashier behavior** - Speed, accuracy, preferences

This data helps Sean:
- Auto-suggest products
- Pre-fill product data
- Identify VAT requirements
- Suggest categories
- Predict stock needs
- Optimize cashier workflows
