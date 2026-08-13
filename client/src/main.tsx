import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initTelemetry, setTelemetryUser, Sentry } from '@/lib/telemetry';

const CHUNK_RECOVERY_MARKER = "cqim-chunk-recovery";

function injectAnalyticsScript() {
  const endpoint = import.meta.env.VITE_ANALYTICS_ENDPOINT?.trim();
  const websiteId = import.meta.env.VITE_ANALYTICS_WEBSITE_ID?.trim();

  if (!endpoint || !websiteId || typeof document === "undefined") {
    return;
  }

  const normalizedEndpoint = endpoint.replace(/\/$/, "");
  const scriptSrc = `${normalizedEndpoint}/umami`;

  if (document.querySelector(`script[data-website-id="${websiteId}"]`)) {
    return;
  }

  const script = document.createElement("script");
  script.defer = true;
  script.src = scriptSrc;
  script.setAttribute("data-website-id", websiteId);
  document.head.appendChild(script);
}

function isChunkLoadingError(message?: string | null) {
  if (!message) {
    return false;
  }

  return [
    "Failed to fetch dynamically imported module",
    "Importing a module script failed",
    "Loading chunk",
    "ChunkLoadError",
  ].some((keyword) => message.includes(keyword));
}

function recoverFromStaleChunk(message?: string | null) {
  if (typeof window === "undefined" || !isChunkLoadingError(message)) {
    return false;
  }

  const alreadyRecovered = window.sessionStorage.getItem(CHUNK_RECOVERY_MARKER);
  if (alreadyRecovered === "1") {
    window.sessionStorage.removeItem(CHUNK_RECOVERY_MARKER);
    return false;
  }

  window.sessionStorage.setItem(CHUNK_RECOVERY_MARKER, "1");
  window.location.reload();
  return true;
}

function registerChunkRecovery() {
  if (typeof window === "undefined") {
    return;
  }

  window.addEventListener("error", (event) => {
    const target = event.target as HTMLScriptElement | null;
    const targetMessage = target?.tagName === "SCRIPT" ? `Importing a module script failed: ${target.src}` : null;
    recoverFromStaleChunk(targetMessage || event.message);
  }, true);

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message = typeof reason === "string"
      ? reason
      : reason?.message || String(reason || "");

    if (recoverFromStaleChunk(message)) {
      event.preventDefault();
    }
  });
}

initTelemetry();
setTelemetryUser(localStorage.getItem('user_id') || localStorage.getItem('userId') || undefined);
injectAnalyticsScript();
registerChunkRecovery();

const root = createRoot(document.getElementById("root")!);
root.render(
  <Sentry.ErrorBoundary fallback={<div className="flex min-h-screen items-center justify-center p-6 text-center text-sm text-muted-foreground">页面发生异常，请刷新后重试</div>}>
    <App />
  </Sentry.ErrorBoundary>,
);
