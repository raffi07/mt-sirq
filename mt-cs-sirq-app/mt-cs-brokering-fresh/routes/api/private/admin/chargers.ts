import { FreshContext, Handlers, STATUS_CODE } from "$fresh/server.ts";
import { sqlPool } from "../../../../fresh.config.ts";
import log from "../../../../libs/logs.ts";
import { returnConflict } from "../../../../libs/conflictResponse.ts";

type ContextState = {
  companyId: string;
  companyName: string;
  isAdmin: boolean;
};

type ChargersInput = {
  chargingStations: ChargersToEdit[];
};

type Chargers = {
  chargingStationId: string;
  chargers: Charger[];
};

type ChargersOutput = Chargers & {
  newTotalChargingSpots: number;
  newMaxReservationSpots: number;
};

type ChargersToEdit = Chargers & ChargersOutput & {
  amountToCreate: number;
};

type DatabaseCharger = {
  chargerId: string;
  chargingStationId: string;
  active: boolean;
};

type Charger = {
  chargerId: string;
  active: boolean;
};

function sqlResultToGetResponse(
  resultRows: { chargingStations: Chargers[] },
): Response {
  return new Response(JSON.stringify(resultRows), {
    status: STATUS_CODE.OK,
    headers: { "Content-Type": "application/json" },
  });
}

export const handler: Handlers<Request, ContextState> = {
  async GET(_req, _ctx: FreshContext<ContextState>) {
    log("INFO", "admin/chargers GET request received");
    const sqlConnection = await sqlPool.connect();

    try {
      const groupedChargersOutput: Chargers[] = [];
      log("INFO", "Fetching all chargers");
      const resultRows = await sqlConnection.queryObject<
        DatabaseCharger
      >({
        text: `
                            SELECT charger_id, charging_station_id, active
                            FROM masterthesis_schema.chargers
                            ;
                    `,
        fields: [
          "chargerId",
          "chargingStationId",
          "active",
        ],
      }).then((itm) => itm.rows);
      resultRows.forEach((e) => {
        const foundIdx = groupedChargersOutput.findIndex((itm) =>
          itm?.chargingStationId === e.chargingStationId
        );
        if (foundIdx == -1) {
          groupedChargersOutput.push({
            chargingStationId: e.chargingStationId,
            chargers: [{
              chargerId: e.chargerId,
              active: e.active,
            }],
          });
        } else {
          groupedChargersOutput[foundIdx].chargers.push({
            chargerId: e.chargerId,
            active: e.active,
          });
        }
      });
      return sqlResultToGetResponse({
        chargingStations: groupedChargersOutput,
      });
    } catch (err) {
      const thrownError = err as Error;
      log("ERROR", `Chargers fetch error: '${thrownError}'`);
      if (thrownError.cause) {
        log("DEBUG", `Fail cause: '${thrownError.cause}'`);
      }
      return new Response(
        "Internal Server Error: Could not fetch chargers.",
        {
          status: STATUS_CODE.InternalServerError,
        },
      );
    } finally {
      sqlConnection.release();
      log(
        "INFO",
        "Releasing SQL connection from /api/private/admin/chargers",
      );
    }
  },

  async POST(req, _ctx) {
    const reqObj = (await req.json()) as ChargersInput;

    const reservationLookAhead = Deno.env.get('SPOT_ASSIGN_RESERVATION_LOOK_AHEAD')

    log("INFO", "/admin/chargers POST request received");
    log("DEBUG", `Request: ${JSON.stringify(reqObj)}`);

    const results: {
      success: ChargersOutput[];
      errors: { chargingStationId: string }[];
    } = { success: [], errors: [] };

    const sqlConnection = await sqlPool.connect();

    // loop through the array chargingStations
    for (const e of reqObj.chargingStations) {
      const chargingStationId = e.chargingStationId;
      const amountToCreate = e.amountToCreate;
      const newTotalChargingSpots = e.newTotalChargingSpots;
      const newMaxReservationSpots = e.newMaxReservationSpots;

      try {
        log(
          "INFO",
          "Fetching v_reservation_count to check for existing reservations",
        );
        log("DEBUG", `Chargers change data ${JSON.stringify(e)}`);

        const resultRows = await sqlConnection.queryObject<
          {
            reservationCount: number;
            maxReservationSpots: number;
            maxReservationsReached: boolean;
          }
        >({
          text: `
                            SELECT reservation_count, max_reservation_spots, max_reservations_reached
                            FROM masterthesis_schema.v_reservation_count
                            WHERE charging_station_id = '${chargingStationId}'
                            AND interval_timestamp > (current_timestamp - INTERVAL '${reservationLookAhead} seconds')
                            ; 
                    `,
          fields: [
            "reservationCount",
            "maxReservationSpots",
            "maxReservationsReached",
          ],
        }).then((itm) => itm.rows);

        const chargers = e.chargers.map((itm) =>
          `('${chargingStationId}'::uuid, '${itm.chargerId}'::uuid, ${itm.active})`
        ).join(", ");

        log(
          "DEBUG",
          `Chargers query VALUES for getting newChargerCount: ${chargers}`,
        );

        const existingSetupInclChanges = await sqlConnection
          .queryObject<
            {
              newChargerCount: number;
            }
          >({
            text: `WITH changes AS (
                                SELECT *
                                FROM (
                                        VALUES ${chargers}
                                    ) AS chngs_from_json(charging_station_id, charger_id, active)
                            )
                            SELECT COUNT(*) FILTER (
                                    WHERE COALESCE(chng.active, chrs.active)
                                )::int AS new_count
                            FROM masterthesis_schema.chargers AS chrs
                                FULL JOIN changes AS chng ON chng.charger_id = chrs.charger_id
                                AND chng.charging_station_id = chrs.charging_station_id`,
            fields: [
              "newChargerCount",
            ],
          }).then((itm) => itm.rows);

        const newExpectedTotal = existingSetupInclChanges[0].newChargerCount +
          amountToCreate;

        if (newExpectedTotal != newTotalChargingSpots) {
          return returnConflict(
            "New expected total does not match the given total",
            `New expected total: ${newExpectedTotal} != given total: ${newTotalChargingSpots}`,
            "Verification of given new total of charging spots failed: Adding your changes and the existing amount of total charging spots does not result in your given total",
          );
        }

        if (newTotalChargingSpots < newMaxReservationSpots) {
          return returnConflict(
            "New maximum of reservation spots > new total of charging spots",
            `New total: ${newTotalChargingSpots} != given total: ${newMaxReservationSpots}`,
            "Verification of new total charging spots and new maximum reservation spots failed: The reservation spots need to be at least as much as the total",
          );
        }

        for (const e of resultRows) {
          if (e.reservationCount > newMaxReservationSpots) {
            return returnConflict(
              "Max reserve spots are reached in the future, hence spots can't be removed before settling the corresponding reservations",
              `Found exceeding reservation count in future: ${e.reservationCount}, which is higher than the new max: ${newMaxReservationSpots}`,
              "Change interfering with future reservations, please settle this first",
            );
          }
        }
      } catch (err) {
        const thrownError = err as Error;

        return returnConflict(
          `Error when verifying input data: '${thrownError.message}'`,
          `Verification failed, due to not matching input parameters: ${
            JSON.stringify(e)
          }, with cause: '${thrownError.cause}'`,
          "Verification of input with existing data failed: Please check, if the changes satisfy the correct delta and try again",
        );
      }

      // Insert new chargers

      const insertionStrings: string[] = [];

      for (let i = 0; i < amountToCreate; i++) {
        insertionStrings.push(
          `(gen_random_uuid(), '${chargingStationId}', TRUE)`,
        );
      }

      for (const itm of e.chargers) {
        insertionStrings.push(
          `('${itm.chargerId}', '${chargingStationId}', ${itm.active})`,
        );
      }

      const insertionString = insertionStrings.join(", ");

      const transaction = sqlConnection.createTransaction(
        "update_chargers_and_charging_stations",
      );

      try {
        const insertionResult: {
          chargerId: string;
          active: boolean;
        }[] = [];
        await transaction.begin();

        if (insertionStrings.length > 0) {
          log(
            "INFO",
            "Starting upsertion of updates for chargers.",
          );
          log("DEBUG", `Insert string: '${insertionString}'`);

          await transaction.queryObject<
            {
              chargerId: string;
              active: boolean;
            }
          >({
            text: `
                                INSERT INTO masterthesis_schema.chargers (charger_id, charging_station_id, active)
                                VALUES ${insertionString}
                                ON CONFLICT (charger_id, charging_station_id) DO UPDATE 
                                SET active = EXCLUDED.active
                                RETURNING charger_id, active
                                ; 
                        `,
            fields: [
              "chargerId",
              "active",
            ],
          }).then((itm) => insertionResult.push(...itm.rows));
        }

        log(
          "INFO",
          "Starting update of charging station data.",
        );

        const chargingStationUpdateResult = await transaction.queryObject<
          {
            chargingStationId: string;
            totalChargingSpots: number;
            maxReservationSpots: number;
          }
        >({
          text: `
                                UPDATE masterthesis_schema.charging_stations
                                SET total_charging_spots = ${e.newTotalChargingSpots}, max_reservation_spots = ${e.newMaxReservationSpots}
                                WHERE charging_station_id = '${chargingStationId}'
                                RETURNING charging_station_id, total_charging_spots, max_reservation_spots
                                ; 
                        `,
          fields: [
            "chargingStationId",
            "totalChargingSpots",
            "maxReservationSpots",
          ],
        }).then((itm) => itm.rows);

        log(
          "DEBUG",
          `Update log: ${JSON.stringify(chargingStationUpdateResult)}`,
        );

        const newChargersSituation = await transaction.queryObject<
          {
            chargerId: string;
            active: boolean;
          }
        >({
          text: `
                                SELECT charger_id, active
                                FROM masterthesis_schema.chargers
                                WHERE charging_station_id = '${chargingStationId}'
                                ; 
                        `,
          fields: [
            "chargerId",
            "active",
          ],
        }).then((itm) => itm.rows);

        await transaction.commit();

        results.success.push({
          chargingStationId: chargingStationUpdateResult[0].chargingStationId,
          newTotalChargingSpots: chargingStationUpdateResult[0].totalChargingSpots,
          newMaxReservationSpots:
            chargingStationUpdateResult[0].maxReservationSpots,
          chargers: newChargersSituation,
        });
      } catch (err) {
        const thrownError = err as Error;
        log(
          "ERROR",
          `Error when upserting chargers: '${thrownError.message}'`,
        );
        log(
          "DEBUG",
          `Could not upsert: ${
            JSON.stringify(e)
          }, with cause: '${thrownError.cause}'`,
        );
        results.errors.push({ chargingStationId: e.chargingStationId });
      }
    }
    sqlConnection.release();
    log(
      "INFO",
      "Releasing SQL connection from /api/private/admin/chargers",
    );
    return new Response(JSON.stringify(results), {
      status: STATUS_CODE.OK,
      headers: { "Content-Type": "application/json" },
    });
  },
};
