const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const posRoutes = require('./routes/pos');
const seanAiRoutes = require('./routes/sean-ai');
const auditRoutes = require('./routes/audit');
const vatRoutes = require('./routes/vat');
const barcodeRoutes = require('./routes/barcode');
const customersRoutes = require('./routes/customers');
const reportsRoutes = require('./routes/reports');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('POS_App'));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/pos', posRoutes);
app.use('/api/sean', seanAiRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/vat', vatRoutes);
app.use('/api/barcode', barcodeRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/reports', reportsRoutes);

// Serve the main POS application
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'POS_App', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`POS System Server running on port ${PORT}`);
  console.log(`API available at /api`);
});
