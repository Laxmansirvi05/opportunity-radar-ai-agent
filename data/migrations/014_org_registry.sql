-- Canonical employer/application-domain cache used by Phase 5 link resolution.
CREATE TABLE IF NOT EXISTS org_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_name TEXT NOT NULL UNIQUE,
  official_domains JSONB NOT NULL DEFAULT '[]',
  careers_url TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER set_updated_at_org_registry BEFORE UPDATE ON org_registry FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_org_registry_verified_at ON org_registry (verified_at DESC);
