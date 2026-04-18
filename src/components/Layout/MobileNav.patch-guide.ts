// ═══════════════════════════════════════════════════════════════════════════════
// MobileNav.tsx — complete patch guide (File 8)
// Apply changes in order. Each block shows BEFORE → AFTER.
// ═══════════════════════════════════════════════════════════════════════════════


// ─── STEP 1: Replace supabase import ─────────────────────────────────────────

// BEFORE
import supabase from "../../supabase";

// AFTER
import {
  fetchAllTables,
  fetchModuleOptions,
  createModule,
  updateModule,
  deleteModule,
  fetchTestOptions,
  createTest,
  updateTest,
  deleteTest,
  fetchTestsForModule,
  fetchStepsForTest,
  replaceCsvSteps,
  fetchStepOptions,
  createStep,
  updateStep,
  deleteStep,
  releaseLocksAndSignOut,
} from "../../lib/supabase/queries.mobilenav";
// Note: remove "import supabase from ..." entirely — no direct supabase usage remains in MobileNav


// ─── STEP 2: Remove local fetchAllTables helper ───────────────────────────────

// DELETE this entire function (lines ~42–53 in original):
// async function fetchAllTables(): Promise<{ data: AllData; errors: string[] }> {
//   const data = {} as AllData;
//   const errors: string[] = [];
//   await Promise.all(
//     ALL_TABLES.map(async table => {
//       const { data: rows, error } = await supabase.from(table).select("*");
//       if (error) errors.push(`${table}: ${error.message}`);
//       else data[table] = rows ?? [];
//     })
//   );
//   return { data, errors };
// }
// The imported fetchAllTables() from queries.mobilenav.ts is a drop-in replacement.
// No call-site changes needed — ExportModal calls it identically.


// ─── STEP 3: ImportModulesModal — module loading effect ──────────────────────

// BEFORE
useEffect(() => {
  if (stage !== "selectmodule") return;
  setLoadingMods(true);
  supabase
    .from("modules")
    .select("name")
    .order("name")
    .then(({ data, error }) => {
      if (!error) setModules(data ?? []);
      setLoadingMods(false);
    });
}, [stage]);

// AFTER
useEffect(() => {
  if (stage !== "selectmodule") return;
  setLoadingMods(true);
  fetchModuleOptions()
    .then(setModules)
    .catch(() => {})
    .finally(() => setLoadingMods(false));
}, [stage]);


// ─── STEP 4: ImportModulesModal — handleSubmit ────────────────────────────────

// BEFORE (three inline supabase calls inside switch/if)
if (op === "create") {
  const { error } = await supabase.from("modules").insert({ name: trimmed });
  if (error) throw error;
} else if (op === "update") {
  const { error } = await supabase.from("modules").update({ name: newName }).eq("name", selectedMod.name);
  if (error) throw error;
} else {
  const { error } = await supabase.from("modules").delete().eq("name", selectedMod.name);
  if (error) throw error;
}

// AFTER
if (op === "create") {
  await createModule(trimmed);
} else if (op === "update") {
  await updateModule(selectedMod.name, newName);
} else {
  await deleteModule(selectedMod.name);
}


// ─── STEP 5: ImportTestsModal — test loading effect ──────────────────────────

// BEFORE
useEffect(() => {
  if (stage !== "selecttest") return;
  setLoadingTests(true);
  supabase
    .from("tests")
    .select("serialno, name")
    .order("serialno", { ascending: true })
    .then(({ data, error }) => {
      if (!error) setTests(data ?? []);
      setLoadingTests(false);
    });
}, [stage]);

// AFTER
useEffect(() => {
  if (stage !== "selecttest") return;
  setLoadingTests(true);
  fetchTestOptions()
    .then(setTests)
    .catch(() => {})
    .finally(() => setLoadingTests(false));
}, [stage]);


// ─── STEP 6: ImportTestsModal — handleSubmit ─────────────────────────────────

// BEFORE
if (op === "create") {
  const { error } = await supabase.from("tests").insert({ serialno: sn, name: trimmed });
  if (error) throw error;
} else if (op === "update") {
  const { error } = await supabase.from("tests").update({ name: newName }).eq("name", selectedTest.name);
  if (error) throw error;
} else {
  const { error } = await supabase.from("tests").delete().eq("name", selectedTest.name);
  if (error) throw error;
}

// AFTER
if (op === "create") {
  await createTest(sn, trimmed);
} else if (op === "update") {
  await updateTest(selectedTest.name, newName);
} else {
  await deleteTest(selectedTest.name);
}


// ─── STEP 7: ImportStepsModal (CSV) — fetch tests for module ─────────────────

// BEFORE
useEffect(() => {
  if (stage !== "selecttest" || !selectedModule) return;
  setLoadingTests(true);
  supabase
    .from("moduletests")
    .select("testsname, tests(serialno, name)")
    .eq("modulename", selectedModule.name)
    .then(({ data, error }) => {
      if (!error) setTests(/* map data */);
      setLoadingTests(false);
    });
}, [stage, selectedModule]);

// AFTER
useEffect(() => {
  if (stage !== "selecttest" || !selectedModule) return;
  setLoadingTests(true);
  fetchTestsForModule(selectedModule.name)
    .then(setTests)
    .catch(() => {})
    .finally(() => setLoadingTests(false));
}, [stage, selectedModule]);


// ─── STEP 8: ImportStepsModal (CSV) — fetch existing steps for diff ───────────

// BEFORE
const { data: existingSteps } = await supabase
  .from("teststeps")
  .select("id, serialno, action, expectedresult, isdivider")
  .eq("testsname", selectedTest.name)
  .order("serialno", { ascending: true });

// AFTER
const existingSteps = await fetchStepsForTest(selectedTest.name);


// ─── STEP 9: ImportStepsModal (CSV) — bulk write ─────────────────────────────

// BEFORE
await supabase.from("teststeps").delete().eq("testsname", selectedTest.name);
await supabase.from("teststeps").insert(parsedRows.map(r => ({ testsname: selectedTest.name, ...r })));

// AFTER
await replaceCsvSteps(
  selectedTest.name,
  parsedRows.map(r => ({
    testsname:      selectedTest.name,
    serialno:       r.serialno,
    action:         r.action,
    expectedresult: r.expectedresult,
    isdivider:      r.isdivider,
  }))
);


// ─── STEP 10: ImportStepsManualModal — module loading effect ──────────────────

// BEFORE
useEffect(() => {
  if (stage !== "selectmodule") return;
  setLoadingModules(true);
  supabase.from("modules").select("name").order("name")
    .then(({ data }) => { setModules(data ?? []); setLoadingModules(false); });
}, [stage]);

// AFTER
useEffect(() => {
  if (stage !== "selectmodule") return;
  setLoadingModules(true);
  fetchModuleOptions()
    .then(setModules)
    .catch(() => {})
    .finally(() => setLoadingModules(false));
}, [stage]);


// ─── STEP 11: ImportStepsManualModal — tests for module effect ────────────────

// BEFORE
useEffect(() => {
  if (stage !== "selecttest" || !selectedModule) return;
  setLoadingTests(true);
  supabase.from("moduletests").select("testsname, tests(serialno, name)").eq("modulename", selectedModule.name)
    .then(({ data }) => { setTests(/* map */); setLoadingTests(false); });
}, [stage, selectedModule]);

// AFTER
useEffect(() => {
  if (stage !== "selecttest" || !selectedModule) return;
  setLoadingTests(true);
  fetchTestsForModule(selectedModule.name)
    .then(setTests)
    .catch(() => {})
    .finally(() => setLoadingTests(false));
}, [stage, selectedModule]);


// ─── STEP 12: ImportStepsManualModal — steps for test effect ──────────────────

// BEFORE
useEffect(() => {
  if (stage !== "selectstep" || !selectedTest) return;
  setLoadingSteps(true);
  supabase.from("teststeps").select("id, serialno, testsname, action, expectedresult, isdivider")
    .eq("testsname", selectedTest.name).order("serialno", { ascending: true })
    .then(({ data }) => { setSteps(data ?? []); setLoadingSteps(false); });
}, [stage, selectedTest]);

// AFTER
useEffect(() => {
  if (stage !== "selectstep" || !selectedTest) return;
  setLoadingSteps(true);
  fetchStepOptions(selectedTest.name)
    .then(setSteps)
    .catch(() => {})
    .finally(() => setLoadingSteps(false));
}, [stage, selectedTest]);


// ─── STEP 13: ImportStepsManualModal — handleSubmit ───────────────────────────

// BEFORE
if (op === "create") {
  const { error } = await supabase.from("teststeps").insert({ testsname: selectedTest.name, serialno: snVal, action: form.action.trim(), expectedresult: form.expectedresult.trim(), isdivider: form.isdivider });
  if (error) throw error;
} else if (op === "update") {
  const { error } = await supabase.from("teststeps").update({ action: form.action.trim(), expectedresult: form.expectedresult.trim(), isdivider: form.isdivider }).eq("id", selectedStep.id);
  if (error) throw error;
} else {
  const { error } = await supabase.from("teststeps").delete().eq("id", selectedStep.id);
  if (error) throw error;
}

// AFTER
if (op === "create") {
  await createStep({
    testsname:      selectedTest.name,
    serialno:       snVal,
    action:         form.action.trim(),
    expectedresult: form.expectedresult.trim(),
    isdivider:      form.isdivider,
  });
} else if (op === "update") {
  await updateStep(selectedStep.id, {
    action:         form.action.trim(),
    expectedresult: form.expectedresult.trim(),
    isdivider:      form.isdivider,
  });
} else {
  await deleteStep(selectedStep.id);
}


// ─── STEP 14: Sign-out handler ────────────────────────────────────────────────

// BEFORE
const handleSignOut = async () => {
  try {
    if (user?.id) {
      await supabase.from("testlocks").delete().eq("userid", user.id);
    }
    await signOut();
  } catch (err) {
    console.error("Sign out failed", err);
  }
  setShowMore(false);
};

// AFTER
const handleSignOut = useCallback(async () => {
  try {
    if (user?.id) await releaseLocksAndSignOut(user.id, signOut);
    else          await signOut();
  } catch (err) {
    console.error("Sign out failed", err);
  }
  setShowMore(false);
}, [user?.id, signOut]);
