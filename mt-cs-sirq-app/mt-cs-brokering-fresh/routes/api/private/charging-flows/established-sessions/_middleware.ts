import { FreshContext, STATUS_CODE } from "$fresh/server.ts";
import log from "../../../../../libs/logs.ts";
import { EstablishedChargingFlowRequest, Session } from "../../../../../libs/sharedTypes.ts";
import { sqlPool } from "../../../../../fresh.config.ts";

interface ContextState {
  companyId: string;
  session: Session;
}

function terminateMiddleware(errorMsg: string) {
  log(
    "ERROR",
    `Charging flows Middleware error: ${errorMsg}`,
  );
  return new Response("Unauthorized", {
    status: STATUS_CODE.Unauthorized,
  });
}

export async function handler(
  req: Request,
  ctx: FreshContext<ContextState>,
): Promise<Response> {
  // const sessionId = getCookies(req.headers)?.sessionId;

  log(
    "DEBUG",
    `Established Sessions Middleware entered.`,
  );

  // if (!sessionId) {
  //   return terminateMiddleware(
  //     'No session ID available, "sessionId" is undefined',
  //   );
  // }

  // ctx.state.sessionId = sessionId;


  const reqObj = (await req.json()) as EstablishedChargingFlowRequest;

  const sqlConnection = await sqlPool.connect();

  

  try {
    const resultRows = await sqlConnection.queryObject<Session>({
        text: `
            SELECT *
            FROM masterthesis_schema.charging_flows
            WHERE charger_id = '${reqObj.chargerId}'
              AND charging_station_id = '${reqObj.chargingStationId}'
              AND license_plate = '${reqObj.licensePlate}'
              AND arrival_ts IS NOT NULL
              AND departure_ts IS NULL
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
          "departureTimestamp"
        ],
      }).then((itm) => itm.rows);

    if (resultRows.length < 1) {
      log("DEBUG", `No session ID found for license plate: '${reqObj.licensePlate}',charging station ID: '${reqObj.chargingStationId}, charger ID: '${reqObj.chargerId}'`);
      return terminateMiddleware(
        "Session was either not found or session is not active anymore",
      );
    }
    else{
      ctx.state.session = resultRows[0];
    }
  } catch (err) {
    const thrownError = err as Error;
    log("ERROR", `Establish session check error: '${thrownError}'`);
    return new Response(`Internal Server Error: '${thrownError}'`, {
      status: STATUS_CODE.InternalServerError,
    });
  } finally {
    sqlConnection.release();
    log("INFO", "Releasing SQL connection from Established session Middleware");
  }
  const resp = await ctx.next();
  return resp;
}
