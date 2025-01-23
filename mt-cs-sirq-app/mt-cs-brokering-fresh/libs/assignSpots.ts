import type { PoolClient } from "https://deno.land/x/postgres@v0.19.3/client.ts";
import log from "./logs.ts";

type InsertionResults = {
  sessionId: string;
  endChargeTimestamp?: string;
  spotAssignmentTimestamp?: string;
  chargerId: string;
  chargingStationId: string;
};

export default async function assignChargingSpots(
  // chargingStationId: string,
  sqlConnection: PoolClient,
) {

  const reservationEarlyArrivalSlackInterval = Deno.env.get('RESERVATION_EARLY_ARRIVAL_SLACK');
  const reservationLateArrivalSlackInterval = Deno.env.get('RESERVATION_LATE_ARRIVAL_SLACK');

  const result: { insertions: InsertionResults[] } = { insertions: [] };
  try {
    log(
      "INFO",
      `Checking for spots to be assigned to a corresponding spot assignment lock`,
    );
    const spotAssignLockTransaction = sqlConnection.createTransaction(
      "spot_assign_lock",
    );
    await spotAssignLockTransaction.begin();
    const endAuctionsWinnerChargingFlowResult = await spotAssignLockTransaction
      .queryObject<
        {
          sessionId: string;
          endChargeTimestamp: string;
          chargerId: string;
          chargingStationId: string;
        }
      >({
        text: `   
                  DROP TABLE IF EXISTS update_data;        
                  CREATE TEMPORARY TABLE update_data(
                      session_id_new uuid,
                      session_id_old uuid,
                      charger_id uuid
                  );
                  WITH just_arrived_flows_with_lock AS (
                      SELECT session_id,
                          sal.charger_id
                      FROM masterthesis_schema.charging_flows AS cf
                          JOIN masterthesis_schema.spot_assign_locks AS sal ON cf.license_plate = sal.license_plate
                      WHERE arrival_ts IS NOT NULL
                          AND spot_assignment_ts IS NULL
                          AND departure_ts IS NULL
                          AND cf.charger_id IS NULL
                  ),
                  charging_locks AS (
                      SELECT charger_id
                      FROM masterthesis_schema.spot_assign_locks
                      WHERE CURRENT_TIMESTAMP BETWEEN lock_start_ts AND lock_end_ts
                  ),
                  currently_charging_with_lock AS (
                      SELECT session_id,
                          cf.charger_id
                      FROM masterthesis_schema.charging_flows AS cf
                          JOIN charging_locks AS cl ON cl.charger_id = cf.charger_id
                      WHERE start_charge_ts IS NOT NULL
                          AND end_charge_ts IS NULL
                  ),
                  to_update AS (
                      SELECT jafwl.session_id AS session_id_new,
                          ccwl.session_id AS session_id_old,
                          ccwl.charger_id
                      FROM just_arrived_flows_with_lock AS jafwl
                          JOIN currently_charging_with_lock AS ccwl ON ccwl.charger_id = jafwl.charger_id
                  )
                  INSERT INTO update_data
                  SELECT *
                  FROM to_update;
                  UPDATE masterthesis_schema.charging_flows AS cf
                  SET end_charge_ts = CURRENT_TIMESTAMP
                  FROM update_data AS ud
                  WHERE session_id = ud.session_id_old
                  RETURNING session_id,
                      end_charge_ts,
                      cf.charger_id,
                      charging_station_id
                  ;
          `,
        fields: [
          "sessionId",
          "endChargeTimestamp",
          "chargerId",
          "chargingStationId",
        ],
      }).then((itm) => itm.rows);

    result.insertions.push(...endAuctionsWinnerChargingFlowResult);

    const startAuctionOwnerChargingFlowResult = await spotAssignLockTransaction
      .queryObject<
        {
          sessionId: string;
          // endChargeTimestamp: string;
          chargerId: string;
          chargingStationId: string;
          spotAssignmentTimestamp: string;
        }
      >({
        text: `           
                  UPDATE masterthesis_schema.charging_flows AS cf
                  SET spot_assignment_ts = CURRENT_TIMESTAMP,
                      charger_id = ud.charger_id
                  FROM update_data AS ud
                  WHERE session_id = ud.session_id_new
                  RETURNING session_id,
                      cf.charger_id,
                      charging_station_id,
                      spot_assignment_ts
                  ;
                  DROP TABLE update_data;
          `,
        fields: [
          "sessionId",
          // "endChargeTimestamp",
          "chargerId",
          "chargingStationId",
          "spotAssignmentTimestamp"
        ],
      }).then((itm) => itm.rows);
    await spotAssignLockTransaction.commit();

    result.insertions.push(...startAuctionOwnerChargingFlowResult);

    if (endAuctionsWinnerChargingFlowResult.length < 1) {
      log(
        "INFO",
        `No charging flow ended (set charging_end_ts) for any auction winner`,
      );
    }
    else{
      log(
        "INFO",
        `Charging flow ended (set charging_end_ts): ${JSON.stringify(endAuctionsWinnerChargingFlowResult)}`,
      );
    }

    if (endAuctionsWinnerChargingFlowResult.length < 1) {
      log(
        "INFO",
        `No charging flow started (assign spot) for an auction owner which has arrived`,
      );
    }

    if (
      startAuctionOwnerChargingFlowResult.length > 0 &&
      endAuctionsWinnerChargingFlowResult.length > 0
    ) {
      log(
        "INFO",
        `Spot assignment for spots with assignment lock successfully completed`,
      );
      log(
        "DEBUG",
        `New assigned spots for spots with assignment lock: ${
          JSON.stringify(result)
        }`,
      );
    } else {
      log("INFO", "No spots were assigned for spots with assignment lock");
    }
  } catch (err) {
    const thrownError = err as Error;
    log(
      "ERROR",
      "Could not assign assign charging spots with an assignment lock",
    );
    log(
      "DEBUG",
      `Insertion of assigned charging spots with an assignment lock failed due to: '${thrownError.message}' with cause: '${thrownError.cause}'`,
    );
    return Promise.reject(
      "Could not assign assign charging spots with an assignment lock",
    );
  }

  try {
    log(
      "INFO",
      `Checking for spots to be assigned to a corresponding reservation`,
    );
    const resultLengthBeforeReservation = result.insertions.length;
    const reservationTransaction = sqlConnection.createTransaction(
      "reservation_privilege",
    );
    await reservationTransaction.begin();
    await reservationTransaction
      .queryObject<
        {
          sessionId: string;
          endChargeTimestamp: string;
          chargerId: string;
          chargingStationId: string;
        }
      >({
        text: `   
                  DROP TABLE IF EXISTS reservation_assignments;   
                  CREATE TEMPORARY TABLE reservation_assignments (
                      charging_station_id uuid,
                      session_id uuid,
                      charger_id uuid,
                      charging_session_to_end uuid
                  );
                  WITH open_reservations_sessions AS (
                      SELECT session_id,
                          cf.charging_station_id,
                          ROW_NUMBER() OVER (
                              ORDER BY arrival_ts
                          ) AS reservation_queue_position
                      FROM masterthesis_schema.charging_flows AS cf
                          JOIN masterthesis_schema.reservations AS r ON r.license_plate = cf.license_plate
                          AND r.charging_station_id = cf.charging_station_id
                      WHERE spot_assignment_ts IS NULL
                          AND start_charge_ts IS NULL
                          AND departure_ts IS NULL
                          AND (
                              r.start_ts - INTERVAL '${reservationEarlyArrivalSlackInterval} seconds' <= CURRENT_TIMESTAMP
                              OR r.start_ts + INTERVAL '${reservationLateArrivalSlackInterval} seconds' >= CURRENT_TIMESTAMP
                          )
                  ),
                  merge_spots AS (
                    SELECT *,
                        1 AS priority,
                        CAST(NULL AS uuid) AS charging_session_to_end
                    FROM masterthesis_schema.v_available_spots
                    UNION ALL
                    SELECT charging_station_id,
                        charger_id,
                        2,
                        CAST(NULL AS uuid) AS charging_session_to_end
                    FROM masterthesis_schema.chargers AS ch
                    WHERE NOT EXISTS(
                            SELECT 1
                            FROM masterthesis_schema.charging_flows AS cf
                            WHERE cf.charger_id = ch.charger_id
                                AND (
                                    cf.end_charge_ts IS NULL
                                    OR cf.departure_ts IS NULL
                                )
                        )
                        AND NOT EXISTS(
                            SELECT 1
                            FROM masterthesis_schema.v_available_spots AS vas
                            WHERE vas.charger_id = ch.charger_id
                        )
                    UNION ALL
                    SELECT charging_station_id,
                        charger_id,
                        3,
                        session_id AS charging_session_to_end
                    FROM masterthesis_schema.v_occupied_spots_for_reservations
                  ),
                  open_spots AS (
                      SELECT *,
                          ROW_NUMBER() OVER (
                              ORDER BY priority
                          ) AS charging_spot_order
                      FROM merge_spots
                  )
                  INSERT INTO reservation_assignments (
                          charging_station_id,
                          session_id,
                          charger_id,
                          charging_session_to_end
                      )
                  SELECT ors.charging_station_id,
                      ors.session_id,
                      os.charger_id,
                      os.charging_session_to_end
                  FROM open_reservations_sessions AS ors
                      LEFT JOIN open_spots AS os ON ors.reservation_queue_position = charging_spot_order;
                  UPDATE masterthesis_schema.charging_flows AS cf
                  SET end_charge_ts = CURRENT_TIMESTAMP
                  FROM reservation_assignments AS ra
                  WHERE cf.session_id = ra.charging_session_to_end
                  RETURNING cf.session_id, end_charge_ts, cf.charger_id, cf.charging_station_id
                  ;
          `,
        fields: [
          "sessionId",
          "endChargeTimestamp",
          "chargerId",
          "chargingStationId",
        ],
      }).then((itm) => {
        result.insertions.push(...itm.rows);
        if (itm.rows.length < 1) {
          log(
            "INFO",
            `No charging flow ended (set charging_end_ts) for someone blocking a reserved spot`,
          );
        }
        else{
          log(
            "INFO",
            `Ending charging flows for someone blocking a reserved spot successfully completed`,
          );
          log(
            "DEBUG",
            `Ended charging flow: ${JSON.stringify(itm.rows)}`,
          );
          // log("INFO", "No spots were assigned for reservation");
        }
      });

    

    await reservationTransaction.queryObject<
      {
        sessionId: string;
        spotAssignmentTimestamp: string;
        chargerId: string;
        chargingStationId: string;
      }
    >({
      text: `     
                  UPDATE masterthesis_schema.charging_flows AS cf
                  SET spot_assignment_ts = CURRENT_TIMESTAMP,
                      charger_id = ra.charger_id
                  FROM reservation_assignments AS ra
                  WHERE cf.session_id = ra.session_id
                  RETURNING cf.session_id, spot_assignment_ts, cf.charger_id, cf.charging_station_id
                  ;
                  DROP TABLE reservation_assignments;
          `,
      fields: [
        "sessionId",
        "spotAssignmentTimestamp",
        "chargerId",
        "chargingStationId",
      ],
    }).then((itm) => {
      result.insertions.push(...itm.rows);

    if (itm.rows.length < 1) {
      log(
        "INFO",
        `No charging flow started (assign spot) for a reservation`,
      );
    }
    else{
      log(
        "INFO",
        `Spot assignment for reservation successfully completed`,
      );
      log(
        "DEBUG",
        `Spot assignment: ${JSON.stringify(itm.rows)}`,
      );
    }
    });

    await reservationTransaction.commit();

    if (resultLengthBeforeReservation == result.insertions.length){
      log("INFO", "No spots were assigned for reservation");
    }

  } catch (err) {
    const thrownError = err as Error;
    log("ERROR", "Could not assign charging spot for reservations");
    log(
      "DEBUG",
      `Setting assigned charging spot for reservations failed due to: '${thrownError.message}' with cause: '${thrownError.cause}'`,
    );
  }

  const transaction = sqlConnection.createTransaction("spot_assignment");

  try {
    log(
      "INFO",
      "Assigning spots for all charging stations where there are available spots",
    );
    await transaction.begin();
    await transaction.queryObject<
      {
        sessionId: string;
        spotAssignmentTimestamp: string;
        chargerId: string;
        chargingStationId: string;
      }
    >({
      text: `
                  WITH av_spots AS (
                      SELECT charger_id,
                          charging_station_id,
                          row_number() over (
                              partition by charging_station_id
                              order by charger_id
                          ) AS charger_ordering
                      FROM masterthesis_schema.v_available_spots
                  ),
                  charger_matching AS (
                      SELECT *
                      FROM masterthesis_schema.v_queues AS vq
                          -- LEFT JOIN av_spots AS avs ON vq.charging_station_id = avs.charging_station_id
                          JOIN av_spots AS avs ON vq.charging_station_id = avs.charging_station_id
                          AND avs.charger_ordering = vq.queue_position
                  )
                  UPDATE masterthesis_schema.charging_flows AS cf
                  SET spot_assignment_ts = CURRENT_TIMESTAMP,
                      charger_id = cm.charger_id
                  FROM charger_matching AS cm
                  WHERE cf.session_id = cm.session_id
                  RETURNING 
                      cf.session_id,
                      spot_assignment_ts,
                      cf.charger_id,
                      cf.charging_station_id
                  ; 
          `,
      fields: [
        "sessionId",
        "spotAssignmentTimestamp",
        "chargerId",
        "chargingStationId",
      ],
    }).then((itm) => {
      result.insertions.push(...itm.rows);

      if (itm.rows.length > 0) {
        log(
          "INFO",
          `Spot assignment for non reservations successfully completed`,
        );
        log(
          "DEBUG",
          `New assigned spots for non reservations ${JSON.stringify(result)}`,
        );
      } else {
        log("INFO", "No spots were assigned for non reservations");
      }
      });
    await transaction.commit();

    await sqlConnection.queryObject<
      {
        executionTime: string;
        changes: string;
        cronJobType: string;
      }
    >({
      text: `
                INSERT INTO masterthesis_schema.jobs (execution_time, changes, job_type)
                VALUES (CURRENT_TIMESTAMP, '${
        JSON.stringify(result.insertions)
      }', 'SPOT_ASSIGNMENT')
                RETURNING execution_time, changes, job_type
                ;
        `,
      fields: [
        "executionTime",
        "changes",
        "cronJobType",
      ],
    }).then((itm) => itm.rows);

    log("INFO", "Successfully assigned spots");
    log(
      "DEBUG",
      `Assigned spots '${JSON.stringify(result.insertions)}'`,
    );

    return result;
  } catch (err) {
    const thrownError = err as Error;
    log("ERROR", "Could not assign charging spots");
    log(
      "DEBUG",
      `Insertion of assigned charging spots failed due to: '${thrownError.message}' with cause: '${thrownError.cause}'`,
    );
    return Promise.reject("Could not assign charging spots");
  }
}
