import { defineConfig } from "$fresh/server.ts";
import tailwind from "$fresh/plugins/tailwind.ts";
import log from "./libs/logs.ts";
import { Cron } from "https://deno.land/x/croner@8.1.2/dist/croner.js";
import { cronJobRefreshFlows } from "./libs/flowsRefresher.ts";
import { Pool } from "https://deno.land/x/postgres@v0.19.3/mod.ts";

const databaseUser = Deno.env.get("POSTGRES_USER");
const databaseScrt = Deno.env.get("POSTGRES_PASSWORD");
const databaseName = Deno.env.get("POSTGRES_DB");
const databaseHost = Deno.env.get("POSTGRES_HOSTNAME");

export default defineConfig({
  plugins: [tailwind()],
});

export const key = await crypto.subtle.generateKey(
  { name: "HMAC", hash: "SHA-512" },
  true,
  ["sign", "verify"],
);
log("INFO", "CryptoKey successfully initialized");

new Cron("*/5 * * * *", async () => {
  await cronJobRefreshFlows();
});

export const sqlPool = new Pool(
  {
    user: databaseUser,
    password: databaseScrt,
    hostname: databaseHost,
    database: databaseName,
  },
  20,
  true,
);
// Create a database pool with 20 connections that are lazily established
