-- ═══════════════════════════════════════════════════════════════════════════
-- RLS MIGRATION  –  TestPro
-- Run this once in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Helper: is_admin() ────────────────────────────────────────────────────
-- SECURITY DEFINER so the subquery runs as postgres, bypassing RLS on
-- profiles and avoiding infinite recursion.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (SELECT role = 'admin' FROM public.profiles WHERE id = auth.uid()),
    false
  )
$$;


-- ═══════════════════════════════════════════════════════════════
-- 1. PROFILES
-- ═══════════════════════════════════════════════════════════════
-- Note: there is NO client-side INSERT policy here by design.
-- Users are provisioned via the Supabase dashboard (service role),
-- which bypasses RLS entirely. A client INSERT would be a security hole.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read all profiles.
-- Needed for: lock owner names in TestExecution, UsersPanel list.
CREATE POLICY "profiles_select"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

-- Only admins can update profiles (blocks self-role-escalation by testers).
CREATE POLICY "profiles_update_admin_only"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ═══════════════════════════════════════════════════════════════
-- 2. MODULES
-- ═══════════════════════════════════════════════════════════════
-- FIX: replaced FOR ALL (which redundantly covered SELECT) with
-- explicit INSERT/UPDATE/DELETE admin policies. The SELECT policy
-- is separate and covers all authenticated users.
ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "modules_select"
  ON public.modules FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "modules_insert_admin_only"
  ON public.modules FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "modules_update_admin_only"
  ON public.modules FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "modules_delete_admin_only"
  ON public.modules FOR DELETE
  TO authenticated
  USING (public.is_admin());


-- ═══════════════════════════════════════════════════════════════
-- 3. TESTS
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE public.tests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tests_select"
  ON public.tests FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "tests_insert_admin_only"
  ON public.tests FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "tests_update_admin_only"
  ON public.tests FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "tests_delete_admin_only"
  ON public.tests FOR DELETE
  TO authenticated
  USING (public.is_admin());


-- ═══════════════════════════════════════════════════════════════
-- 4. STEPS
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE public.steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "steps_select"
  ON public.steps FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "steps_insert_admin_only"
  ON public.steps FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "steps_update_admin_only"
  ON public.steps FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "steps_delete_admin_only"
  ON public.steps FOR DELETE
  TO authenticated
  USING (public.is_admin());


-- ═══════════════════════════════════════════════════════════════
-- 5. MODULE_TESTS
-- ═══════════════════════════════════════════════════════════════
-- Admin-only write confirmed: only admins assign tests to modules.
ALTER TABLE public.module_tests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "module_tests_select"
  ON public.module_tests FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "module_tests_insert_admin_only"
  ON public.module_tests FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "module_tests_update_admin_only"
  ON public.module_tests FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "module_tests_delete_admin_only"
  ON public.module_tests FOR DELETE
  TO authenticated
  USING (public.is_admin());


-- ═══════════════════════════════════════════════════════════════
-- 6. STEP_RESULTS
-- ═══════════════════════════════════════════════════════════════
-- Permissions are intentionally split by role and operation:
--   SELECT  → all authenticated (testers executing, admins exporting via MobileNav)
--   UPDATE  → only the current lock holder (enforced at DB level)
--   INSERT  → admin only (seeding rows when a test is added to a module)
--   DELETE  → admin only (cleanup when a test is removed from a module)
--   UPDATE by admin → explicitly NOT granted (admins read-only on results)
ALTER TABLE public.step_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "step_results_select"
  ON public.step_results FOR SELECT
  TO authenticated
  USING (true);

-- UPDATE only if the calling user holds the lock for that module_test.
-- Admins are intentionally excluded — they have no UPDATE policy.
CREATE POLICY "step_results_update_lock_holder_only"
  ON public.step_results FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.testlocks
      WHERE module_test_id = step_results.module_test_id
        AND user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.testlocks
      WHERE module_test_id = step_results.module_test_id
        AND user_id = auth.uid()
    )
  );

CREATE POLICY "step_results_insert_admin_only"
  ON public.step_results FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "step_results_delete_admin_only"
  ON public.step_results FOR DELETE
  TO authenticated
  USING (public.is_admin());


-- ═══════════════════════════════════════════════════════════════
-- 7. TESTLOCKS
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE public.testlocks ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can read locks (shows "locked by X" in UI).
CREATE POLICY "testlocks_select"
  ON public.testlocks FOR SELECT
  TO authenticated
  USING (true);

-- Users can only acquire a lock for themselves.
CREATE POLICY "testlocks_insert_own"
  ON public.testlocks FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can only heartbeat their own lock.
CREATE POLICY "testlocks_update_own"
  ON public.testlocks FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Users can release their own lock.
CREATE POLICY "testlocks_delete_own"
  ON public.testlocks FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- FIX: admins can force-release any stuck lock.
-- Needed when a tester closes the browser mid-test and the heartbeat dies —
-- without this an admin has no way to unblock the test from the UI.
CREATE POLICY "testlocks_delete_admin_override"
  ON public.testlocks FOR DELETE
  TO authenticated
  USING (public.is_admin());


-- ═══════════════════════════════════════════════════════════════
-- 8. AUDITLOG
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE public.auditlog ENABLE ROW LEVEL SECURITY;

-- Only admins can read the full audit log.
CREATE POLICY "auditlog_select_admin_only"
  ON public.auditlog FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Any authenticated user can insert, but only for their own user_id.
-- The username column is NOT trusted from the client — a trigger
-- overwrites it with the value from profiles (see trigger below).
CREATE POLICY "auditlog_insert_own"
  ON public.auditlog FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- No UPDATE or DELETE policy = audit entries are immutable.


-- ── FIX: Audit username trigger ───────────────────────────────────────────
-- The client sends username as display_name but that value is unverified.
-- This BEFORE INSERT trigger overwrites it with the canonical value from
-- profiles, so the auditlog username always matches the real profile name
-- and cannot be spoofed by a client sending an arbitrary string.
CREATE OR REPLACE FUNCTION public.set_audit_username()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  SELECT display_name
    INTO NEW.username
    FROM public.profiles
   WHERE id = NEW.user_id;
  -- Fall back to the client-supplied value only if no profile row exists.
  IF NEW.username IS NULL THEN
    NEW.username := COALESCE(NEW.username, 'unknown');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auditlog_set_username
  BEFORE INSERT ON public.auditlog
  FOR EACH ROW
  EXECUTE FUNCTION public.set_audit_username();
