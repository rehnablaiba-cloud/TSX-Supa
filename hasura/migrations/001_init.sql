-- MODULES
CREATE TABLE IF NOT EXISTS public.modules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  description  TEXT,
  accent_color TEXT DEFAULT '#3b82f6',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- TESTS
CREATE TABLE IF NOT EXISTS public.tests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id   UUID NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  order_index INT  NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tests_module_id_idx ON public.tests(module_id);

-- STEPS
CREATE TABLE IF NOT EXISTS public.steps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id         UUID NOT NULL REFERENCES public.tests(id) ON DELETE CASCADE,
  serial_no       INT  NOT NULL,
  action          TEXT NOT NULL,
  expected_result TEXT NOT NULL DEFAULT '',
  remarks         TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pass','fail','pending')),
  is_divider      BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS steps_test_id_idx ON public.steps(test_id);

-- TEST LOCKS
CREATE TABLE IF NOT EXISTS public.testlocks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id        UUID UNIQUE NOT NULL REFERENCES public.tests(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL,
  locked_by_name TEXT NOT NULL,
  locked_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- AUDIT LOG
CREATE TABLE IF NOT EXISTS public.auditlog (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL,
  username   TEXT NOT NULL,
  action     TEXT NOT NULL,
  severity   TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('pass','fail','warn','info')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auditlog_created_at_idx ON public.auditlog(created_at DESC);

-- Stale lock cleanup (run via Hasura scheduled event every 60s)
CREATE OR REPLACE FUNCTION cleanup_stale_locks()
RETURNS void AS $$
  DELETE FROM public.testlocks WHERE locked_at < (now() - INTERVAL '60 seconds');
$$ LANGUAGE sql SECURITY DEFINER;
