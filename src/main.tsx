// src/main.tsx
//
// Entry point — created to add QueryClientProvider above the entire tree.
// If you currently have src/index.tsx as your entry point, either:
//   (a) rename it to main.tsx, or
//   (b) keep index.tsx and paste this content there instead.
//
// Check vite.config.ts → build.rollupOptions.input if you're unsure which
// file Vite is using as the entry. The default for Vite is src/main.tsx.
//
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import App from "./App";
import "./index.css"; // keep whatever global CSS import you already have

// ── DevTools — lazy loaded, zero prod bundle impact ───────────────────────────
// The import only resolves in dev. In production this is a no-op component.
const ReactQueryDevtools =
  import.meta.env.DEV
    ? React.lazy(() =>
        import("@tanstack/react-query-devtools").then((m) => ({
          default: m.ReactQueryDevtools,
        }))
      )
    : () => null;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/*
      QueryClientProvider must wrap everything — it makes the shared cache
      available to every useQuery / useMutation call in the tree.
      queryClient is the singleton from src/lib/queryClient.ts.
    */}
    <QueryClientProvider client={queryClient}>
      <App />
      {import.meta.env.DEV && (
        <React.Suspense fallback={null}>
          {/* Bottom-left panel in dev — inspect cache keys, stale/fresh status */}
          <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
        </React.Suspense>
      )}
    </QueryClientProvider>
  </React.StrictMode>
);
