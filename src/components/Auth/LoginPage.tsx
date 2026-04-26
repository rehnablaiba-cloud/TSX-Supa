import React, { useLayoutEffect, useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { supabase } from "../../supabase";
import gsap from "gsap";
import Spinner from "../UI/Spinner";
import { TrainFront, Eye, EyeOff } from "lucide-react";

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [blockedUntil, setBlockedUntil] = useState<Date | null>(null);

  const cardRef = useRef<HTMLDivElement>(null);
  const { signIn } = useAuth();
  const { theme } = useTheme();

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        cardRef.current,
        { opacity: 0, y: 40, scale: 0.96 },
        { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: "back.out(1.4)" }
      );
    });
    return () => ctx.revert();
  }, []);

  // Countdown display while blocked
  useEffect(() => {
    if (!blockedUntil) return;
    const interval = setInterval(() => {
      if (new Date() >= blockedUntil) {
        setBlockedUntil(null);
        setError("");
        setRemaining(5);
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [blockedUntil]);

  const isBlocked = blockedUntil !== null && new Date() < blockedUntil;

  const getBlockedSecondsLeft = () => {
    if (!blockedUntil) return 0;
    return Math.max(0, Math.ceil((blockedUntil.getTime() - Date.now()) / 1000));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (isBlocked) {
      setError(`Too many attempts. Try again in ${getBlockedSecondsLeft()}s.`);
      return;
    }

    setLoading(true);

    try {
      // Gate check — recorded server-side, persists across refreshes
      const { data: gateData, error: gateError } = await supabase.rpc(
        "record_login_attempt",
        { p_email: email.toLowerCase().trim() }
      );

      if (gateError) throw gateError;

      const gate = gateData as {
        allowed: boolean;
        remaining: number;
        blocked_until: string | null;
      };

      if (!gate.allowed) {
        const until = gate.blocked_until ? new Date(gate.blocked_until) : null;
        setBlockedUntil(until);
        setRemaining(0);
        setError(
          `Too many attempts. Try again in ${getBlockedSecondsLeft()}s.`
        );
        setLoading(false);
        return;
      }

      setRemaining(gate.remaining);

      // Attempt sign in
      const { error: signInError } = await signIn(email, password);

      if (signInError) {
        setError(
          gate.remaining <= 1
            ? `Invalid credentials. You have ${gate.remaining} attempt left.`
            : gate.remaining === 0
            ? "Account temporarily blocked. Try again in 5 minutes."
            : `Invalid email or password. ${gate.remaining} attempt${
                gate.remaining !== 1 ? "s" : ""
              } remaining.`
        );
      } else {
        // Clear attempts on success
        await supabase.rpc("clear_login_attempts", {
          p_email: email.toLowerCase().trim(),
        });
      }
    } catch {
      setError("Something went wrong. Please try again.");
    }

    setLoading(false);
  };

  return (
    <div className="grad-bg min-h-screen flex items-center justify-center p-4">
      <div
        className={`pointer-events-none fixed inset-0 shimmer transform-gpu ${
          theme === "light" ? "opacity-50" : "opacity-30"
        }`}
      />

      <div
        ref={cardRef}
        className="glass-frost rounded-3xl p-8 w-full max-w-md shadow-2xl relative overflow-hidden"
      >
        <div
          className={`absolute inset-0 shimmer pointer-events-none transform-gpu ${
            theme === "light" ? "opacity-20" : "opacity-10"
          }`}
        />

        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3"
            style={{ backgroundColor: "var(--color-brand)" }}
          >
            <TrainFront size={28} strokeWidth={2} color="#ffffff" />
          </div>
          <h1 className="text-2xl font-bold text-t-primary">TestPro</h1>
          <p className="text-t-muted text-sm mt-1">
            Test Execution Management System
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs text-t-muted mb-1.5">Email</label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="input"
              disabled={isBlocked}
            />
          </div>

          <div>
            <label className="block text-xs text-t-muted mb-1.5">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input pr-10"
                disabled={isBlocked}
              />
              <button
                type="button"
                onClick={() => setShowPassword((p) => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-t-muted hover:text-t-primary transition"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {remaining !== null &&
            remaining < 5 &&
            remaining > 0 &&
            !isBlocked && (
              <p className="text-[11px] text-t-muted">
                {remaining} attempt{remaining !== 1 ? "s" : ""} remaining
              </p>
            )}

          <div
            className={`overflow-hidden transition-all duration-300 ease-in-out ${
              error ? "max-h-24 opacity-100" : "max-h-0 opacity-0"
            }`}
          >
            <div
              className="text-sm px-4 py-3 rounded-xl"
              style={{
                background:
                  "color-mix(in srgb, var(--color-fail) 10%, transparent)",
                border:
                  "1px solid color-mix(in srgb, var(--color-fail) 30%, transparent)",
                color: "var(--color-fail)",
              }}
            >
              {error}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || isBlocked}
            className="btn-primary text-[var(--bg-surface)] flex items-center justify-center gap-2 mt-2 min-h-[48px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Spinner size={18} /> Signing in…
              </>
            ) : isBlocked ? (
              `Blocked — ${getBlockedSecondsLeft()}s`
            ) : (
              "Sign In"
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
