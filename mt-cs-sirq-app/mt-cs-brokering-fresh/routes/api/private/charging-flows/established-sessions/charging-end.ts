import { FreshContext, Handlers, STATUS_CODE } from "$fresh/server.ts";
import log from "../../../../../libs/logs.ts";
import { Session } from "../../../../../libs/sharedTypes.ts";
import { refreshFlows } from "../../../../../libs/flowsRefresher.ts";
import { sqlPool } from "../../../../../fresh.config.ts";
import { returnConflict } from "../../../../../libs/conflictResponse.ts";
import assignChargingSpots from "../../../../../libs/assignSpots.ts";

type ContextState = {
  companyId: string;
  session: Session;
};

type SuccessResponse = {
  sessionId: string;
  chargerId: string;
  chargingEndTimestamp: string;
};

export const handler: Handlers<Request, ContextState> = {
  async POST(_req, ctx: FreshContext<ContextState>) {
    const reqObj = ctx.state.session;

    log(
      "INFO",
      "/charging-flows/established-sessions/charging-end POST request received",
    );
    log("DEBUG", `Request: ${JSON.stringify(reqObj)}`);

    const sessionId = reqObj.sessionId;
    const chargerId = reqObj.chargerId;

    const sqlConnection = await sqlPool.connect();
    await refreshFlows(sqlConnection);

    log(
      "DEBUG",
      `Received charging-end POST request for: license plate: '${reqObj.licensePlate}', in charging station with ID: '${reqObj.chargingStationId}, for charger with ID: '${reqObj.chargerId}'`,
    );

    try {
      log(
        "INFO",
        `Retrieving opened charging flows for license plate: '${reqObj.licensePlate}'`,
      );

      const chargingFlowCheckResult = await sqlConnection.queryObject<
        {
          sessionId: string;
          chargingStationId: string;
          chargingEndTimestamp: string;
        }
      >({
        text: `
                      SELECT session_id, charging_station_id, end_charge_ts
                      FROM masterthesis_schema.charging_flows
                      WHERE license_plate = '${reqObj.licensePlate}'
                        AND start_charge_ts IS NOT NULL
                        AND charger_id = '${reqObj.chargerId}'
                        AND departure_ts IS NULL
                      ; 
              `,
        fields: [
          "sessionId",
          "chargingStationId",
          "chargingEndTimestamp",
        ],
      }).then((itm) => itm.rows);

      if (chargingFlowCheckResult.length < 1) {
        return returnConflict(
          "Could not set charging end timestamp",
          `No session found with license plate: ${reqObj.licensePlate}, charger id: ${reqObj.chargerId}, charging start timestamp not NULL and departure timestamp not NULL`,
          "Could not set charging end time as there is no session to set a charging end for a started charge, please settle this first",
        );
      } else {
        log(
          "INFO",
          `Setting charging end timestamp for session ID: '${sessionId}' and charger ID: '${chargerId}'`,
        );

        const setChargingEndResult = await sqlConnection.queryObject<
          {
            sessionId: string;
            chargerId: string;
            chargingEndTimestamp: string;
          }
        >({
          text: `
                        UPDATE masterthesis_schema.charging_flows 
                        SET end_charge_ts = CURRENT_TIMESTAMP
                        WHERE session_id = '${sessionId}'
                        RETURNING session_id, charger_id, end_charge_ts
                `,
          fields: [
            "sessionId",
            "chargerId",
            "chargingEndTimestamp",
          ],
        }).then((itm) => itm.rows);

        assignChargingSpots(sqlConnection);

        const result: SuccessResponse = {
          sessionId: setChargingEndResult?.[0].sessionId,
          chargerId: setChargingEndResult?.[0].chargerId,
          chargingEndTimestamp: setChargingEndResult?.[0]
            .chargingEndTimestamp,
        };

        return new Response(
          JSON.stringify(result),
          {
            status: STATUS_CODE.OK,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    } catch (err) {
      log(
        "ERROR",
        `Error when trying to insert charging start timestamp into charging_flows table: ${err}`,
      );
      return new Response(`Internal Server Error: ${err}`, {
        status: STATUS_CODE.InternalServerError,
      });
    } finally {
      sqlConnection.release();
      log(
        "INFO",
        "Releasing SQL connection from /api/private/charging-flows/established-sessions/charging-end",
      );
    }
  },
};
