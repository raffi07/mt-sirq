import { Handlers } from "$fresh/server.ts";
import { sqlPool } from "../../fresh.config.ts";
import log from "../../libs/logs.ts";

export const handler: Handlers<string | null> = {
  async GET(_req) {
    log("INFO", "/ping GET request received");
    const sqlConnection = await sqlPool.connect();

    try {
      const result = await sqlConnection.queryObject`
        SELECT current_timestamp, version();
    `;
      return new Response(JSON.stringify(result.rows));
    } finally {
      log("INFO", "Pong");
      sqlConnection.release();
      log("INFO", "Releasing SQL connection from /api/ping");
    }
  },
};
