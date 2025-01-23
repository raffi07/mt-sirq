import { Handlers, STATUS_CODE } from "$fresh/server.ts";
import { sqlPool } from "../../../../fresh.config.ts";
import log from "../../../../libs/logs.ts";
import { ChargingStations } from "../../../../libs/sharedTypes.ts";

type ContextState = {
  companyId: string;
  companyName: string;
  isAdmin: boolean;
};

type ChargingStationsRequest = {
  chargingStations: NewChargingStations[];
};

type ChargingStationsInclChargers = ChargingStations & {
  newChargers?: NewChargers[] | null;
};

type NewChargingStations = {
  chargingStationName: string;
  totalChargingSpots: number;
  maxReserveSpots: number;
  active: boolean;
  newChargers?: NewChargers[] | null;
};

type NewChargers = {
  chargerId: string;
  active: boolean;
};

type Chargers = {
  chargerId: string;
  chargingStationId: string;
  active: boolean;
};

export const handler: Handlers<Request, ContextState> = {
  async POST(req, _ctx) {
    const reqObj = (await req.json()) as ChargingStationsRequest;

    log("INFO", "/admin/new-charging-stations POST request received");
    log("DEBUG", `Request: ${JSON.stringify(reqObj)}`);

    const results: {
      success: ChargingStationsInclChargers[];
      error: { chargingStationName: string }[];
    } = { success: [], error: [] };

    const sqlConnection = await sqlPool.connect();

    for (const e of reqObj.chargingStations) {
      const stationName = e.chargingStationName;

      try {
        log("INFO", `Inserting new charging station`);
        log(
          "DEBUG",
          `Values: Station name '${stationName}', total charging spots ${e.totalChargingSpots}, max spots to reserve: ${e.maxReserveSpots}, active: ${e.active}`,
        );

        const transaction = sqlConnection.createTransaction(
          "add_missing_chargers",
          { isolation_level: "repeatable_read" },
        );

        const newUUID = crypto.randomUUID();
        const insertionResultRows: Chargers[] = [];

        await transaction.begin();

        const resultRows = await transaction.queryObject<ChargingStations>({
          text: `
                  INSERT INTO masterthesis_schema.charging_stations (charging_station_id, charging_station_name, total_charging_spots, max_reservation_spots, active)
                  VALUES ('${newUUID}', '${stationName}', ${e.totalChargingSpots}, ${e.maxReserveSpots}, TRUE)
                  RETURNING 
                    charging_station_id,
                    charging_station_name,
                    total_charging_spots,
                    max_reservation_spots,
                    active
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

        for (let i = 0; i < e.totalChargingSpots; i++) {
          await transaction.queryObject<
            Chargers
          >({
            text: `
                        INSERT INTO masterthesis_schema.chargers (charger_id, charging_station_id, active)
                        VALUES (gen_random_uuid(), '${newUUID}', TRUE)
                        RETURNING charger_id, charging_station_id, active
                        ;
                    `,
            fields: [
              "chargerId",
              "chargingStationId",
              "active",
            ],
          }).then((itm) => insertionResultRows.push(itm.rows[0]));
        }

        transaction.commit();

        if (resultRows.length > 0) {
          const result = resultRows[0];

          log(
            "DEBUG",
            `Successfully inserted charging station: {ID: ${result.chargingStationId}, Name: ${result.chargingStationName}, Active: ${result.active}}`,
          );

          log(
            "DEBUG",
            `Successfully inserted new chargers: ${
              JSON.stringify(insertionResultRows)
            }`,
          );

          results.success.push({
            chargingStationId: result.chargingStationId,
            chargingStationName: result.chargingStationName,
            totalChargingSpots: result.totalChargingSpots,
            maxReserveSpots: result.maxReserveSpots,
            active: result.active,
            newChargers: insertionResultRows,
          });
        } else {
          results.error.push({ chargingStationName: stationName });
        }
      } catch (err) {
        const thrownError = err as Error;
        log(
          "ERROR",
          `Error when inserting charging stations: '${thrownError.message}'`,
        );
        log(
          "DEBUG",
          `Could not insert: ${stationName}, with cause: '${thrownError.cause}'`,
        );
        results.error.push({ chargingStationName: stationName });
      }
    }
    sqlConnection.release();
    log("INFO", "Releasing SQL connection from new-charging-stations");
    return new Response(JSON.stringify(results), {
      status: STATUS_CODE.OK,
      headers: { "Content-Type": "application/json" },
    });
  },
};
