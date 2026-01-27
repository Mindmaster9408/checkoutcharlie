/**
 * ============================================================================
 * Role-Based Access Control (RBAC) Configuration - Enterprise Edition
 * ============================================================================
 *
 * Role Hierarchy (by level):
 *
 * CORPORATE LEVEL (100-85):
 * - corporate_admin (100): Full system access, all locations
 * - corporate_finance (90): Financial reports, all locations
 * - corporate_ops (85): Operations oversight, all locations
 *
 * REGIONAL LEVEL (70-65):
 * - regional_manager (70): Manages multiple districts
 * - regional_analyst (65): Regional reporting
 *
 * DISTRICT LEVEL (50-45):
 * - district_manager (50): Manages multiple stores
 * - district_trainer (45): Training and compliance
 *
 * STORE LEVEL (30-5):
 * - store_manager (30): Full store access
 * - assistant_manager (25): Most store operations
 * - shift_supervisor (20): Shift-level oversight
 * - senior_cashier (15): Advanced POS operations
 * - cashier (10): Basic POS operations
 * - trainee (5): Limited supervised access
 *
 * LEGACY ROLES (backward compatibility):
 * - accountant: Multi-company access via firm
 * - business_owner: Company owner, full access
 * - admin: Store-level admin (maps to store_manager)
 * ============================================================================
 */

// Enterprise role levels
const ROLE_LEVELS = {
  // Corporate
  'corporate_admin': 100,
  'corporate_finance': 90,
  'corporate_ops': 85,

  // Regional
  'regional_manager': 70,
  'regional_analyst': 65,

  // District
  'district_manager': 50,
  'district_trainer': 45,

  // Store
  'store_manager': 30,
  'assistant_manager': 25,
  'shift_supervisor': 20,
  'senior_cashier': 15,
  'cashier': 10,
  'trainee': 5,

  // Legacy (backward compatibility)
  'accountant': 95,
  'business_owner': 100,
  'admin': 30,
};

// Role scope (what level of location hierarchy they can see)
const ROLE_SCOPES = {
  'corporate_admin': 'company',
  'corporate_finance': 'company',
  'corporate_ops': 'company',
  'regional_manager': 'region',
  'regional_analyst': 'region',
  'district_manager': 'district',
  'district_trainer': 'district',
  'store_manager': 'store',
  'assistant_manager': 'store',
  'shift_supervisor': 'store',
  'senior_cashier': 'store',
  'cashier': 'store',
  'trainee': 'store',
  'accountant': 'company',
  'business_owner': 'company',
  'admin': 'store',
};

// Define role groups for easier permission assignment
const CORPORATE_ROLES = ['corporate_admin', 'corporate_finance', 'corporate_ops', 'accountant', 'business_owner'];
const MANAGEMENT_ROLES = ['corporate_admin', 'corporate_finance', 'corporate_ops', 'regional_manager', 'district_manager', 'store_manager', 'accountant', 'business_owner', 'admin'];
const SUPERVISOR_ROLES = [...MANAGEMENT_ROLES, 'regional_analyst', 'district_trainer', 'assistant_manager', 'shift_supervisor'];
const ALL_ROLES = [...SUPERVISOR_ROLES, 'senior_cashier', 'cashier', 'trainee'];

const PERMISSIONS = {
  // ========== POS OPERATIONS ==========
  POS: {
    VIEW_PRODUCTS: ALL_ROLES,
    MAKE_SALE: ALL_ROLES.filter(r => r !== 'trainee'),
    VOID_SALE: SUPERVISOR_ROLES,
    APPLY_DISCOUNT: SUPERVISOR_ROLES,
    PRICE_OVERRIDE: MANAGEMENT_ROLES,
    SPLIT_PAYMENT: ALL_ROLES.filter(r => !['trainee'].includes(r)),
    PROCESS_RETURN: SUPERVISOR_ROLES,
    REPRINT_RECEIPT: ALL_ROLES,
  },

  // ========== PRODUCTS ==========
  PRODUCTS: {
    VIEW: ALL_ROLES,
    CREATE: MANAGEMENT_ROLES,
    EDIT: MANAGEMENT_ROLES,
    DELETE: CORPORATE_ROLES,
    MANAGE_DAILY_DISCOUNTS: MANAGEMENT_ROLES,
    BULK_UPDATE: CORPORATE_ROLES,
  },

  // ========== CUSTOMERS ==========
  CUSTOMERS: {
    VIEW: SUPERVISOR_ROLES,
    VIEW_NAME_ONLY: ['senior_cashier', 'cashier', 'trainee'],
    CREATE: MANAGEMENT_ROLES,
    EDIT: MANAGEMENT_ROLES,
    DELETE: CORPORATE_ROLES,
    VIEW_LOYALTY: SUPERVISOR_ROLES,
    MANAGE_LOYALTY: MANAGEMENT_ROLES,
  },

  // ========== TILL MANAGEMENT ==========
  TILL: {
    OPEN_SESSION: ALL_ROLES.filter(r => r !== 'trainee'),
    CLOSE_SESSION: ALL_ROLES.filter(r => r !== 'trainee'),
    VIEW_ALL_SESSIONS: MANAGEMENT_ROLES,
    VIEW_OWN_SESSIONS: ['senior_cashier', 'cashier'],
    DAILY_RESET: MANAGEMENT_ROLES,
  },

  // ========== CASH UP ==========
  CASHUP: {
    OWN: ALL_ROLES.filter(r => r !== 'trainee'),
    OTHERS: MANAGEMENT_ROLES,
    APPROVE: CORPORATE_ROLES,
    VIEW_ALL_REPORTS: MANAGEMENT_ROLES,
    VIEW_OWN_REPORTS: ['senior_cashier', 'cashier'],
  },

  // ========== STOCK ==========
  STOCK: {
    VIEW: ALL_ROLES,
    ADJUST: SUPERVISOR_ROLES,
    STOCK_TAKE: MANAGEMENT_ROLES,
    VIEW_HISTORY: MANAGEMENT_ROLES,
    BULK_UPDATE: MANAGEMENT_ROLES,
  },

  // ========== INVENTORY (Enterprise) ==========
  INVENTORY: {
    VIEW: SUPERVISOR_ROLES,
    MANAGE: MANAGEMENT_ROLES,
    TRANSFER_REQUEST: SUPERVISOR_ROLES,
    TRANSFER_APPROVE: MANAGEMENT_ROLES,
    TRANSFER_RECEIVE: SUPERVISOR_ROLES,
    VIEW_ALL_LOCATIONS: CORPORATE_ROLES,
  },

  // ========== SUPPLIERS & PURCHASING ==========
  SUPPLIERS: {
    VIEW: MANAGEMENT_ROLES,
    CREATE: CORPORATE_ROLES,
    EDIT: MANAGEMENT_ROLES,
    DELETE: CORPORATE_ROLES,
  },

  PURCHASE_ORDERS: {
    VIEW: MANAGEMENT_ROLES,
    CREATE: MANAGEMENT_ROLES,
    APPROVE: ['corporate_admin', 'corporate_finance', 'regional_manager', 'district_manager', 'accountant', 'business_owner'],
    RECEIVE: SUPERVISOR_ROLES,
  },

  // ========== REPORTS ==========
  REPORTS: {
    SALES: CORPORATE_ROLES,
    PROFIT: CORPORATE_ROLES,
    VAT: CORPORATE_ROLES,
    CASHUP: MANAGEMENT_ROLES,
    AUDIT: CORPORATE_ROLES,
    INVENTORY: MANAGEMENT_ROLES,
    EMPLOYEE_PERFORMANCE: MANAGEMENT_ROLES,
    LOCATION_COMPARISON: CORPORATE_ROLES,
  },

  // ========== ANALYTICS (Enterprise) ==========
  ANALYTICS: {
    VIEW_DASHBOARD: MANAGEMENT_ROLES,
    VIEW_KPIs: MANAGEMENT_ROLES,
    SET_TARGETS: CORPORATE_ROLES,
    VIEW_TRENDS: MANAGEMENT_ROLES,
    EXPORT_DATA: CORPORATE_ROLES,
    SCHEDULED_REPORTS: CORPORATE_ROLES,
  },

  // ========== LOSS PREVENTION ==========
  LOSS_PREVENTION: {
    VIEW_ALERTS: MANAGEMENT_ROLES,
    MANAGE_RULES: CORPORATE_ROLES,
    INVESTIGATE: MANAGEMENT_ROLES,
    RESOLVE: MANAGEMENT_ROLES,
    VIEW_VARIANCES: MANAGEMENT_ROLES,
  },

  // ========== EMPLOYEES ==========
  EMPLOYEES: {
    VIEW: MANAGEMENT_ROLES,
    VIEW_OWN_PROFILE: ALL_ROLES,
    CREATE: CORPORATE_ROLES,
    EDIT: MANAGEMENT_ROLES,
    TERMINATE: CORPORATE_ROLES,
    VIEW_SCHEDULE: ALL_ROLES,
    MANAGE_SCHEDULE: MANAGEMENT_ROLES,
    CLOCK_IN_OUT: ALL_ROLES.filter(r => r !== 'trainee'),
    APPROVE_TIME: MANAGEMENT_ROLES,
  },

  // ========== LOCATIONS ==========
  LOCATIONS: {
    VIEW: MANAGEMENT_ROLES,
    VIEW_OWN: ALL_ROLES,
    CREATE: CORPORATE_ROLES,
    EDIT: MANAGEMENT_ROLES,
    DELETE: CORPORATE_ROLES,
    MANAGE_SETTINGS: MANAGEMENT_ROLES,
    ASSIGN_USERS: MANAGEMENT_ROLES,
  },

  // ========== LOYALTY & PROMOTIONS ==========
  LOYALTY: {
    VIEW: SUPERVISOR_ROLES,
    ENROLL_CUSTOMER: SUPERVISOR_ROLES,
    REDEEM_POINTS: SUPERVISOR_ROLES,
    ADJUST_POINTS: MANAGEMENT_ROLES,
    MANAGE_PROGRAM: CORPORATE_ROLES,
    MANAGE_TIERS: CORPORATE_ROLES,
  },

  PROMOTIONS: {
    VIEW: ALL_ROLES,
    APPLY: ALL_ROLES.filter(r => r !== 'trainee'),
    CREATE: MANAGEMENT_ROLES,
    APPROVE: CORPORATE_ROLES,
    EDIT: MANAGEMENT_ROLES,
    DELETE: CORPORATE_ROLES,
  },

  // ========== INTEGRATIONS ==========
  INTEGRATIONS: {
    VIEW: CORPORATE_ROLES,
    MANAGE: ['corporate_admin', 'business_owner'],
    TRIGGER_SYNC: CORPORATE_ROLES,
    VIEW_LOGS: CORPORATE_ROLES,
    MANAGE_WEBHOOKS: ['corporate_admin', 'business_owner'],
  },

  // ========== SETTINGS ==========
  SETTINGS: {
    COMPANY: ['corporate_admin', 'business_owner'],
    USERS: MANAGEMENT_ROLES,
    VAT: ['corporate_admin', 'corporate_finance', 'accountant', 'business_owner'],
    INVITE_ACCOUNTANT: ['business_owner'],
    INVITE_USER: MANAGEMENT_ROLES,
    PRINTERS: MANAGEMENT_ROLES,
    LOCATIONS: CORPORATE_ROLES,
    INTEGRATIONS: ['corporate_admin', 'business_owner'],
  }
};

// Roles that can access multiple companies
const MULTI_COMPANY_ROLES = ['accountant', 'business_owner', 'corporate_admin'];

/**
 * Check if a role has a specific permission
 */
function hasPermission(role, category, action) {
  if (!PERMISSIONS[category] || !PERMISSIONS[category][action]) {
    return false;
  }
  return PERMISSIONS[category][action].includes(role);
}

/**
 * Get all permissions for a role
 */
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

/**
 * Check if role can access multiple companies
 */
function canAccessMultipleCompanies(userType) {
  return MULTI_COMPANY_ROLES.includes(userType);
}

/**
 * Get the level of a role (higher = more permissions)
 */
function getRoleLevel(role) {
  return ROLE_LEVELS[role] || 0;
}

/**
 * Get the scope of a role
 */
function getRoleScope(role) {
  return ROLE_SCOPES[role] || 'store';
}

/**
 * Check if role A can manage role B (based on level)
 */
function canManageRole(managerRole, targetRole) {
  return getRoleLevel(managerRole) > getRoleLevel(targetRole);
}

/**
 * Get all roles at or below a certain level
 */
function getRolesAtOrBelow(level) {
  return Object.entries(ROLE_LEVELS)
    .filter(([role, lvl]) => lvl <= level)
    .map(([role]) => role);
}

/**
 * Get all available enterprise roles
 */
function getAllRoles() {
  return Object.keys(ROLE_LEVELS);
}

/**
 * Check if role is corporate level
 */
function isCorporateRole(role) {
  return CORPORATE_ROLES.includes(role);
}

/**
 * Check if role is management level
 */
function isManagementRole(role) {
  return MANAGEMENT_ROLES.includes(role);
}

module.exports = {
  PERMISSIONS,
  ROLE_LEVELS,
  ROLE_SCOPES,
  MULTI_COMPANY_ROLES,
  CORPORATE_ROLES,
  MANAGEMENT_ROLES,
  SUPERVISOR_ROLES,
  ALL_ROLES,
  hasPermission,
  getRolePermissions,
  canAccessMultipleCompanies,
  getRoleLevel,
  getRoleScope,
  canManageRole,
  getRolesAtOrBelow,
  getAllRoles,
  isCorporateRole,
  isManagementRole
};
