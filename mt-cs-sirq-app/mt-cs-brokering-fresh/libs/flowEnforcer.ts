import type { PoolClient } from "https://deno.land/x/postgres@v0.19.3/client.ts";
import log from "./logs.ts";

export default async function enforceFlow(
  sqlConnection: PoolClient,
) {
  const transaction = sqlConnection.createTransaction("flow_enforcer");

  try {
    log(
      "INFO",
      `Starting flow enforcer`,
    );

    const looseFlowsSetEndChargingResult: { sessionId: string }[] = [];
    const looseFlowsSetDepartureResult: { sessionId: string }[] = [];

    await transaction.begin();

    await transaction.queryObject<
      {
        sessionId: string;
      }
    >({
      text: `
                  WITH set_end_charging AS (
                      SELECT session_id
                      FROM masterthesis_schema.v_loose_flows
                      WHERE update_col = 'end_charge_ts'
                      )
                  UPDATE masterthesis_schema.charging_flows AS cf
                  SET end_charge_ts = CURRENT_TIMESTAMP
                  FROM set_end_charging AS sec
                  WHERE sec.session_id = cf.session_id
                  RETURNING cf.session_id
                  ;
          `,
      fields: [
        "sessionId",
      ],
    }).then((itm) => looseFlowsSetEndChargingResult.push(...itm.rows));

    await transaction.queryObject<
      {
        sessionId: string;
      }
    >({
      text: `
                  WITH set_departure AS (
                      SELECT session_id
                      FROM masterthesis_schema.v_loose_flows
                      WHERE update_col = 'departure_ts'
                  )
                  UPDATE masterthesis_schema.charging_flows AS cf
                  SET departure_ts = CURRENT_TIMESTAMP
                  FROM set_departure AS sd
                  WHERE sd.session_id = cf.session_id
                  RETURNING cf.session_id
                  ;
          `,
      fields: [
        "sessionId",
      ],
    }).then((itm) => looseFlowsSetDepartureResult.push(...itm.rows));

    await transaction.commit();

    const changes = {
      endedCharging: looseFlowsSetEndChargingResult,
      setDeparture: looseFlowsSetDepartureResult,
    };

    await sqlConnection.queryObject<
      {
        executionTime: string;
        changes: string;
        cronJobType: string;
      }
    >({
      text: `
                  INSERT INTO masterthesis_schema.jobs (execution_time, changes, job_type)
                  VALUES (CURRENT_TIMESTAMP, '${JSON.stringify(changes)}', 'FLOW_ENFORCER')
                  RETURNING execution_time, changes, job_type
                  ;
          `,
      fields: [
        "executionTime",
        "changes",
        "cronJobType",
      ],
    }).then((itm) => itm.rows);

    log("INFO", "Successfully finished flow enforcement");
    log(
      "DEBUG",
      `Flow enforcer output: '${JSON.stringify(changes)}'`,
    );
  } catch (err) {
    const thrownError = err as Error;
    log("ERROR", "Could not successfully finish flow enforcement");
    log(
      "DEBUG",
      `Flow enforcer failed due to: '${thrownError.message}' with cause: '${thrownError.cause}'`,
    );
  }
}
