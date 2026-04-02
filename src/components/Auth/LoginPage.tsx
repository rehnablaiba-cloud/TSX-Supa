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
        className="glass rounded-3xl p-8 w-full max-w-md shadow-2xl relative overflow-hidden"
      >
        <div className="absolute inset-0 shimmer opacity-10 pointer-events-none transform-gpu" />

        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-c-brand flex items-center justify-center text-2xl mb-3">
            <svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" aria-hidden="true" role="img" class="iconify iconify--twemoji" preserveAspectRatio="xMidYMid meet" fill="#000000"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"><path fill="#A7A9AC" d="M2 36h32L23 19H13z"></path><path fill="#58595B" d="M5 36h26L21 19h-6z"></path><path fill="#808285" d="M8 36h20l-9-17h-2z"></path><path fill="#A7A9AC" d="M28 35a1 1 0 0 1-1 1H9a1 1 0 1 1 0-2h18a1 1 0 0 1 1 1zm-2-4a1 1 0 0 1-1 1H11a1 1 0 1 1 0-2h14a1 1 0 0 1 1 1z"></path><path fill="#58595B" d="M27.076 25.3L23 19H13l-4.076 6.3c1.889 2.517 4.798 4.699 9.076 4.699c4.277 0 7.188-2.183 9.076-4.699z"></path><path fill="#A7A9AC" d="M18 0C9 0 6 3 6 9v8c0 1.999 3 11 12 11s12-9.001 12-11V9c0-6-3-9-12-9z"></path><path fill="#E6E7E8" d="M8 11C8 2 12.477 1 18 1s10 1 10 10c0 6-4.477 11-10 11c-5.523-.001-10-5-10-11z"></path><path fill="#FFAC33" d="M18 21.999c1.642 0 3.185-.45 4.553-1.228C21.77 19.729 20.03 19 18 19s-3.769.729-4.552 1.772c1.366.777 2.911 1.227 4.552 1.227z"></path><path d="M19 4.997v4.965c3.488-.232 6-1.621 6-2.463V5.833c0-.791-3.692-.838-6-.836zm-2 0c-2.308-.002-6 .044-6 .836V7.5c0 .842 2.512 2.231 6 2.463V4.997z" fill="#55ACEE"></path><path fill="#269" d="M6 10s0 3 4 9c0 0-4-2-4-6v-3zm24 0s0 3-4 9c0 0 4-2 4-6v-3z"></path></g></svg>
          </div>
          <h1 className="text-2xl font-bold text-t-primary">TestPro</h1>
          <p className="text-t-muted text-sm mt-1">Test Execution Management System</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs text-t-muted mb-1.5">
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
            <label className="block text-xs text-t-muted mb-1.5">
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
