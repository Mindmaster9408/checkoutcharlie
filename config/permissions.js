/**
 * Role-Based Access Control (RBAC) Configuration
 *
 * User Types:
 * - accountant: Works for accounting firm, can access multiple client companies
 * - business_owner: Owns companies, full access to their companies
 * - company_user: Works for a specific company (admin or cashier role)
 *
 * Roles (within a company):
 * - business_owner: Full access to everything
 * - accountant: Full access (when accessing as accountant)
 * - admin: Cash-up, stock take, products, customers - NO profit/sales/VAT reports
 * - cashier: Basic POS operations only
 */

const PERMISSIONS = {
  POS: {
    VIEW_PRODUCTS: ['accountant', 'business_owner', 'admin', 'cashier'],
    MAKE_SALE: ['accountant', 'business_owner', 'admin', 'cashier'],
    VOID_SALE: ['accountant', 'business_owner', 'admin'],
    APPLY_DISCOUNT: ['accountant', 'business_owner', 'admin'],
  },
  PRODUCTS: {
    VIEW: ['accountant', 'business_owner', 'admin', 'cashier'],
    CREATE: ['accountant', 'business_owner', 'admin'],
    EDIT: ['accountant', 'business_owner', 'admin'],
    DELETE: ['accountant', 'business_owner', 'admin'],
  },
  CUSTOMERS: {
    VIEW: ['accountant', 'business_owner', 'admin'],
    VIEW_NAME_ONLY: ['cashier'],  // Cashiers only see customer name during sale
    CREATE: ['accountant', 'business_owner', 'admin'],
    EDIT: ['accountant', 'business_owner', 'admin'],
    DELETE: ['accountant', 'business_owner'],
  },
  TILL: {
    OPEN_SESSION: ['accountant', 'business_owner', 'admin', 'cashier'],
    CLOSE_SESSION: ['accountant', 'business_owner', 'admin', 'cashier'],
    VIEW_ALL_SESSIONS: ['accountant', 'business_owner', 'admin'],
    VIEW_OWN_SESSIONS: ['cashier'],
  },
  CASHUP: {
    OWN: ['accountant', 'business_owner', 'admin', 'cashier'],
    OTHERS: ['accountant', 'business_owner', 'admin'],
    APPROVE: ['accountant', 'business_owner'],
    VIEW_ALL_REPORTS: ['accountant', 'business_owner', 'admin'],
    VIEW_OWN_REPORTS: ['cashier'],
  },
  STOCK: {
    VIEW: ['accountant', 'business_owner', 'admin', 'cashier'],
    ADJUST: ['accountant', 'business_owner', 'admin'],
    STOCK_TAKE: ['accountant', 'business_owner', 'admin'],
  },
  REPORTS: {
    SALES: ['accountant', 'business_owner'],
    PROFIT: ['accountant', 'business_owner'],
    VAT: ['accountant', 'business_owner'],
    CASHUP: ['accountant', 'business_owner', 'admin'],
    AUDIT: ['accountant', 'business_owner'],
  },
  SETTINGS: {
    COMPANY: ['business_owner'],
    USERS: ['business_owner'],
    VAT: ['accountant', 'business_owner'],
    INVITE_ACCOUNTANT: ['business_owner'],
    INVITE_USER: ['business_owner'],
  }
};

// Roles that can access multiple companies
const MULTI_COMPANY_ROLES = ['accountant', 'business_owner'];

// Check if a role has a specific permission
function hasPermission(role, category, action) {
  if (!PERMISSIONS[category] || !PERMISSIONS[category][action]) {
    return false;
  }
  return PERMISSIONS[category][action].includes(role);
}

// Get all permissions for a role
function getRolePermissions(role) {
  const permissions = {};
  for (const category in PERMISSIONS) {
    permissions[category] = {};
    for (const action in PERMISSIONS[category]) {
      permissions[category][action] = PERMISSIONS[category][action].includes(role);
    }
  }
  return permissions;
}

// Check if role can access multiple companies
function canAccessMultipleCompanies(userType) {
  return MULTI_COMPANY_ROLES.includes(userType);
}

module.exports = {
  PERMISSIONS,
  MULTI_COMPANY_ROLES,
  hasPermission,
  getRolePermissions,
  canAccessMultipleCompanies
};
