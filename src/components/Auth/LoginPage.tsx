import React, { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import gsap from "gsap";
import Spinner from "../UI/Spinner";
import { TrainFront, Eye, EyeOff } from "lucide-react";

const RATE_LIMIT = { maxAttempts: 5, windowMs: 60000, blockMs: 300000 };

function useRateLimiter() {
  const [isBlocked, setIsBlocked] = useState(false);
  const [remaining, setRemaining] = useState(RATE_LIMIT.maxAttempts);
  const attemptsRef = useRef<{ count: number; firstAttempt: number } | null>(
    null
  );
  const blockTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const recordAttempt = useCallback(() => {
    const now = Date.now();
    const record = attemptsRef.current;

    if (!record || now - record.firstAttempt > RATE_LIMIT.windowMs) {
      attemptsRef.current = { count: 1, firstAttempt: now };
      setRemaining(RATE_LIMIT.maxAttempts - 1);
      return true;
    }

    record.count++;
    setRemaining(Math.max(0, RATE_LIMIT.maxAttempts - record.count));

    if (record.count >= RATE_LIMIT.maxAttempts) {
      setIsBlocked(true);
      blockTimerRef.current = setTimeout(() => {
        setIsBlocked(false);
        attemptsRef.current = null;
        setRemaining(RATE_LIMIT.maxAttempts);
      }, RATE_LIMIT.blockMs);
      return false;
    }
    return true;
  }, []);

  useEffect(() => () => clearTimeout(blockTimerRef.current), []);

  return { isBlocked, remaining, recordAttempt };
}

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const { signIn } = useAuth();
  const { theme } = useTheme(); // ← FIX: capture theme value
  const { isBlocked, remaining, recordAttempt } = useRateLimiter();

  useEffect(() => {
    gsap.fromTo(
      cardRef.current,
      { opacity: 0, y: 40, scale: 0.96 },
      { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: "back.out(1.4)" }
    );
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (isBlocked) {
      setError("Too many attempts. Please try again later.");
      return;
    }

    if (!recordAttempt()) {
      setError("Too many attempts. Please try again in 5 minutes.");
      return;
    }

    setLoading(true);
    const { error: err } = await signIn(email, password);
    if (err) {
      // Generic message — prevents user enumeration attacks
      setError("Invalid email or password.");
    }
    setLoading(false);
  };

  return (
    <div className="grad-bg min-h-screen flex items-center justify-center p-4">
      <div className="pointer-events-none fixed inset-0 shimmer opacity-30 transform-gpu" />

      <div
        ref={cardRef}
        className="glass-frost rounded-3xl p-8 w-full max-w-md shadow-2xl relative overflow-hidden"
      >
        <div className="absolute inset-0 shimmer opacity-10 pointer-events-none transform-gpu" />

        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3"
            style={{ backgroundColor: "var(--color-brand)" }}
          >
            <TrainFront size={28} style={{ color: "var(--text-primary)" }} />
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

          {/* Rate limit warning */}
          {remaining < RATE_LIMIT.maxAttempts && remaining > 0 && (
            <p className="text-[11px] text-t-muted">
              {remaining} attempt{remaining !== 1 ? "s" : ""} remaining
            </p>
          )}

          <div
            className={`
              overflow-hidden transition-all duration-300 ease-in-out
              ${error ? "max-h-24 opacity-100" : "max-h-0 opacity-0"}
            `}
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
            className="btn-primary flex items-center justify-center gap-2 mt-2 min-h-[48px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Spinner size={18} /> Signing in…
              </>
            ) : isBlocked ? (
              "Blocked — try later"
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
