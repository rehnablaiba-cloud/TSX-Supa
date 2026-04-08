import React from "react";
import { useAuth } from "../../context/AuthContext";
import { useSessionTimeout } from "../../hooks/useSessionTimeout";
import SessionTimeoutModal from "./SessionTimeoutModal";

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