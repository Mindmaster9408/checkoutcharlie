# Barcode Management System

## Overview

Checkout Charlie includes a comprehensive barcode system that supports:
- **Scanning existing barcodes** from suppliers
- **Generating company barcodes** for your own products
- **Tracking barcode sequences** to avoid duplicates
- **Sean AI barcode learning** for instant product recognition

---

## Barcode Types Supported

### 1. **EAN-13** (Default)
- **Format**: 13 digits
- **Structure**: `[3-digit prefix][9-digit sequence][1 check digit]`
- **Example**: `6001234567890`
- **Use**: International standard for retail products

### 2. **EAN-8**
- **Format**: 8 digits
- **Structure**: `[2-digit prefix][5-digit sequence][1 check digit]`
- **Example**: `60123456`
- **Use**: Smaller packages

### 3. **UPC-A**
- **Format**: 12 digits
- **Use**: North American products

### 4. **Custom**
- **Format**: Any length
- **Use**: Internal products, services

---

## Company Barcode Generation

### Default Settings
- **Prefix**: `600` (South Africa)
- **Starting Sequence**: `1000`
- **Format**: EAN-13
- **Auto-Generate**: Enabled

### How It Works

1. **First Product**: `6001234001000` + check digit = `6001234001006`
2. **Second Product**: `6001234001001` + check digit = `6001234001013`
3. **Third Product**: `6001234001002` + check digit = `6001234001020`

The system **automatically**:
- Generates sequential barcodes
- Calculates check digits
- Prevents duplicates
- Tracks history

---

## API Endpoints

### Get Barcode Settings
```http
GET /api/barcode/settings
```

**Response:**
```json
{
  "company_prefix": "600",
  "current_sequence": 1000,
  "barcode_type": "EAN13",
  "auto_generate": true,
  "last_generated": "6001234001006"
}
```

### Update Barcode Settings
```http
PUT /api/barcode/settings
{
  "company_prefix": "600",
  "current_sequence": 1000,
  "barcode_type": "EAN13",
  "auto_generate": true
}
```

### Generate New Barcode
```http
POST /api/barcode/generate
```

**Response:**
```json
{
  "success": true,
  "barcode": "6001234001006",
  "barcode_type": "EAN13",
  "next_sequence": 1001
}
```

### Check if Barcode Exists
```http
GET /api/barcode/check/6001234567890
```

**Response (if exists):**
```json
{
  "exists": true,
  "in_system": true,
  "product": {
    "id": 1,
    "code": "PROD-001",
    "name": "White Sugar 5kg"
  }
}
```

**Response (if Sean knows it):**
```json
{
  "exists": false,
  "in_system": false,
  "sean_knows": true,
  "suggestion": {
    "product_name": "White Sugar 5kg",
    "category": "Groceries",
    "confidence": 0.85
  }
}
```

### Assign Barcode to Product
```http
POST /api/barcode/assign
{
  "barcode": "6001234567890",
  "productId": 1
}
```

### Lookup Product by Barcode
```http
GET /api/barcode/lookup/6001234567890
```

**Response:**
```json
{
  "found": true,
  "product": {
    "id": 1,
    "product_code": "PROD-001",
    "product_name": "White Sugar 5kg",
    "barcode": "6001234567890",
    "unit_price": 45.99,
    "stock_quantity": 50
  }
}
```

### Get Barcode History
```http
GET /api/barcode/history?productId=1&limit=50
```

### Validate Barcode Format
```http
POST /api/barcode/validate
{
  "barcode": "6001234567890"
}
```

**Response:**
```json
{
  "valid": true,
  "format": "EAN13",
  "check_digit_valid": true
}
```

---

## Usage Scenarios

### Scenario 1: Supplier Product (Existing Barcode)

**Cape Town store receives sugar from supplier:**

1. **Scan barcode**: `6001234567890`
2. **System checks**:
   - Not in our system yet
   - Check if Sean knows it
3. **Sean says**: "This looks like White Sugar 5kg, Groceries, 15% VAT"
4. **Cashier adds**:
   - Product name: White Sugar 5kg
   - Cost: R32.00
   - Price: R45.99
5. **Barcode assigned** to product
6. **Sean learns** for future

**Next time ANY store scans `6001234567890`:**
- Sean instantly recognizes it
- Auto-fills all product data
- Just need to add pricing

---

### Scenario 2: Company Product (Generate Barcode)

**Your bakery makes fresh bread:**

1. **Click "Add Product"**
2. **Click "Generate Barcode"**
3. **System generates**: `6001234001006`
4. **Add details**:
   - Name: Fresh White Bread
   - Category: Bakery
   - Price: R15.50
5. **Print barcode label**
6. **Done!**

**Result:**
- Unique barcode for your product
- Can be scanned at any till
- Tracked across all stores

---

### Scenario 3: Multiple Locations

**Johannesburg store** scans barcode `6001234567890`:
- Sean doesn't know it yet
- Add as "White Sugar 5kg"

**Cape Town store** scans same barcode later:
- Sean recognizes it immediately!
- Auto-fills: "White Sugar 5kg, Groceries, 15% VAT"

**Durban store** scans it:
- Sean already expert
- Instant recognition
- Even suggests similar products

---

## Barcode Prefix Guide

### By Country:
- **South Africa**: 600-601
- **USA/Canada**: 0-13, 60-139
- **UK**: 50
- **Germany**: 400-440
- **France**: 300-379
- **China**: 690-695

### Your Company:
Choose a prefix that represents your company, for example:
- **600** = South African company
- **6001234** = Your specific company code
- **Next 5 digits** = Sequential product number
- **Last digit** = Calculated check digit

---

## Check Digit Calculation

**EAN-13 Example: 600123456789?**

1. Add odd positions (1st, 3rd, 5th...): `6 + 0 + 2 + 4 + 6 + 8 = 26`
2. Add even positions × 3: `(0 + 1 + 3 + 5 + 7 + 9) × 3 = 75`
3. Sum: `26 + 75 = 101`
4. Check digit: `(10 - (101 % 10)) = 9`
5. **Final barcode: 6001234567899**

The system does this automatically!

---

## Barcode Labels

### Recommended Label Printers:
- Zebra ZD420
- Brother QL-820NWB
- DYMO LabelWriter 4XL

### Label Format:
```
┌─────────────────┐
│  White Sugar    │
│                 │
│ ╱╱│╱│╱│╱│╱│╱│╱  │
│ 6001234567890   │
│                 │
│  R 45.99        │
└─────────────────┘
```

---

## Database Tables

### `barcode_settings`
- Company prefix
- Current sequence
- Barcode type (EAN13, EAN8, etc.)
- Auto-generate setting

### `barcode_history`
- All barcodes ever used
- Product assignments
- Who assigned when
- Company-generated flag

### `products.barcode`
- Current barcode for each product
- Indexed for fast lookup

---

## Integration with Sean AI

Sean learns barcodes in multiple ways:

1. **First Scan**:
   - Barcode: `6001234567890`
   - Description: "White Sugar 5kg"
   - Sean: "Okay, I'll remember this"

2. **Pattern Recognition**:
   - Sees similar barcodes `600123456xxxx`
   - Learns they're all from same supplier
   - Starts recognizing patterns

3. **Cross-Store Learning**:
   - Cape Town scans it
   - Johannesburg scans it
   - Durban scans it
   - Sean: "This is definitely White Sugar, seen it 50 times across 3 stores"

4. **Confidence Building**:
   - 1st scan: 50% confidence
   - 10th scan: 75% confidence
   - 50th scan: 95% confidence
   - 100th scan: Expert level

---

## Best Practices

### DO:
- ✓ Use consistent company prefix
- ✓ Let system auto-generate for new products
- ✓ Scan supplier barcodes when receiving stock
- ✓ Verify barcode before printing labels
- ✓ Keep barcode labels clean and readable

### DON'T:
- ✗ Manually create barcodes (use generator)
- ✗ Reuse barcodes for different products
- ✗ Change prefix mid-stream
- ✗ Skip check digit validation

---

## Troubleshooting

**Barcode won't scan:**
- Check if scanner is working
- Verify barcode is clear/not damaged
- Try manual entry
- Check barcode format

**Duplicate barcode error:**
- Barcode already assigned to another product
- Check barcode history: `/api/barcode/history`
- Generate new barcode if needed

**Sean doesn't recognize barcode:**
- First time seeing it (normal)
- Add product details
- Sean will learn for next time

**Wrong check digit:**
- Use `/api/barcode/validate` endpoint
- System will recalculate correct check digit

---

## Future Enhancements

Coming soon:
- QR code support
- Batch barcode generation
- Barcode label printing integration
- Mobile app barcode scanning
- Image recognition for damaged barcodes
- Barcode to product image matching

---

## API Testing

### Test Generate Barcode:
```bash
curl -X POST http://localhost:3000/api/barcode/generate \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Test Lookup:
```bash
curl http://localhost:3000/api/barcode/lookup/6001234567890 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Test Check:
```bash
curl http://localhost:3000/api/barcode/check/6001234567890 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Configuration

Edit barcode settings via API or UI:

1. **Company Prefix**: Your unique identifier (2-5 digits)
2. **Starting Sequence**: Where to begin numbering (e.g., 1000)
3. **Barcode Type**: EAN13, EAN8, or Custom
4. **Auto-Generate**: Let system create barcodes automatically

**Recommended for most businesses:**
- Prefix: 600 (if in South Africa)
- Sequence: 1000
- Type: EAN13
- Auto-generate: Enabled

---

Your barcode system is ready to use! 🏷️
