import { FreshContext, Handlers, STATUS_CODE } from "$fresh/server.ts";
import log from "../../../../../libs/logs.ts";
import { Session} from "../../../../../libs/sharedTypes.ts";
import { sqlPool } from "../../../../../fresh.config.ts";
import { returnConflict } from "../../../../../libs/conflictResponse.ts";
import { refreshFlows } from "../../../../../libs/flowsRefresher.ts";

type ContextState = {
  companyId: string;
  session: Session;
};

type SuccessResponse = {
  sessionId: string;
  chargerId: string;
  chargerCheckinTimestamp: string;
};

export const handler: Handlers<Request, ContextState> = {
  async POST(_req, ctx: FreshContext<ContextState>) {
    const reqObj = ctx.state.session;

    log(
      "INFO",
      "/charging-flows/established-sessions/charger-checkins POST request received",
    );
    log("DEBUG", `Request: ${JSON.stringify(reqObj)}`);

    const sessionId = reqObj.sessionId;
    const chargerId = reqObj.chargerId;

    const sqlConnection = await sqlPool.connect();
    await refreshFlows(sqlConnection);

    log(
      "DEBUG",
      `Received charger-checkin POST request for: license plate: '${reqObj.licensePlate}', in charging station with ID: '${reqObj.chargingStationId}, for charger with ID: '${reqObj.chargerId}'`,
    );

    try {
      log(
        "INFO",
        `Retrieving opened charging flows for license plate: '${reqObj.licensePlate}'`,
      );

      const openChargingFlowsResult = await sqlConnection.queryObject<
        {
          sessionId: string;
          chargingStationId: string;
          arrivalTimestamp: string;
        }
      >({
        text: `
                      SELECT session_id, charging_station_id, arrival_ts
                      FROM masterthesis_schema.charging_flows
                      WHERE license_plate = '${reqObj.licensePlate}' AND departure_ts IS NULL
                      ; 
              `,
        fields: [
          "sessionId",
          "chargingStationId",
          "arrivalTimestamp",
        ],
      }).then((itm) => itm.rows);

      if (openChargingFlowsResult.length > 1) {
        return returnConflict(
          "Multiple open charging flows found",
          `Multiple open charging flows found: '${
            JSON.stringify(openChargingFlowsResult)
          }'`,
          "Multiple open charging flows found. Only one open charging flow per license plate allowed, please settle this first",
        );
      } else {
        log(
          "INFO",
          `Setting new checkin for session ID: '${sessionId}' and charger ID: '${chargerId}'`,
        );

        const setChargingCheckinResult = await sqlConnection.queryObject<
          {
            sessionId: string;
            chargerId: string;
            chargerCheckinTimestamp: string;
          }
        >({
          text: `
                        UPDATE masterthesis_schema.charging_flows 
                        SET charger_checkin_ts = CURRENT_TIMESTAMP
                        WHERE session_id = '${sessionId}'
                        RETURNING session_id, charger_id, charger_checkin_ts
                `,
          fields: [
            "sessionId",
            "chargerId",
            "chargerCheckinTimestamp",
          ],
        }).then((itm) => itm.rows);

        const result: SuccessResponse = {
          sessionId: setChargingCheckinResult?.[0].sessionId,
          chargerCheckinTimestamp: setChargingCheckinResult?.[0]
            .chargerCheckinTimestamp,
          chargerId: setChargingCheckinResult?.[0].chargerCheckinTimestamp,
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
        `Error when trying to insert charging checkin timestamp into charging_flows table: ${err}`,
      );
      return new Response(`Internal Server Error: ${err}`, {
        status: STATUS_CODE.InternalServerError,
      });
    } finally {
      sqlConnection.release();
      log(
        "INFO",
        "Releasing SQL connection from /api/private/charging-flows/established-sessions/charger-checkins",
      );
    }
  },
};
