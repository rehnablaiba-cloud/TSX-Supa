// Heartbeat and tab-close keepalive are now owned by ActiveLockContext.
// This stub keeps any lingering import sites from breaking.
const useReleaseLockOnUnload = (
  _module_test_id: string,
  _user_id: string
): void => {};
export default useReleaseLockOnUnload;
