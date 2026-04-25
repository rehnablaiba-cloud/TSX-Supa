import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import gsap from "gsap";
import Spinner from "../UI/Spinner";
import { TrainFront } from "lucide-react";

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const { signIn } = useAuth();
  useTheme();

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
      <div className="pointer-events-none fixed inset-0 shimmer opacity-30 transform-gpu" />

      <div
        ref={cardRef}
        className="glass-frost rounded-3xl p-8 w-full max-w-md shadow-2xl relative overflow-hidden"
      >
        <div className="absolute inset-0 shimmer opacity-10 pointer-events-none transform-gpu" />

        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-c-brand flex items-center justify-center mb-3">
            <TrainFront size={28} className="text-t-primary" />
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
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="input"
            />
          </div>

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

          <button
            type="submit"
            disabled={loading}
            className="btn-primary flex items-center justify-center gap-2 mt-2 min-h-[48px]"
          >
            {loading ? (
              <>
                <Spinner size={18} /> Signing in…
              </>
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
