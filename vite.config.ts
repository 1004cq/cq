import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";

// =============================================================================
// Manus Debug Collector - Vite Plugin
// Writes browser logs directly to files, trimmed when exceeding size limit
// =============================================================================

const PROJECT_ROOT = import.meta.dirname;
const LOG_DIR = path.join(PROJECT_ROOT, ".manus-logs");
const MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024; // 1MB per log file
const TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6); // Trim to 60% to avoid constant re-trimming

type LogSource = "browserConsole" | "networkRequests" | "sessionReplay";

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function trimLogFile(logPath: string, maxSize: number) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= maxSize) {
      return;
    }

    const lines = fs.readFileSync(logPath, "utf-8").split("\n");
    const keptLines: string[] = [];
    let keptBytes = 0;

    // Keep newest lines (from end) that fit within 60% of maxSize
    const targetSize = TRIM_TARGET_BYTES;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(`${lines[i]}\n`, "utf-8");
      if (keptBytes + lineBytes > targetSize) break;
      keptLines.unshift(lines[i]);
      keptBytes += lineBytes;
    }

    fs.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch {
    /* ignore trim errors */
  }
}

function writeToLogFile(source: LogSource, entries: unknown[]) {
  if (entries.length === 0) return;

  ensureLogDir();
  const logPath = path.join(LOG_DIR, `${source}.log`);

  // Format entries with timestamps
  const lines = entries.map((entry) => {
    const ts = new Date().toISOString();
    return `[${ts}] ${JSON.stringify(entry)}`;
  });

  // Append to log file
  fs.appendFileSync(logPath, `${lines.join("\n")}\n`, "utf-8");

  // Trim if exceeds max size
  trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
}

/**
 * Vite plugin to collect browser debug logs
 * - POST /__manus__/logs: Browser sends logs, written directly to files
 * - Files: browserConsole.log, networkRequests.log, sessionReplay.log
 * - Auto-trimmed when exceeding 1MB (keeps newest entries)
 */
function vitePluginManusDebugCollector(): Plugin {
  return {
    name: "manus-debug-collector",

    transformIndexHtml(html) {
      if (process.env.NODE_ENV === "production") {
        return html;
      }
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: {
              src: "/__manus__/debug-collector.js",
              defer: true,
            },
            injectTo: "head",
          },
        ],
      };
    },

    configureServer(server: ViteDevServer) {
      // POST /__manus__/logs: Browser sends logs (written directly to files)
      server.middlewares.use("/__manus__/logs", (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }

        const handlePayload = (payload: any) => {
          // Write logs directly to files
          if (payload.consoleLogs?.length > 0) {
            writeToLogFile("browserConsole", payload.consoleLogs);
          }
          if (payload.networkRequests?.length > 0) {
            writeToLogFile("networkRequests", payload.networkRequests);
          }
          if (payload.sessionEvents?.length > 0) {
            writeToLogFile("sessionReplay", payload.sessionEvents);
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        };

        const reqBody = (req as { body?: unknown }).body;
        if (reqBody && typeof reqBody === "object") {
          try {
            handlePayload(reqBody);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
          return;
        }

        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });

        req.on("end", () => {
          try {
            const payload = JSON.parse(body);
            handlePayload(payload);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        });
      });
    },
  };
}

const isProduction = process.env.NODE_ENV === "production";
const plugins = [
  react(),
  tailwindcss(),
  !isProduction && jsxLocPlugin(),
  !isProduction && vitePluginManusRuntime(),  // 仅在开发环境启用，生产环境禁用以避免内联脚本冲突
  !isProduction && vitePluginManusDebugCollector(),
].filter(Boolean) as Plugin[];

export default defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    target: "es2022",
    minify: "esbuild",
    sourcemap: false,
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 500,
    // 关键优化：关闭 Vite 默认的"递归入口 chunk 依赖为 modulepreload"行为。
    // 默认会把 index.js 静态引用的所有 chunk（包含其递归依赖）都填进 HTML 的 modulepreload，
    // 导致 cos-vendor / qrcode-vendor / rxdb-vendor 在首屏就被预下载。
    // resolveDependencies 返回 [] 后，浏览器只会预加载主入口 index.js，
    // 每个页面的依赖在实际导航时才动态拉取。
    modulePreload: {
      polyfill: false,
      resolveDependencies: () => [],
    },
    rollupOptions: {
      output: {
        // 朋友圈/聊天首屏速度优化：把"按需才用"的大库拆出独立 chunk
        // 这样无论用户进朋友圈、登录页或聊天列表，都不会被强制下载 trtc/cos/lottie
        // 注意：只有"业务页面动态 import 的、且没在主入口被同步引用"的库才能成功懒加载
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return;
          }

          // React 核心（必须最早加载，单独成块）
          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/scheduler/")
          ) {
            return "react-vendor";
          }

          // 动画库（多个页面用到）
          if (id.includes("framer-motion")) {
            return "motion-vendor";
          }

          // 音视频通话 SDK（仅 CallScreen / 通话弹层用）— 单独成块，朋友圈/聊天列表不下载
          if (id.includes("trtc-sdk-v5") || id.includes("/trtc/")) {
            return "trtc-vendor";
          }

          // COS 上传 SDK（仅"发朋友圈/换头像"时用到）
          if (id.includes("cos-js-sdk-v5") || id.includes("@tencentyun")) {
            return "cos-vendor";
          }

          // Lottie 动画（仅贴纸面板用）
          if (id.includes("lottie-web")) {
            return "lottie-vendor";
          }

          // 二维码扫描（仅扫一扫/名片弹层用到）
          if (id.includes("jsqr") || id.includes("qrcode")) {
            return "qrcode-vendor";
          }

          // 本地数据库（聊天历史用）
          if (id.includes("rxdb") || id.includes("rxjs") || id.includes("/idb/")) {
            return "rxdb-vendor";
          }

          // XML 解析、压缩等基础库（多处使用，独立缓存）
          if (
            id.includes("fast-xml-parser") ||
            id.includes("/pako/")
          ) {
            return "util-vendor";
          }

          // 其他第三方库合并到主 vendor
          return "vendor";
        },
      },
    },
  },
  server: {
    port: 3000,
    strictPort: false, // Will find next available port if 3000 is busy
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1",
    ],
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/signal': {
        target: 'ws://localhost:3001',
        ws: true,
      },
      '/onebot': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
