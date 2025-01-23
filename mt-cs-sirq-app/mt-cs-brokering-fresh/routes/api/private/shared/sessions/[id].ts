import { FreshContext, Handlers, STATUS_CODE } from "$fresh/server.ts";
import { sqlPool } from "../../../../../fresh.config.ts";
import log from "../../../../../libs/logs.ts";

type ContextState = {
  companyId: string;
  companyName: string;
  isAdmin: boolean;
};

type sessionOutput = {
  sessionId: string;
  licensePlate: string;
  chargingStationId: string;
  chargerId: string;
  arrivalTimestamp: string;
  spotAssignmentTimestamp: string;
  chargerCheckinTimestamp: string;
  startChargeTimestamp: string;
  endChargeTimestamp: string;
  departureTimestamp: string;
};

function sqlResultToGetResponse(
  output: sessionOutput,
): Response {
  return new Response(JSON.stringify(output), {
    status: STATUS_CODE.OK,
    headers: { "Content-Type": "application/json" },
  });
}

export const handler: Handlers<Request, ContextState> = {
  async GET(_req, ctx: FreshContext<ContextState>) {
    const id = ctx.params.id;

    log("INFO", "shared/established-sessions GET request received");
    log("DEBUG", `GET request for ID: '${id}'`);

    const sqlConnection = await sqlPool.connect();

    try {
      const companyFilter = ctx.state.isAdmin
        ? "WHERE session_id = '${id}'"
        : `AS cf 
        LEFT JOIN masterthesis_schema.fleets AS f ON f.company_id = '${ctx.state.companyId}'
        WHERE cf.session_id = '${id}'
        AND f.active = TRUE`;

      log(
        "INFO",
        `Start procedure for fetching session`,
      );

      const sessionsResult = await sqlConnection.queryObject<
        sessionOutput
      >({
        text: `
                              SELECT 
                                  session_id,
                                  cf.license_plate,
                                  charging_station_id,
                                  charger_id,
                                  arrival_ts,
                                  spot_assignment_ts,
                                  charger_checkin_ts,
                                  start_charge_ts,
                                  end_charge_ts,
                                  departure_ts
                                FROM masterthesis_schema.charging_flows
                                ${companyFilter}
                              ;
                      `,
        fields: [
          "sessionId",
          "licensePlate",
          "chargingStationId",
          "chargerId",
          "arrivalTimestamp",
          "spotAssignmentTimestamp",
          "chargerCheckinTimestamp",
          "startChargeTimestamp",
          "endChargeTimestamp",
          "departureTimestamp",
        ],
      }).then((itm) => itm.rows);

      if (sessionsResult.length < 1) {
        return new Response(
          "Check if the requested ID is correct and/or existing",
          { status: STATUS_CODE.Forbidden },
        );
      }

      const session = sessionsResult[0];
      return sqlResultToGetResponse(session);
    } catch (err) {
      const thrownError = err as Error;
      log("ERROR", `Auctions fetch error: '${thrownError}'`);
      if (thrownError.cause) {
        log("DEBUG", `Fail cause: '${thrownError.cause}'`);
      }
      return new Response(
        "Internal Server Error: Could not fetch sessions.",
        {
          status: STATUS_CODE.InternalServerError,
        },
      );
    } finally {
      sqlConnection.release();
      log(
        "INFO",
        "Releasing SQL connection from GET /api/private/shared/sessions",
      );
    }
  },
};
