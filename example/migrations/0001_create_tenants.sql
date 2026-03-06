-- Migration: Create Tenants and API Keys Tables
-- Created: 2025-11-16
-- Description: Creates the tenant database schema for multi-tenant support
--
-- This migration creates:
-- 1. tenants table - Stores organization/tenant information
-- 2. api_keys table - Stores API keys for B2B authentication with revocation support
-- 3. Indexes for efficient API key lookups

-- ============================================================================
-- TENANTS TABLE
-- ============================================================================
-- Stores organization/tenant information
CREATE TABLE IF NOT EXISTS tenants (
  -- Primary key: Organization ID (user-defined, globally unique)
  org_id TEXT PRIMARY KEY NOT NULL,

  -- Organization name for display/management purposes
  org_name TEXT NOT NULL,

  -- ISO 8601 timestamp when the tenant was created
  created_at TEXT NOT NULL,

  -- Optional metadata fields (can be added as needed)
  -- Examples: billing_plan, max_users, features_enabled, etc.

  CHECK (length(org_id) > 0),
  CHECK (length(org_name) > 0)
);

-- ============================================================================
-- API KEYS TABLE
-- ============================================================================
-- Stores API keys for B2B tenant authentication
CREATE TABLE IF NOT EXISTS api_keys (
  -- Primary key: API key (plain or hashed, depending on security requirements)
  api_key TEXT PRIMARY KEY NOT NULL,

  -- Foreign key: Organization this API key belongs to
  org_id TEXT NOT NULL,

  -- Optional key name for identification (e.g., "Production Key", "Dev Key")
  key_name TEXT,

  -- ISO 8601 timestamp when the key was created
  created_at TEXT NOT NULL,

  -- Optional: ISO 8601 timestamp when the key expires (null = never expires)
  expires_at TEXT,

  -- Revocation flag (0 = active, 1 = revoked)
  revoked INTEGER NOT NULL DEFAULT 0,

  -- Foreign key constraint
  FOREIGN KEY (org_id) REFERENCES tenants(org_id) ON DELETE CASCADE,

  CHECK (length(api_key) > 0),
  CHECK (revoked IN (0, 1))
);

-- ============================================================================
-- INDEXES
-- ============================================================================
-- Index on org_id for efficient lookup of all keys belonging to an organization
CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys(org_id);

-- Index on revoked status for efficient filtering of active keys
CREATE INDEX IF NOT EXISTS idx_api_keys_revoked ON api_keys(revoked);

-- ============================================================================
-- COMMENTS & USAGE NOTES
-- ============================================================================
--
-- TENANT CREATION:
-- INSERT INTO tenants (org_id, org_name, created_at)
-- VALUES ('org-123', 'Acme Corporation', '2025-11-16T10:00:00Z');
--
-- API KEY CREATION:
-- INSERT INTO api_keys (api_key, org_id, key_name, created_at, revoked)
-- VALUES ('sk_live_abc123', 'org-123', 'Production Key', '2025-11-16T10:00:00Z', 0);
--
-- API KEY LOOKUP (used by ApiKeyTenantResolver):
-- SELECT org_id FROM api_keys WHERE api_key = ? AND revoked = 0;
--
-- API KEY REVOCATION:
-- UPDATE api_keys SET revoked = 1 WHERE api_key = ?;
--
-- SECURITY CONSIDERATIONS:
-- - Consider hashing API keys before storage (like passwords)
-- - Implement rate limiting on API key lookups
-- - Log API key usage for audit trails
-- - Rotate keys periodically
-- - Use HTTPS only for API key transmission
