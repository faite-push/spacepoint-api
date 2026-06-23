const bodyParser = require("body-parser");
const express = require('express');
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const path = require("path");
const fs = require("fs");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

const app = express();
app.set('trust proxy', 1);

require("dotenv").config();

process.on("uncaughtException", (err) => {
  console.error("[ERRO DETECTADO]: " + err.message);
  console.error("Stack Trace: " + err.stack);
});

process.on("unhandledRejection", (reason) => {
  if (reason instanceof Error) {
    console.error("[ERRO DETECTADO]:", reason.message);
    console.error("Stack Trace: " + reason.stack);
  } else {
    console.error("[ERRO DETECTADO]:", reason);
  }
});

function parseAllowedOrigins() {
  const raw = process.env.FRONTEND_URL || "";
  const origins = raw.split(",").map((s) => s.trim()).filter(Boolean);

  if (process.env.NODE_ENV !== "production") {
    origins.push("http://localhost:3000", "http://127.0.0.1:3000");
  }

  const expanded = [...origins];
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      const altHost = url.hostname.startsWith("www.")
        ? url.hostname.slice(4)
        : `www.${url.hostname}`;
      expanded.push(`${url.protocol}//${altHost}${url.port ? `:${url.port}` : ""}`);
    } catch {
      // ignore invalid URLs
    }
  }

  return [...new Set(expanded)];
}

const allowedOrigins = parseAllowedOrigins();

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    console.warn("[CORS] Blocked origin:", origin);
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-CSRF-Token",
    "X-Requested-With",
    "Idempotency-Key",
    "ngrok-skip-browser-warning",
  ],
}));

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Limite de requisições atingido. Tente novamente em breve.' },
});

app.use('/v2/api/', generalLimiter);

const routesDir = path.join(__dirname, "src", "routes");
for (const file of fs.readdirSync(routesDir)) {
  if (!file.endsWith(".js")) continue;
  const route = require(path.join(routesDir, file));
  app.use("/", route);
};

try {
  const cronService = require("./src/services/cron.service");
  cronService.init();
} catch {
}

app.listen({
  host: "0.0.0.0",
  port: process.env.PORT,
}, () => {
  console.log(`[API] Server running on port ${process.env.PORT}`);
});