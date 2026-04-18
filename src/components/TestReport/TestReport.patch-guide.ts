// TestReport.tsx — apply these changes

// 1) Replace:
// import supabase from "../../supabase";

// with:
import { fetchTestReportData, fetchReportStepResults } from "../../lib/supabase/queries.testreport";


// 2) Replace the entire load() / useEffect block:
// The original fetches 3 parallel supabase calls (modules, teststeps, stepresults).

// Replace with:
useEffect(() => {
  let cancelled = false;
  setLoading(true);
  setError(null);

  fetchTestReportData()
    .then(({ modules, steps, stepResults }) => {
      if (cancelled) return;
      setModules(modules);
      setSteps(steps);
      setStepResults(stepResults);
      setLoading(false);
    })
    .catch(err => {
      if (!cancelled) { setError(err.message); setLoading(false); }
    });

  return () => { cancelled = true; };
}, []);


// 3) If TestReport uses a realtime channel on stepresults,
//    replace its inline refresh callback with:
const refreshResults = useCallback(() => {
  fetchReportStepResults().then(data => setStepResults(data)).catch(() => {});
}, []);

// Keep the supabase.channel() call itself inside the component as before (realtime-bound).
