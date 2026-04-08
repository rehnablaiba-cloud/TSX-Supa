import React from "react";
import { useAuth } from "../../context/AuthContext";
import { useSessionTimeout } from "../../hooks/useSessionTimeout";
import SessionTimeoutModal from "./SessionTimeoutModal";

/**
 * Wrap your authenticated layout with this component.
 * It handles idle detection, the 5-min warning overlay, and
 * auto-logout (+ test_locks cleanup) on timeout.
 *
 * Example in App.tsx:
 *   {user && (
 *     <SessionManager>
 *       <Sidebar ... />
 *       <main>...</main>
 *     </SessionManager>
 *   )}
 */
const SessionManager: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, signOut } = useAuth();

  const { warning, secondsLeft, stayLoggedIn, releaseAndSignOut } =
    useSessionTimeout(user?.id, signOut);

  return (
    <>
      {children}
      {warning && (
        <SessionTimeoutModal
          secondsLeft={secondsLeft}
          onStay={stayLoggedIn}
          onSignOut={releaseAndSignOut}
        />
      )}
    </>
  );
};

export default SessionManager;