import React from "react";
import { useTheme } from "../../context/ThemeContext";

const SunIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
    strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-[color-mix(in_srgb,var(--color-warn),white_30%)]">
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 7a5 5 0 1 1 0 10A5 5 0 0 1 12 7Z" />
  </svg>
);

const MoonIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
    strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-c-brand">
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75 9.75 9.75 0 0 1 8.25 6c0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 12c0 5.385 4.365 9.75 9.75 9.75 4.596 0 8.477-3.172 9.502-7.498Z" />
  </svg>
);

const ThemeToggle: React.FC = () => {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      title="Toggle theme"
      className="
        flex items-center justify-center w-9 h-9 rounded-lg
        bg-bg-card hover:bg-bg-surface
        text-t-secondary hover:text-t-primary
        border border-(--border-color)
        transition-colors duration-200
      "
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
};

export default ThemeToggle;
