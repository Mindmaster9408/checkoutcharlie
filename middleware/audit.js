/**
 * ============================================================================
 * Forensic Audit Logging Middleware
 * ============================================================================
 * Comprehensive audit trail for security, compliance, and fraud detection.
 * Logs every significant action (create, update, delete, void, discount, etc.)
 * Append-only architecture - audit logs are NEVER deleted.
 * 
 * Compliance: POPI Act (SA), SARS audit requirements, Labor law
 * Retention: Minimum 7 years per SA tax law
 * ============================================================================
 */

const db = require('../database');

/**
 * Log an audit event to the forensic audit_log table
 * 
 * @param {Object} req - Express request object (for user/company context)
 * @param {string} actionType - CREATE, UPDATE, DELETE, VOID, DISCOUNT, LOGIN, LOGOUT, etc.
 * @param {string} entityType - product, sale, customer, user, company, etc.
 * @param {string|number} entityId - ID of the affected record
 * @param {Object} details - Additional details
 * @param {string} details.fieldName - Specific field changed
 * @param {*} details.oldValue - Value before change
 * @param {*} details.newValue - Value after change
 * @param {Object} details.metadata - Extra context (JSONB)
 */
async function logAudit(req, actionType, entityType, entityId, details = {}) {
  try {
    const auditEntry = {
      company_id: req.companyId || (req.user && req.user.companyId) || null,
      user_id: (req.user && req.user.userId) || null,
      user_email: (req.user && req.user.email) || (req.user && req.user.username) || 'system',
      action_type: actionType,
      entity_type: entityType,
      entity_id: entityId != null ? String(entityId) : null,
      field_name: details.fieldName || null,
      old_value: details.oldValue !== undefined ? JSON.stringify(details.oldValue) : null,
      new_value: details.newValue !== undefined ? JSON.stringify(details.newValue) : null,
      ip_address: req.ip || (req.connection && req.connection.remoteAddress) || null,
      session_id: (req.headers && req.headers['x-session-id']) || null,
      user_agent: (req.headers && req.headers['user-agent']) || null,
      additional_metadata: JSON.stringify(details.metadata || {})
    };

    db.run(
      `INSERT INTO audit_log 
       (company_id, user_id, user_email, action_type, entity_type, entity_id, 
        field_name, old_value, new_value, ip_address, session_id, user_agent, additional_metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        auditEntry.company_id,
        auditEntry.user_id,
        auditEntry.user_email,
        auditEntry.action_type,
        auditEntry.entity_type,
        auditEntry.entity_id,
        auditEntry.field_name,
        auditEntry.old_value,
        auditEntry.new_value,
        auditEntry.ip_address,
        auditEntry.session_id,
        auditEntry.user_agent,
        auditEntry.additional_metadata
      ],
      function(err) {
        if (err) {
          console.error('Audit log error:', err.message);
        }
      }
    );
  } catch (err) {
    // Never let audit logging failure break the application
    console.error('Audit log exception:', err.message);
  }
}

/**
 * Log field-level changes between old and new objects
 * Automatically detects which fields changed and logs each one
 * 
 * @param {Object} req - Express request object
 * @param {string} entityType - product, sale, customer, etc.
 * @param {string|number} entityId - ID of the entity
 * @param {Object} oldData - Original data
 * @param {Object} newData - Updated data
 * @param {Object} extraMetadata - Additional metadata to include
 */
async function logFieldChanges(req, entityType, entityId, oldData, newData, extraMetadata = {}) {
  if (!oldData || !newData) return;

  for (const field in newData) {
    if (oldData[field] !== newData[field] && field !== 'updated_at' && field !== 'created_at') {
      await logAudit(req, 'UPDATE', entityType, entityId, {
        fieldName: field,
        oldValue: oldData[field],
        newValue: newData[field],
        metadata: extraMetadata
      });
    }
  }
}

/**
 * Express middleware that automatically logs CREATE/UPDATE/DELETE actions
 * based on HTTP method and response status.
 * 
 * Attach to routes with: router.use(auditMiddleware)
 */
function auditMiddleware(req, res, next) {
  // Store the original json method
  const originalJson = res.json.bind(res);

  res.json = function(data) {
    // Only log successful operations
    try {
      if (req.method === 'POST' && res.statusCode >= 200 && res.statusCode < 300) {
        const entityType = extractEntityType(req.path);
        const entityId = (data && data.id) || (data && data[entityType] && data[entityType].id);
        logAudit(req, 'CREATE', entityType, entityId, { newValue: data });
      } else if (req.method === 'PUT' && res.statusCode >= 200 && res.statusCode < 300) {
        const entityType = extractEntityType(req.path);
        logAudit(req, 'UPDATE', entityType, req.params.id, { 
          oldValue: req.auditOldValue, 
          newValue: data 
        });
      } else if (req.method === 'DELETE' && res.statusCode >= 200 && res.statusCode < 300) {
        const entityType = extractEntityType(req.path);
        logAudit(req, 'DELETE', entityType, req.params.id, { oldValue: req.auditOldValue });
      }
    } catch (err) {
      console.error('Audit middleware error:', err.message);
    }

    return originalJson(data);
  };

  next();
}

/**
 * Extract entity type from URL path
 * e.g. /api/products/123 -> product
 *      /api/pos/sales/456 -> sale
 */
function extractEntityType(path) {
  // Remove /api/ prefix and get the main resource name
  const parts = path.replace(/^\/api\//, '').split('/').filter(Boolean);
  
  // Skip 'pos' prefix if present
  let resourceName = parts[0];
  if (resourceName === 'pos' && parts.length > 1) {
    resourceName = parts[1];
  }
  
  // Singularize (basic - remove trailing 's')
  if (resourceName && resourceName.endsWith('s') && !resourceName.endsWith('ss')) {
    resourceName = resourceName.slice(0, -1);
  }
  
  return resourceName || 'unknown';
}

module.exports = { logAudit, logFieldChanges, auditMiddleware, extractEntityType };
