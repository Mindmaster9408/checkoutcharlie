/**
 * ============================================================================
 * Authentication & Authorization Middleware
 * ============================================================================
 * Handles JWT authentication, company context, and permission checks.
 * ============================================================================
 */

const jwt = require('jsonwebtoken');
const { hasPermission } = require('../config/permissions');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

/**
 * Authenticate JWT token
 * Extracts user info from token and attaches to request
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    req.user = decoded;
    req.companyId = decoded.companyId;
    next();
  });
}

/**
 * Require company selection
 * Ensures user has selected a company before accessing company-scoped resources
 */
function requireCompany(req, res, next) {
  if (!req.user.companyId) {
    return res.status(400).json({
      error: 'Company not selected',
      requiresCompanySelection: true
    });
  }
  next();
}

/**
 * Permission checker middleware
 * Usage: requirePermission('PRODUCTS.CREATE')
 */
function requirePermission(permission) {
  return (req, res, next) => {
    const userRole = req.user.role;
    const [category, action] = permission.split('.');

    if (!hasPermission(userRole, category, action)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required: permission,
        userRole: userRole
      });
    }

    next();
  };
}

/**
 * Role checker middleware
 * Usage: requireRole(['business_owner', 'accountant'])
 */
function requireRole(allowedRoles) {
  return (req, res, next) => {
    const userRole = req.user.role;

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        error: 'Access denied',
        message: `This action requires one of the following roles: ${allowedRoles.join(', ')}`,
        userRole: userRole
      });
    }

    next();
  };
}

/**
 * Self or higher permission middleware
 * Allows users to access their own resources, or higher roles to access any
 * Usage: selfOrRole(['admin', 'business_owner'], 'userId')
 */
function selfOrRole(allowedRoles, paramName = 'userId') {
  return (req, res, next) => {
    const userRole = req.user.role;
    const requestedUserId = parseInt(req.params[paramName] || req.body[paramName]);
    const currentUserId = req.user.userId;

    // Allow if accessing own resource
    if (requestedUserId === currentUserId) {
      return next();
    }

    // Allow if user has elevated role
    if (allowedRoles.includes(userRole)) {
      return next();
    }

    return res.status(403).json({
      error: 'Access denied',
      message: 'You can only access your own resources'
    });
  };
}

module.exports = {
  authenticateToken,
  requireCompany,
  requirePermission,
  requireRole,
  selfOrRole
};
