import { FreshContext, Handlers, STATUS_CODE } from "$fresh/server.ts";
import log from "../../../../../libs/logs.ts";
import { Session } from "../../../../../libs/sharedTypes.ts";
import { refreshFlows } from "../../../../../libs/flowsRefresher.ts";
import { sqlPool } from "../../../../../fresh.config.ts";
import assignChargingSpots from "../../../../../libs/assignSpots.ts";

type ContextState = {
  companyId: string;
  session: Session;
};

type SuccessResponse = {
  sessionId: string;
  chargerId: string;
  departureTimestamp: string;
};

export const handler: Handlers<Request, ContextState> = {
  async POST(_req, ctx: FreshContext<ContextState>) {
    const reqObj = ctx.state.session;

    log(
      "INFO",
      "/charging-flows/established-sessions/departures POST request received",
    );
    log("DEBUG", `Request: ${JSON.stringify(reqObj)}`);

    const sessionId = reqObj.sessionId;

    const sqlConnection = await sqlPool.connect();
    await refreshFlows(sqlConnection);

    log(
      "DEBUG",
      `Received departures POST request for: license plate: '${reqObj.licensePlate}', in charging station with ID: '${reqObj.chargingStationId}, for charger with ID: '${reqObj.chargerId}'`,
    );

    try {
      log(
        "INFO",
        `Setting new departure for session ID: '${sessionId}'`,
      );

      const departureResult = await sqlConnection.queryObject<
        {
          sessionId: string;
          chargerId: string;
          departureTimestamp: string;
        }
      >({
        text: `
                        UPDATE masterthesis_schema.charging_flows 
                        SET departure_ts = CURRENT_TIMESTAMP
                        WHERE session_id = '${sessionId}'
                        RETURNING session_id, charger_id, start_charge_ts
                `,
        fields: [
          "sessionId",
          "chargerId",
          "departureTimestamp",
        ],
      }).then((itm) => itm.rows);

      assignChargingSpots(sqlConnection);

      const result: SuccessResponse = {
        sessionId: departureResult?.[0].sessionId,
        chargerId: departureResult?.[0].chargerId,
        departureTimestamp: departureResult?.[0].departureTimestamp,
      };

      return new Response(
        JSON.stringify(result),
        {
          status: STATUS_CODE.OK,
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (err) {
      log(
        "ERROR",
        `Error when trying to insert departure timestamp into charging_flows table: ${err}`,
      );
      return new Response(`Internal Server Error: ${err}`, {
        status: STATUS_CODE.InternalServerError,
      });
    } finally {
      sqlConnection.release();
      log(
        "INFO",
        "Releasing SQL connection from /api/private/charging-flows/established-sessions/departures",
      );
    }
  },
};
