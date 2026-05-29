#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const mode = process.argv.includes("--production") ? "production" : "local";
const envFileArg = process.argv.find((arg) => arg.startsWith("--env-file="));
const envFile = envFileArg?.slice("--env-file=".length);

function loadEnvFile(file) {
  if (!file || !fs.existsSync(file)) {
    return {};
  }

  const entries = {};
  const text = fs.readFileSync(file, "utf8");

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }

    const [key, ...rest] = line.split("=");
    entries[key.trim()] = rest.join("=").trim();
  }

  return entries;
}

const fileEnv = loadEnvFile(envFile ?? (fs.existsSync("apps/web/.env.local") ? "apps/web/.env.local" : ".env"));
const env = { ...fileEnv, ...process.env };

const required = [
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
  "OPENAI_API_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "INTEGRATION_TOKEN_ENCRYPTION_KEY",
];

const optional = [
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "GOOGLE_MAPS_API_KEY",
  "TWILIO_ACCOUNT_SID",
  "STRIPE_SECRET_KEY",
];

function present(key) {
  const value = env[key];

  return typeof value === "string" && value.trim() && !value.includes("YOUR-");
}

function validUrl(value) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

const failures = [];
const warnings = [];
let requiredPresentCount = 0;

for (const key of required) {
  if (!present(key)) {
    failures.push(`${key} is missing`);
  } else {
    requiredPresentCount += 1;
  }
}

if (!present("INBOUND_EMAIL_SYNC_SECRET") && !present("CRON_SECRET")) {
  failures.push("INBOUND_EMAIL_SYNC_SECRET or CRON_SECRET is missing");
} else {
  requiredPresentCount += 1;
}

if (present("NEXT_PUBLIC_APP_URL") && !validUrl(env.NEXT_PUBLIC_APP_URL)) {
  failures.push("NEXT_PUBLIC_APP_URL must be a valid URL");
}

if (present("NEXT_PUBLIC_SUPABASE_URL") && !validUrl(env.NEXT_PUBLIC_SUPABASE_URL)) {
  failures.push("NEXT_PUBLIC_SUPABASE_URL must be a valid URL");
}

if (present("DATABASE_URL") && !env.DATABASE_URL.startsWith("postgresql://")) {
  failures.push("DATABASE_URL must start with postgresql://");
}

if (present("INTEGRATION_TOKEN_ENCRYPTION_KEY") && env.INTEGRATION_TOKEN_ENCRYPTION_KEY.length < 32) {
  failures.push("INTEGRATION_TOKEN_ENCRYPTION_KEY should be at least 32 characters");
}

if (mode === "production") {
  if (present("NEXT_PUBLIC_APP_URL") && /localhost|127\.0\.0\.1/.test(env.NEXT_PUBLIC_APP_URL)) {
    failures.push("NEXT_PUBLIC_APP_URL cannot be localhost in production");
  }

  if (!present("CRON_SECRET") && !present("INBOUND_EMAIL_SYNC_SECRET")) {
    failures.push("Production cron sync needs CRON_SECRET or INBOUND_EMAIL_SYNC_SECRET");
  }
}

for (const key of optional) {
  if (!present(key)) {
    warnings.push(`${key} is not set; related integration remains unavailable`);
  }
}

console.log(`Kyro env check (${mode})`);
console.log(`Required values: ${requiredPresentCount}/${required.length + 1} present`);

if (warnings.length) {
  console.log("Warnings:");
  for (const warning of warnings) {
    console.log(`- ${warning}`);
  }
}

if (failures.length) {
  console.error("Failures:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Environment looks usable. Secret values were not printed.");
