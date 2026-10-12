import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { openDatabase, initSchema } from "./db.js";
import { createApp, deleteExpiredSessions } from "./server.js";
import { runMigrations } from "../migrate.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT;
const isProduction = process.env.NODE_ENV === "production";
const API_BASE = isProduction
  ? process.env.API_BASE
  : `http://localhost:${PORT}`;
const TOMTOM_API_KEY = process.env.TOMTOM_API_KEY || "";

// Email configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

async function sendVerificationEmail(email, token) {
  const verificationUrl = `${API_BASE}/verify-email.html?token=${token}`;

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: "Verify your email for Trippino",
    html: `
      <h1>Welcome to Trippino!</h1>
      <p>Please click the link below to verify your email address:</p>
      <p><a href="${verificationUrl}">Verify my email</a></p>
      <p>If you didn't create an account, you can ignore this email.</p>
    `,
  });
}

const DATABASE_URL =
  process.env["DATABASE_URL"] || path.join(__dirname, "data.sqlite");
console.log("SQLite DB path:", DATABASE_URL);

const { db, run, get, all, transaction } = openDatabase(DATABASE_URL);

console.log("Initializing database schema...");
await initSchema(run);

console.log("Running database migrations...");
await runMigrations(db);

const app = createApp({
  run,
  get,
  all,
  transaction,
  sendVerificationEmail,
  config: {
    apiBase: API_BASE,
    tomtomApiKey: TOMTOM_API_KEY,
    isProduction,
    skipEmailSending: process.env.SKIP_EMAIL_SENDING === "true",
  },
});

// Background job: Clean up expired sessions every hour
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
setInterval(async () => {
  try {
    const deleted = await deleteExpiredSessions(run);
    if (deleted > 0) {
      console.log(`[Session Cleanup] Deleted ${deleted} expired session(s)`);
    }
  } catch (e) {
    console.error("[Session Cleanup] Error:", e);
  }
}, CLEANUP_INTERVAL);

app.listen(PORT, () => console.log(`Trippino listening on port: ${PORT}`));
