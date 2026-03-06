-- Seed data for multitenancy testing
-- Created: 2025-11-16
-- Description: Sample tenants and API keys for testing multitenancy in Ceves example

-- ============================================================================
-- SAMPLE TENANTS
-- ============================================================================

-- Organization 1: Acme Corporation
INSERT INTO tenants (org_id, org_name, created_at)
VALUES ('org-acme', 'Acme Corporation', '2025-11-16T00:00:00Z');

-- Organization 2: Beta Industries
INSERT INTO tenants (org_id, org_name, created_at)
VALUES ('org-beta', 'Beta Industries', '2025-11-16T00:00:00Z');

-- Default organization for development
INSERT INTO tenants (org_id, org_name, created_at)
VALUES ('default-org', 'Default Organization (Dev)', '2025-11-16T00:00:00Z');

-- ============================================================================
-- SAMPLE API KEYS
-- ============================================================================

-- API key for Acme Corporation
-- Use this in X-API-Key header: sk_acme_test_key_123
INSERT INTO api_keys (api_key, org_id, key_name, created_at, revoked)
VALUES ('sk_acme_test_key_123', 'org-acme', 'Acme Test Key', '2025-11-16T00:00:00Z', 0);

-- API key for Beta Industries
-- Use this in X-API-Key header: sk_beta_test_key_456
INSERT INTO api_keys (api_key, org_id, key_name, created_at, revoked)
VALUES ('sk_beta_test_key_456', 'org-beta', 'Beta Test Key', '2025-11-16T00:00:00Z', 0);

-- Revoked API key (for testing revocation)
INSERT INTO api_keys (api_key, org_id, key_name, created_at, revoked)
VALUES ('sk_revoked_key_789', 'org-acme', 'Revoked Key', '2025-11-16T00:00:00Z', 1);

-- ============================================================================
-- USAGE INSTRUCTIONS
-- ============================================================================
--
-- 1. Apply the tenant schema migration:
--    wrangler d1 migrations apply ceves-tenants --local
--
-- 2. Seed the database:
--    wrangler d1 execute ceves-tenants --local --file=./seed-tenants.sql
--
-- 3. Test multitenancy:
--
--    # Create account for Acme (org-acme)
--    curl -X POST http://localhost:8787/accounts/acc-1/open \
--      -H "X-API-Key: sk_acme_test_key_123" \
--      -H "Content-Type: application/json" \
--      -d '{"email":"alice@acme.com","name":"Alice"}'
--
--    # Create account for Beta (org-beta)
--    curl -X POST http://localhost:8787/accounts/acc-1/open \
--      -H "X-API-Key: sk_beta_test_key_456" \
--      -H "Content-Type: application/json" \
--      -d '{"email":"bob@beta.com","name":"Bob"}'
--
--    # Both can create "acc-1" because they're in different orgs!
--    # The aggregateId is scoped to orgId in application logic.
--
--    # Try to access Beta's account with Acme's key (should fail with 403)
--    curl -X POST http://localhost:8787/accounts/acc-1/deposit \
--      -H "X-API-Key: sk_acme_test_key_123" \
--      -H "Content-Type: application/json" \
--      -d '{"amount":100}'
--
--    # This will fail because acc-1 for Acme is different from acc-1 for Beta
--
-- 4. Test without API key (uses DEFAULT_ORG_ID):
--    curl -X POST http://localhost:8787/accounts/acc-default/open \
--      -H "Content-Type: application/json" \
--      -d '{"email":"dev@localhost.com","name":"Dev User"}'
--
-- 5. Test with revoked key (should return 401):
--    curl -X POST http://localhost:8787/accounts/acc-2/open \
--      -H "X-API-Key: sk_revoked_key_789" \
--      -H "Content-Type: application/json" \
--      -d '{"email":"test@example.com","name":"Test"}'
