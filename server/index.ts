import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { startRecurringExpenseScheduler } from "./scheduler";
import { pool } from "./db";

const app = express();
const httpServer = createServer(app);

// ===== CORS — only allow requests from the official domain =====
app.use(
  cors({
    origin: process.env.CLIENT_URL || "https://spliiit.klarityit.ca",
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  })
);

// ===== Security headers via Helmet =====
app.use(
  helmet({
    contentSecurityPolicy: false, // handled by app's own CSP if needed
    crossOriginEmbedderPolicy: false, // allow embedding in TWA / Play Store
    crossOriginOpenerPolicy: false,
  })
);

// Disable X-Powered-By (redundant with helmet, but explicit)
app.disable("x-powered-by");

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "15mb", // large enough for base64-encoded receipt images
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

// Idempotent startup migrations — safely add new columns/tables without drizzle-kit push
async function runMigrations() {
  try {
    await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS notes text`);
    await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS currency text`);
    await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS original_amount real`);
    // Google OAuth support
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id text`);
    await pool.query(`ALTER TABLE users ALTER COLUMN password DROP NOT NULL`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_idx ON users(google_id) WHERE google_id IS NOT NULL`);
    // Apple Sign In support
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_id text`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_apple_id_idx ON users(apple_id) WHERE apple_id IS NOT NULL`);
    // User preferences (currency + theme)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS default_currency text`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS currency_locked_at text`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_preference text NOT NULL DEFAULT 'system'`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id varchar,
        user_id varchar NOT NULL,
        user_name text NOT NULL,
        action text NOT NULL,
        description text NOT NULL,
        created_at text NOT NULL
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS activity_log_group_id_idx ON activity_log(group_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS activity_log_created_at_idx ON activity_log(created_at)`);
    log("Startup migrations OK", "db");
  } catch (e) {
    log(`Startup migration error: ${e}`, "db");
  }
}

(async () => {
  await runMigrations();
  await registerRoutes(httpServer, app);

  // Start recurring expense scheduler (premium feature — auto-creates expenses on schedule)
  startRecurringExpenseScheduler();

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
