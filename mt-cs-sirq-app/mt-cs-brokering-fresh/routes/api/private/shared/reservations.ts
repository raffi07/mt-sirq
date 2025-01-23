import { FreshContext, Handlers, STATUS_CODE } from "$fresh/server.ts";
import { sqlPool } from "../../../../fresh.config.ts";
import log from "../../../../libs/logs.ts";
import { DateTime } from "https://deno.land/x/ts_luxon@5.0.6-4/src/datetime.ts";
import { Duration } from "https://deno.land/x/ts_luxon@5.0.6-4/src/duration.ts";
import { returnConflict } from "../../../../libs/conflictResponse.ts";

type ContextState = {
  companyId: string;
  companyName: string;
  isAdmin: boolean;
};

type Reservation = {
  licensePlate: string;
  startTimestamp: string;
  endTimestamp: string;
};

type ReservationDB = {
  licensePlate: string;
  chargingStationId: string;
  startTimestamp: string;
  endTimestamp: string;
};

type ReservationChanges = {
  reservationIdsToCreate: GroupedReservations[] | [];
  reservationIdsToRemove: GroupedReservations[] | [];
};

type GroupedReservations = {
  chargingStationId: string;
  reservations: Reservation[];
};

type ReservationOutput = {
  chargingStations: GroupedReservations[];
};

type Fleet = {
  licensePlate: string;
  companyId: string;
};

function sqlResultToGetResponse(
  output: ReservationOutput,
): Response {
  return new Response(JSON.stringify(output), {
    status: STATUS_CODE.OK,
    headers: { "Content-Type": "application/json" },
  });
}

export const handler: Handlers<Request, ContextState> = {
  async GET(_req, ctx: FreshContext<ContextState>) {
    log("INFO", "shared/reservations GET request received");
    const sqlConnection = await sqlPool.connect();

    try {
      const groupedReservationsOutput: GroupedReservations[] = [];

      const resultRows: ReservationDB[] = [];

      if (ctx.state.isAdmin) {
        log(
          "INFO",
          `Fetching all reservations as an admin`,
        );
        await sqlConnection.queryObject<
          ReservationDB
        >({
          text: `
                            SELECT license_plate, charging_station_id, start_ts, end_ts
                            FROM masterthesis_schema.reservations
                            ;
                    `,
          fields: [
            "licensePlate",
            "chargingStationId",
            "startTimestamp",
            "endTimestamp",
          ],
        }).then((itm) => resultRows.push(...itm.rows));
      } else {
        log(
          "INFO",
          `Fetching all reservations as company: '${ctx.state.companyName}', ID: '${ctx.state.companyId}'`,
        );
        await sqlConnection.queryObject<
          ReservationDB
        >({
          text: `
                            SELECT r.license_plate, r.charging_station_id, r.start_ts, r.end_ts
                            FROM masterthesis_schema.reservations AS r
                            LEFT JOIN masterthesis_schema.fleets AS f ON f.license_plate = r.license_plate
                            WHERE f.company_id = '${ctx.state.companyId}'
                            ;
                    `,
          fields: [
            "licensePlate",
            "chargingStationId",
            "startTimestamp",
            "endTimestamp",
          ],
        }).then((itm) => resultRows.push(...itm.rows));
      }
      resultRows.forEach((e) => {
        const foundIdx = groupedReservationsOutput.findIndex((itm) =>
          itm?.chargingStationId === e.chargingStationId
        );
        if (foundIdx == -1) {
          groupedReservationsOutput.push({
            chargingStationId: e.chargingStationId,
            reservations: [{
              licensePlate: e.licensePlate,
              startTimestamp: e.startTimestamp,
              endTimestamp: e.endTimestamp,
            }],
          });
        } else {
          groupedReservationsOutput[foundIdx].reservations.push({
            licensePlate: e.licensePlate,
            startTimestamp: e.startTimestamp,
            endTimestamp: e.endTimestamp,
          });
        }
      });
      return sqlResultToGetResponse({
        chargingStations: groupedReservationsOutput,
      });
    } catch (err) {
      const thrownError = err as Error;
      log("ERROR", `Reservations fetch error: '${thrownError}'`);
      if (thrownError.cause) {
        log("DEBUG", `Fail cause: '${thrownError.cause}'`);
      }
      return new Response(
        "Internal Server Error: Could not fetch reservations.",
        {
          status: STATUS_CODE.InternalServerError,
        },
      );
    } finally {
      sqlConnection.release();
      log(
        "INFO",
        "Releasing SQL connection from /api/private/shared/reservations",
      );
    }
  },

  async POST(req, ctx: FreshContext<ContextState>) {
    const reqObj = (await req.json()) as ReservationChanges;

    const earliestPossibleReservation = Number.parseFloat(Deno.env.get('RESERVATION_EARLIEST_POSSIBLE') ?? '0');
    const maximumReservationDuration = Number.parseFloat(Deno.env.get('RESERVATION_MAXIMUM_DURATION') ?? '0');
    const latestPossibleReservationDeletion = Number.parseFloat(Deno.env.get('RESERVATION_LATEST_DELETION_IN_PAST') ?? '0');

    log("INFO", "/shared/reservations POST request received");
    log("DEBUG", `Request: ${JSON.stringify(reqObj)}`);

    const results: {
      success: ReservationDB[];
      errors: ReservationDB[];
    } = { success: [], errors: [] };

    const sqlConnection = await sqlPool.connect();
    const fleetMapping: Fleet[] = [];
    const reservationIdsToCreate = reqObj.reservationIdsToCreate ?? [];
    const reservationIdsToRemove = reqObj.reservationIdsToRemove ?? [];

    // Getting fleet data to check for correct reservations to delete

    try {
      log(
        "INFO",
        `Fetching fleet data`,
      );
      log(
        "DEBUG",
        `Fleet data for company ID: ${ctx.state.companyId}, name: ${ctx.state.companyName}`,
      );
      await sqlConnection.queryObject<
        {
          licensePlate: string;
          companyId: string;
        }
      >({
        text: `
                                SELECT license_plate, company_id
                                FROM masterthesis_schema.fleets
                                WHERE ${
          !ctx.state.isAdmin
            ? "company_id = '" + ctx.state.companyId + "'::uuid AND"
            : ""
        }
                                active = TRUE
                                ; 
                        `,
        fields: [
          "licensePlate",
          "companyId",
        ],
      }).then((itm) => fleetMapping.push(...itm.rows));
    } catch (err) {
      log(
        "ERROR",
        `Error when trying to fetch the fleet for ('${ctx.state.companyId}', ${ctx.state.companyName}): ${err}`,
      );
      return new Response(`Internal Server Error: ${err}`, {
        status: STATUS_CODE.InternalServerError,
      });
    }

    // Check if reservation is not violating the maximum reservation spots

    const passedCheckForInsertion: ReservationDB[] = [];
    const passedCheckForRemoval: ReservationDB[] = [];

    try {
      const reservationsToAddInsertValues: string[] = [];
      for (const chargStation of reservationIdsToCreate) {
        for (const resv of chargStation.reservations) {
          if (
            DateTime.fromFormat(
              resv.startTimestamp,
              "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            ) <= DateTime.now().plus({ seconds: earliestPossibleReservation })
          ) {
            log(
              "INFO",
              "Timestamp of reservation to add is too close in the future, reservation is not added",
            );
            log(
              "DEBUG",
              `Reservation for license plate: '${resv.licensePlate}', start timestamp: '${resv.startTimestamp}' < '${
                DateTime.now().plus({ seconds: earliestPossibleReservation }).toFormat(
                  "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                )
              }' (now + ${earliestPossibleReservation} seconds)`,
            ); // this is set due to the fact, that you can't reserve while someone else is already charging and faces some restriction imposed by an incoming reservation,
            results.errors.push({
              licensePlate: resv.licensePlate,
              chargingStationId: chargStation.chargingStationId,
              startTimestamp: resv.startTimestamp,
              endTimestamp: resv.endTimestamp,
            });
            continue;
          }
          if (
            DateTime.fromFormat(
              resv.startTimestamp,
              "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            ) < DateTime.now()
          ) {
            log(
              "INFO",
              "Timestamp of reservation to add is in the past, reservation is not added",
            );
            log(
              "DEBUG",
              `Reservation for license plate: '${resv.licensePlate}', start timestamp: '${resv.startTimestamp}' < '${
                DateTime.now().toFormat(
                  "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                )
              }' (now)`,
            );
            results.errors.push({
              licensePlate: resv.licensePlate,
              chargingStationId: chargStation.chargingStationId,
              startTimestamp: resv.startTimestamp,
              endTimestamp: resv.endTimestamp,
            });
            continue;
          }
          if (
            DateTime.fromFormat(
              resv.startTimestamp,
              "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            ).diff(
              DateTime.fromFormat(
                resv.endTimestamp,
                "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
              ),
              "seconds",
            ).seconds >= maximumReservationDuration
          ) {
            log(
              "INFO",
              `Reservation time is exceeding the ${Duration.fromObject({seconds:maximumReservationDuration}).toFormat('mm:ss')} maximum reservation time`,
            );
            log(
              "DEBUG",
              `Reservation for license plate: '${resv.licensePlate}', start timestamp: '${resv.startTimestamp}' & end timestamp: '${resv.startTimestamp}' with duration: '${
                JSON.stringify(
                  DateTime.fromFormat(
                    resv.startTimestamp,
                    "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                  ).diff(
                    DateTime.fromFormat(
                      resv.endTimestamp,
                      "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                    ),
                    "minutes",
                  ),
                )
              }'
                            `,
            );
            results.errors.push({
              licensePlate: resv.licensePlate,
              chargingStationId: chargStation.chargingStationId,
              startTimestamp: resv.startTimestamp,
              endTimestamp: resv.endTimestamp,
            });
            continue;
          }
          if (
            !ctx.state.isAdmin &&
            !fleetMapping.map((e) => e.licensePlate).some((itm) =>
              itm === resv.licensePlate
            )
          ) {
            log(
              "INFO",
              "License plate can't be found for requesting entity, reservation is not added",
            );
            log(
              "DEBUG",
              `Reservation for license plate: '${resv.licensePlate}', start timestamp: '${resv.startTimestamp}' does not belong to company ID ${ctx.state.companyId}, company name: ${ctx.state.companyName}`,
            );
            results.errors.push({
              licensePlate: resv.licensePlate,
              chargingStationId: chargStation.chargingStationId,
              startTimestamp: resv.startTimestamp,
              endTimestamp: resv.endTimestamp,
            });
            continue;
          }
          reservationsToAddInsertValues.push(
            `('${resv.licensePlate}', '${chargStation.chargingStationId}'::uuid, '${resv.startTimestamp}'::timestamp, '${resv.endTimestamp}'::timestamp)`,
          );
          passedCheckForInsertion.push({
            licensePlate: resv.licensePlate,
            chargingStationId: chargStation.chargingStationId,
            startTimestamp: resv.startTimestamp,
            endTimestamp: resv.endTimestamp,
          });
        }
      }
      const reservationsToAddInsertionString =
        reservationsToAddInsertValues.length > 0
          ? `
                                INSERT INTO res_to_add (
                                        license_plate,
                                        charging_station_id,
                                        start_ts,
                                        end_ts
                                    )
                                VALUES ${
            reservationsToAddInsertValues.join(", ")
          };
                        `
          : "";

      const reservationsToRemoveInsertValues: string[] = [];
      for (const chargStation of reservationIdsToRemove) {
        for (const resv of chargStation.reservations) {
          if (
            DateTime.fromFormat(
              resv.startTimestamp,
              "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            ) < DateTime.now().minus({ seconds: latestPossibleReservationDeletion })
          ) {
            log(
              "INFO",
              "Timestamp of reservation to delete is too far in the past, reservation is not deleted",
            );
            log(
              "DEBUG",
              `Reservation for license plate: '${resv.licensePlate}', start timestamp: '${resv.startTimestamp}' < '${
                DateTime.now().minus({ seconds: latestPossibleReservationDeletion }).toFormat(
                  "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                )
              }' (now - ${latestPossibleReservationDeletion} seconds)`,
            );
            results.errors.push({
              licensePlate: resv.licensePlate,
              chargingStationId: chargStation.chargingStationId,
              startTimestamp: resv.startTimestamp,
              endTimestamp: resv.endTimestamp,
            });
            continue;
          }
          if (
            fleetMapping.map((e) => e.licensePlate).some((itm) =>
              itm === resv.licensePlate
            )
          ) {
            log(
              "INFO",
              "License plate does not belong to the company requesting, reservation is not added",
            );
            log(
              "DEBUG",
              `Reservation for license plate: '${resv.licensePlate}', start timestamp: '${resv.startTimestamp}' does not belong to company ID ${ctx.state.companyId}, company name: ${ctx.state.companyName}`,
            );
            results.errors.push({
              licensePlate: resv.licensePlate,
              chargingStationId: chargStation.chargingStationId,
              startTimestamp: resv.startTimestamp,
              endTimestamp: resv.endTimestamp,
            });
            continue;
          }
          reservationsToRemoveInsertValues.push(
            `('${resv.licensePlate}', '${chargStation.chargingStationId}'::uuid, '${resv.startTimestamp}'::timestamp, '${resv.endTimestamp}'::timestamp)`,
          );
          passedCheckForRemoval.push({
            licensePlate: resv.licensePlate,
            chargingStationId: chargStation.chargingStationId,
            startTimestamp: resv.startTimestamp,
            endTimestamp: resv.endTimestamp,
          });
        }
      }

      const reservationsToRemoveInsertionString =
        reservationsToRemoveInsertValues.length > 0
          ? `
                                INSERT INTO res_to_del (
                                        license_plate,
                                        charging_station_id,
                                        start_ts,
                                        end_ts
                                    )
                                VALUES ${
            reservationsToRemoveInsertValues.join(", ")
          };
                        `
          : "";

      log(
        "INFO",
        "Fetching reservation violation table",
      );
      log(
        "DEBUG",
        `Insertion string for reservations to be added: '${reservationsToAddInsertionString}'`,
      );
      log(
        "DEBUG",
        `Insertion string for reservations to be removed: '${reservationsToRemoveInsertionString}'`,
      );
      const reservationViolationCheck = await sqlConnection.queryObject<
        {
          chargingStationId: string;
          intervalTimestamp: string;
          reservationCount: number;
          maxReservationSpots: number;
          maxReservationsReached: boolean;
          maxReservationsExceeded: boolean;
        }
      >({
        text: `                 
                                DROP TABLE IF EXISTS res_to_add;
                                DROP TABLE IF EXISTS res_to_del;
                                CREATE TEMPORARY TABLE res_to_add (
                                    license_plate text,
                                    charging_station_id uuid,
                                    start_ts timestamp,
                                    end_ts timestamp,
                                    PRIMARY KEY (license_plate, start_ts),
                                    CHECK (start_ts < end_ts)
                                );
                                CREATE TEMPORARY TABLE res_to_del (
                                    license_plate text,
                                    charging_station_id uuid,
                                    start_ts timestamp,
                                    end_ts timestamp,
                                    PRIMARY KEY (license_plate, start_ts),
                                    CHECK (start_ts < end_ts)
                                );
                                ${reservationsToAddInsertionString}
                                ${reservationsToRemoveInsertionString}
                                WITH coalesced_res AS (
                                    SELECT COALESCE(radd.license_plate, res.license_plate) AS license_plate,
                                        COALESCE(radd.charging_station_id, res.charging_station_id) AS charging_station_id,
                                        COALESCE(radd.start_ts, res.start_ts) AS start_ts,
                                        COALESCE(radd.end_ts, res.end_ts) AS end_ts
                                    FROM masterthesis_schema.reservations AS res
                                        FULL JOIN res_to_add AS radd ON radd.license_plate = res.license_plate
                                        AND radd.start_ts = res.start_ts
                                    WHERE NOT EXISTS (
                                            SELECT 1
                                            FROM res_to_del AS rd
                                            WHERE rd.license_plate = res.license_plate
                                                AND rd.start_ts = res.start_ts
                                        )
                                ),
                                rv_count AS (
                                    SELECT DISTINCT ON (start_ts) charging_station_id,
                                        start_ts,
                                        (
                                            SELECT COUNT(1) AS rv_count
                                            FROM coalesced_res AS rv
                                            WHERE (
                                                    r.start_ts <= rv.start_ts
                                                    AND r.end_ts > rv.start_ts
                                                )
                                                OR (
                                                    r.start_ts >= rv.start_ts
                                                    AND r.end_ts <= rv.end_ts
                                                )
                                                AND r.charging_station_id = rv.charging_station_id
                                                AND r.license_plate != rv.license_plate
                                        ) AS reservation_count
                                    FROM masterthesis_schema.reservations AS r
                                    UNION ALL
                                    SELECT DISTINCT ON (end_ts) charging_station_id,
                                        end_ts,
                                        (
                                            SELECT COUNT(1) AS rv_count
                                            FROM masterthesis_schema.reservations AS rv
                                            WHERE r.end_ts > rv.start_ts
                                                AND rv.end_ts > r.end_ts
                                                AND r.charging_station_id = rv.charging_station_id
                                        ) AS reservation_count
                                    FROM masterthesis_schema.reservations AS r
                                )
                                SELECT DISTINCT ON (start_ts) rc.charging_station_id,
                                    start_ts AS interval_timestamp,
                                    reservation_count,
                                    max_reservation_spots,
                                    CASE
                                        WHEN rc.reservation_count >= max_reservation_spots THEN TRUE
                                        ELSE FALSE
                                    END AS max_reservations_reached,
                                    CASE
                                        WHEN rc.reservation_count > max_reservation_spots THEN TRUE
                                        ELSE FALSE
                                    END AS max_reservations_exceeded
                                FROM rv_count AS rc
                                    LEFT JOIN masterthesis_schema.charging_stations AS cl ON cl.charging_station_id = rc.charging_station_id;
                        `,
        fields: [
          "chargingStationId",
          "intervalTimestamp",
          "reservationCount",
          "maxReservationSpots",
          "maxReservationsReached",
          "maxReservationsExceeded",
        ],
      }).then((itm) => itm.rows);

      for (const timestampCheck of reservationViolationCheck) {
        if (timestampCheck.maxReservationsExceeded) {
          returnConflict(
            "Reservations exceed maximum reservation spots for at least one charging station",
            `Potential reservation count: ${timestampCheck.reservationCount}, max reservation spots: ${timestampCheck.maxReservationSpots} at timestamp: ${timestampCheck.intervalTimestamp} for charging station ID: ${timestampCheck.chargingStationId}`,
            `The given reservation changes results in exceeding the maximum allowed reservation for the charging station: ${timestampCheck.chargingStationId}`,
          );
        }
      }
    } catch (err) {
      log(
        "ERROR",
        `Error when trying to fetch the reservation violation table for: ${err}`,
      );
      return new Response(`Internal Server Error: ${err}`, {
        status: STATUS_CODE.InternalServerError,
      });
    }

    for (const e of passedCheckForInsertion) {
      try {
        log(
          "INFO",
          "Starting upsertion of updates for reservations.",
        );
        log("DEBUG", `Insert values: '${JSON.stringify(e)}'`);

        const resultRows = await sqlConnection.queryObject<
          ReservationDB
        >({
          text: `
                            INSERT INTO masterthesis_schema.reservations (license_plate, charging_station_id, start_ts, end_ts)
                            VALUES ('${e.licensePlate}', '${e.chargingStationId}'::uuid, '${e.startTimestamp}'::timestamp, '${e.endTimestamp}'::timestamp)
                            ON CONFLICT (license_plate, start_ts) DO UPDATE 
                            SET charging_station_id = EXCLUDED.charging_station_id::uuid , start_ts = EXCLUDED.start_ts::timestamp, end_ts = EXCLUDED.end_ts::timestamp
                            RETURNING license_plate, charging_station_id, start_ts, end_ts
                            ; 
                    `,
          fields: [
            "licensePlate",
            "chargingStationId",
            "startTimestamp",
            "endTimestamp",
          ],
        }).then((itm) => itm.rows);

        if (resultRows.length > 0) {
          results.success.push(resultRows[0]);
        } else {
          results.errors.push(
            {
              licensePlate: e.licensePlate,
              chargingStationId: e.chargingStationId,
              startTimestamp: e.startTimestamp,
              endTimestamp: e.endTimestamp,
            },
          );
        }
      } catch (err) {
        const thrownError = err as Error;
        log(
          "ERROR",
          `Error when upserting reservations: '${thrownError.message}'`,
        );
        log(
          "DEBUG",
          `Could not set: ('${e.licensePlate}', '${e.chargingStationId}'::uuid, '${e.startTimestamp}'::timestamp, '${e.endTimestamp}'::timestamp) with cause: '${thrownError.cause}'`,
        );
        results.errors.push({
          licensePlate: e.licensePlate,
          chargingStationId: e.chargingStationId,
          startTimestamp: e.startTimestamp,
          endTimestamp: e.endTimestamp,
        });
      }
    }
    for (const e of passedCheckForRemoval) {
      try {
        log(
          "INFO",
          "Starting deletion of reservations.",
        );
        log("DEBUG", `Delete values: '${JSON.stringify(e)}'`);

        await sqlConnection.queryObject<
          ReservationDB
        >({
          text: `
                            DELETE FROM masterthesis_schema.reservations
                            WHERE license_plate = '${e.licensePlate}' AND charging_station_id = '${e.chargingStationId}'::uuid AND start_ts = '${e.startTimestamp}'::timestamp
                            ; 
                    `,
          fields: [
            "licensePlate",
            "chargingStationId",
            "startTimestamp",
            "endTimestamp",
          ],
        });

        results.success.push({
          licensePlate: e.licensePlate,
          chargingStationId: e.chargingStationId,
          startTimestamp: e.startTimestamp,
          endTimestamp: e.endTimestamp,
        });
      } catch (err) {
        const thrownError = err as Error;
        log(
          "ERROR",
          `Error when deleting reservations: '${thrownError.message}'`,
        );
        log(
          "DEBUG",
          `Could not delete: ('${e.licensePlate}', '${e.chargingStationId}'::uuid, '${e.startTimestamp}'::timestamp, '${e.endTimestamp}'::timestamp) with cause: '${thrownError.cause}'`,
        );
        results.errors.push({
          licensePlate: e.licensePlate,
          chargingStationId: e.chargingStationId,
          startTimestamp: e.startTimestamp,
          endTimestamp: e.endTimestamp,
        });
      }
    }
    sqlConnection.release();
    log(
      "INFO",
      "Releasing SQL connection from /api/private/shared/reservations",
    );
    return new Response(JSON.stringify(results), {
      status: STATUS_CODE.OK,
      headers: { "Content-Type": "application/json" },
    });
  },
};
