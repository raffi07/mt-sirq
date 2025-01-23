import { FreshContext, Handlers, STATUS_CODE } from "$fresh/server.ts";
import { sqlPool } from "../../../../fresh.config.ts";
import log from "../../../../libs/logs.ts";
import { ChargingStations } from "../../../../libs/sharedTypes.ts";

type ContextState = {
  companyId: string;
  companyName: string;
  isAdmin: boolean;
};
type ChargingStationsWithoutStatus = {
  chargingStationId: string;
  chargingStationName: string;
  totalChargingSpots: number;
};

type ChargingStationStatus = {
  chargingStationId: string;
  active: boolean;
};

type ChargingStationInput = {
  chargingStations: ChargingStationStatus[];
};

function sqlResultToResponse(
  resultRows: ChargingStations[] | ChargingStationsWithoutStatus[],
): Response {
  return new Response(JSON.stringify({ chargingStations: resultRows }), {
    status: STATUS_CODE.OK,
    headers: { "Content-Type": "application/json" },
  });
}

export const handler: Handlers<Request, ContextState> = {
  async GET(_req, ctx: FreshContext<ContextState>) {
    log("INFO", "shared/charging-stations GET request received");

    const sqlConnection = await sqlPool.connect();

    log("INFO", "Fetching all charging stations");

    try {
      if (ctx.state.isAdmin) {
        const resultRows = await sqlConnection.queryObject<
          ChargingStations
        >({
          text: `
                  SELECT * 
                  FROM masterthesis_schema.charging_stations
                  ;
              `,
          fields: [
            "chargingStationId",
            "chargingStationName",
            "totalChargingSpots",
            "maxReserveSpots",
            "active",
          ],
        }).then((itm) => itm.rows);
        return sqlResultToResponse(resultRows);
      } else {
        const resultRows = await sqlConnection.queryObject<
          {
            chargingStationId: string;
            chargingStationName: string;
            totalChargingSpots: number;
          }
        >({
          text: `
                  SELECT charging_station_id, charging_station_name, total_charging_spots, max_reserve_spots 
                  FROM masterthesis_schema.charging_stations
                  WHERE active = TRUE
                  ;
              `,
          fields: [
            "chargingStationId",
            "chargingStationName",
            "totalChargingSpots",
            "maxReserveSpots",
          ],
        }).then((itm) => itm.rows);
        return sqlResultToResponse(resultRows);
      }
    } catch (err) {
      const thrownError = err as Error;
      log("ERROR", `Charging station fetch error: '${thrownError}'`);
      if (thrownError.cause) {
        log("DEBUG", `Fail cause: '${thrownError.cause}'`);
      }
      return new Response(
        "Internal Server Error: Could not fetch charging stations.",
        {
          status: STATUS_CODE.InternalServerError,
        },
      );
    } finally {
      sqlConnection.release();
      log(
        "INFO",
        "Releasing SQL connection from /api/private/shared/charging-stations",
      );
    }
  },

  async POST(req, ctx: FreshContext<ContextState>) {
    if (!ctx.state.isAdmin) {
      return new Response(null, {
        status: STATUS_CODE.Unauthorized,
      });
    }

    const reqObj = (await req.json()) as ChargingStationInput;
    log("INFO", "/shared/charging-stations POST request received");
    log("DEBUG", `Request: ${JSON.stringify(reqObj)}`);
    const results: {
      success: ChargingStationStatus[];
      errors: { chargingStationId: string }[];
    } = { success: [], errors: [] };

    const sqlConnection = await sqlPool.connect();

    for (const e of reqObj.chargingStations) {
      try {
        log("INFO", "Updating charging stations");
        log(
          "DEBUG",
          `Changing table charging_stations with data: charging station: '${e.chargingStationId}' status: ${e.active}`,
        );
        const chargingStationUpdateResult = await sqlConnection.queryObject<
          ChargingStationStatus
        >({
          text: `
                                UPDATE masterthesis_schema.charging_stations (charging_station_id, active)
                                SET active = ${e.active}
                                WHERE charging_station_id = ${e.chargingStationId}
                                RETURNING charging_station_id, active
                                ; 
                        `,
          fields: [
            "chargingStationId",
            "active",
          ],
        }).then((itm) => itm.rows);

        log("INFO", 'Table "charging_stations" update successfully');

        results.success.push({
          chargingStationId: chargingStationUpdateResult[0].chargingStationId,
          active: chargingStationUpdateResult[0].active,
        });
      } catch (err) {
        const thrownError = err as Error;
        log(
          "ERROR",
          `Error when updating charging stations: '${thrownError.message}'`,
        );
        log(
          "DEBUG",
          `Could not update: ${
            JSON.stringify(e)
          }, with cause: '${thrownError.cause}'`,
        );
        results.errors.push({ chargingStationId: e.chargingStationId });
      }
    }

    sqlConnection.release();
    log(
      "INFO",
      "Releasing SQL connection from /api/private/shared/charging-stations",
    );
    return new Response(JSON.stringify(results), {
      status: STATUS_CODE.OK,
      headers: { "Content-Type": "application/json" },
    });
  },
};
