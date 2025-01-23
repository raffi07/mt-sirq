import assignChargingSpots from "./assignSpots.ts";
import settleAuctions from "./auctionSettling.ts";
import enforceFlow from "./flowEnforcer.ts";
import { sqlPool } from "../fresh.config.ts";
import log from "./logs.ts";
import { PoolClient } from "https://deno.land/x/postgres@v0.19.3/mod.ts";

export async function cronJobRefreshFlows() {
  const threshold = Deno.env.get('CRON_BLOCK_INTERVAL');
  const sqlConnection = await sqlPool.connect();

  try {
    log(
      "INFO",
      `Refresh Flows CRON Job: Checking for last job timestamp`,
    );

    const lastExecutionResult = await sqlConnection.queryObject<
      {
        executionTime: string;
      }
    >({
      text: `
                    SELECT execution_time
                    FROM masterthesis_schema.jobs
                    WHERE CURRENT_TIMESTAMP < (execution_time + INTERVAL '${threshold}')
                    LIMIT 1
                    ;
            `,
      fields: [
        "executionTime",
      ],
    }).then((itm) => itm.rows);

    if (lastExecutionResult.length > 0) {
      log(
        "INFO",
        `Last update was done in less than ${threshold} ago, scheduled run will skip this occurrence`,
      );
    } else {
      refreshFlows(sqlConnection);
    }
  } catch (err) {
    const thrownError = err as Error;
    log("ERROR", "Could not successfully finish the refresh flow procedure");
    log(
      "DEBUG",
      `Refresh flow procedure failed due to: '${thrownError.message}' with cause: '${thrownError.cause}'`,
    );
  } finally {
    sqlConnection.release();
    log("INFO", "Releasing SQL connection from /libs/flowsRefresher.cronJobRefreshFlows()");
  }
}
export async function refreshFlows(connection?: PoolClient) {
  try {
    log(
      "INFO",
      `Starting Refresh Flow procedure`,
    );

    const sqlConnection = connection ?? await sqlPool.connect();
    await enforceFlow(sqlConnection);
    await settleAuctions(sqlConnection);
    await assignChargingSpots(sqlConnection);
  } catch (err) {
    const thrownError = err as Error;
    log("ERROR", "Could not refresh flows");
    log(
      "DEBUG",
      `Refreshing flows failed due to: '${thrownError.message}' with cause: '${thrownError.cause}'`,
    );
  }
}
