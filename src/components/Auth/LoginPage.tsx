import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import gsap from "gsap";
import Spinner from "../UI/Spinner";

const LoginPage: React.FC = () => {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const { signIn } = useAuth();
  useTheme(); // ensures dark class is applied to <html> before paint

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
    setLoading(true);
    const { error: err } = await signIn(email, password);
    if (err) setError(err);
    setLoading(false);
  };

  return (
    <div className="grad-bg min-h-screen flex items-center justify-center p-4">
      {/* perf: transform-gpu stops shimmer from triggering layout recalc */}
      <div className="pointer-events-none fixed inset-0 shimmer opacity-30 transform-gpu" />

      <div
        ref={cardRef}
        className="
          glass rounded-3xl p-8 w-full max-w-md shadow-2xl relative overflow-hidden
          bg-white/80 dark:bg-white/5
        "
      >
        <div className="absolute inset-0 shimmer opacity-10 pointer-events-none transform-gpu" />

        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center text-2xl mb-3">
            🧪
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">TestPro</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">QA Test Management</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="input"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              className="input"
            />
          </div>

          {/* 
            Fix: always reserve space so the button doesn't jump.
            Fade in/out instead of mount/unmount.
          */}
          <div
            className={`
              overflow-hidden transition-all duration-300 ease-in-out
              ${error ? "max-h-24 opacity-100" : "max-h-0 opacity-0"}
            `}
          >
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-xl">
              {error}
            </div>
          </div>

          {/* Fix: min-h prevents button resize when swapping text ↔ spinner */}
          <button
            type="submit"
            disabled={loading}
            className="btn-primary flex items-center justify-center gap-2 mt-2 min-h-[48px]"
          >
            {loading ? <><Spinner size={18} /> Signing in…</> : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
