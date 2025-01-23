import { FreshContext, Handlers, STATUS_CODE } from "$fresh/server.ts";
import { sqlPool } from "../../../../fresh.config.ts";
import log from "../../../../libs/logs.ts";
// import { DateTime } from "https://deno.land/x/ts_luxon@5.0.6-4/src/datetime.ts";
// import { Duration } from "https://deno.land/x/ts_luxon@5.0.6-4/src/duration.ts";
import { returnConflict } from "../../../../libs/conflictResponse.ts";

type ContextState = {
  companyId: string;
  companyName: string;
  isAdmin: boolean;
};

type AuctionRequest = {
  licensePlate: string;
  chargingStationId: string;
  maxAmount?: number;
  autoAccept?: boolean;
  auctionId?: string;
  remove?: boolean;
  startTimestamp?: string;
  endTimestamp?: string;
};

type Auction = {
  auctionId: string;
  chargingStationId: string;
  auctionStartTimestamp: string;
  auctionEndTimestamp: string;
  companyId: string;
  licensePlate: string;
  maxAcceptedPrice: number;
  autoAccept: boolean;
  auctionType: string;
  winningPrice: number;
  auctionFinished: boolean;
};

type GroupedAuctions = {
  chargingStationId: string;
  auctions: Auction[];
};

type AuctionOutput = {
  chargingStations: GroupedAuctions[];
};

function sqlResultToGetResponse(
  output: AuctionOutput,
): Response {
  return new Response(JSON.stringify(output), {
    status: STATUS_CODE.OK,
    headers: { "Content-Type": "application/json" },
  });
}

export const handler: Handlers<Request, ContextState> = {
  async GET(_req, ctx: FreshContext<ContextState>) {
    log("INFO", "/shared/auctions GET request received");

    const sqlConnection = await sqlPool.connect();

    try {
      const groupedAuctionsOutput: GroupedAuctions[] = [];

      const resultRows: Auction[] = [];

      const companyFilter = ctx.state.isAdmin
        ? ""
        : `AND company_id = '${ctx.state.companyId}'::uuid`;

      log(
        "INFO",
        `Start procedure for fetching all auctions`,
      );
      await sqlConnection.queryObject<
        Auction
      >({
        text: `
                            SELECT 
                              auction_id,
                              charging_station_id, 
                              company_id,
                              license_plate,
                              auction_start_ts,
                              auction_end_ts,
                              max_accepted_price,
                              auto_accept,
                              winning_price,
                              auction_type
                            FROM masterthesis_schema.auctions
                            WHERE auction_end_ts >= CURRENT_TIMESTAMP
                            ${companyFilter}
                            ;
                    `,
        fields: [
          "auctionId",
          "chargingStationId",
          "companyId",
          "licensePlate",
          "auctionStartTimestamp",
          "auctionEndTimestamp",
          "maxAcceptedPrice",
          "autoAccept",
          "winningPrice",
          "auctionType",
        ],
      }).then((itm) => resultRows.push(...itm.rows));
      resultRows.forEach((e) => {
        const foundIdx = groupedAuctionsOutput.findIndex((itm) =>
          itm?.chargingStationId === e.chargingStationId
        );
        if (foundIdx == -1) {
          groupedAuctionsOutput.push({
            chargingStationId: e.chargingStationId,
            auctions: [{
              auctionId: e.auctionId,
              chargingStationId: e.chargingStationId,
              companyId: e.companyId,
              licensePlate: e.licensePlate,
              auctionStartTimestamp: e.auctionStartTimestamp,
              auctionEndTimestamp: e.auctionEndTimestamp,
              maxAcceptedPrice: e.maxAcceptedPrice,
              autoAccept: e.autoAccept,
              auctionType: e.auctionType,
              winningPrice: e.winningPrice,
              auctionFinished: e.auctionFinished,
            }],
          });
        } else {
          groupedAuctionsOutput[foundIdx].auctions.push({
            auctionId: e.auctionId,
            chargingStationId: e.chargingStationId,
            companyId: e.companyId,
            licensePlate: e.licensePlate,
            auctionStartTimestamp: e.auctionStartTimestamp,
            auctionEndTimestamp: e.auctionEndTimestamp,
            maxAcceptedPrice: e.maxAcceptedPrice,
            autoAccept: e.autoAccept,
            auctionType: e.auctionType,
            winningPrice: e.winningPrice,
            auctionFinished: e.auctionFinished,
          });
        }
      });
      return sqlResultToGetResponse({
        chargingStations: groupedAuctionsOutput,
      });
    } catch (err) {
      const thrownError = err as Error;
      log("ERROR", `Auctions fetch error: '${thrownError}'`);
      if (thrownError.cause) {
        log("DEBUG", `Fail cause: '${thrownError.cause}'`);
      }
      return new Response(
        "Internal Server Error: Could not fetch auctions.",
        {
          status: STATUS_CODE.InternalServerError,
        },
      );
    } finally {
      sqlConnection.release();
      log(
        "INFO",
        "Releasing SQL connection from /api/private/shared/auctions",
      );
    }
  },

  async POST(req, ctx: FreshContext<ContextState>) {
    const reqObj = (await req.json()) as AuctionRequest;

    // const earliestPossibleReservation = Number.parseFloat(Deno.env.get('RESERVATION_EARLIEST_POSSIBLE') ?? '0');

    log("INFO", "/shared/auctions POST request received");
    log("DEBUG", `Request: ${JSON.stringify(reqObj)}`);

    const auctionReservationCheckInterval = Deno.env.get(
      "AUCTION_RESERVATION_CHECK",
    );
    const maximumAuctionDuration = Deno.env.get("AUCTION_MAXIMUM_DURATION");

    const sqlConnection = await sqlPool.connect();
    if (reqObj?.remove) {
      log("INFO", "Removing auction");
      log("DEBUG", `Removing auction with id: ${reqObj.auctionId})}`);
      try {
        const companyFilter = ctx.state.isAdmin
          ? ""
          : `AND company_id = '${ctx.state.companyId}'::uuid`;
        const deletedAuctions = await sqlConnection.queryObject<
          {
            auctionId: string;
            chargingStationId: string;
          }
        >({
          text: `       WITH auction_to_remove AS (
                        SELECT *
                        FROM masterthesis_schema.auctions
                        WHERE auction_id = '${reqObj.auctionId}'::uuid
                        ${companyFilter}
                      )
                      DELETE FROM masterthesis_schema.auctions
                        USING auction_to_remove AS atr
                        WHERE auction_id = atr.auction_id
                        RETURNING auction_id, charging_station_id, license_plate
              `,
          fields: [
            "auctionId",
            "chargingStationId",
            "licensePlate",
          ],
        }).then((itm) => itm.rows);
        if (deletedAuctions.length > 0) {
          log("INFO", "Successfully deleted auction");
          const deletedAuction = deletedAuctions[0];

          return new Response(
            JSON.stringify({ removedAuctions: [deletedAuction] }),
            {
              status: STATUS_CODE.OK,
              headers: { "Content-Type": "application/json" },
            },
          );
        } else {
          log("ERROR", "Unsuccessful deletion attempt of auction");
          log(
            "DEBUG",
            `Deletion attempt for auction ID: ${reqObj.auctionId})}`,
          );
          return new Response(
            "Check if you sent an auction ID you really have access to",
            {
              status: STATUS_CODE.Unauthorized,
            },
          );
        }
      } catch (err) {
        log(
          "ERROR",
          `Error when trying to delete the auction ID '${reqObj.auctionId}': ${err}`,
        );
        return new Response(`Internal Server Error: ${err}`, {
          status: STATUS_CODE.InternalServerError,
        });
      }
    }

    try {
      log("INFO", "Checking if there are really no available spots");
      const availableSpotsCheck = await sqlConnection.queryObject<
        {
          auctionId: string;
          chargingStationId: string;
          licensePlate: string;
        }
      >({
        text: `
                    SELECT *
                    FROM masterthesis_schema.v_available_spots
                    WHERE charging_station_id = '${reqObj.chargingStationId}'
            `,
        fields: [
          "chargingLstationId",
          "chargerId",
        ],
      }).then((itm) => itm.rows);

      if (availableSpotsCheck.length > 0) {
        log("INFO", "Available spot check returned available spots");
        log(
          "DEBUG",
          `Available spot found: '${JSON.stringify(availableSpotsCheck)}'`,
        );
        return returnConflict(
          "Available spot were checked before starting auction: There were still some available spots ready",
          `Available spots: ${JSON.stringify(availableSpotsCheck)}`,
          "There are available spots, no auctions will be started",
        );
      }
    } catch (err) {
      log(
        "ERROR",
        `Error when trying to fetch the available spots: ${err}`,
      );
      return new Response(`Internal Server Error: ${err}`, {
        status: STATUS_CODE.InternalServerError,
      });
    }

    if (!reqObj?.startTimestamp) {
      try {
        log(
          "INFO",
          "No start timestamp in request, starting spot auction procedure",
        );
        const auctionUUID = crypto.randomUUID();
        const startedSpotAuctions = await sqlConnection.queryObject<
          Auction
        >({
          text: `     
                      DROP TABLE IF EXISTS sessions_to_insert;
                      CREATE TEMPORARY TABLE sessions_to_insert (
                          company_id uuid,
                          charging_station_id uuid,
                          charger_id uuid
                      );
                      WITH count_res AS (
                          SELECT 
                              r.charging_station_id,
                              LEAST(COUNT(*), cl.max_reservation_spots) AS future_rsv_count,
                              total_charging_spots
                          FROM masterthesis_schema.reservations AS r
                              LEFT JOIN masterthesis_schema.charging_stations AS cl ON cl.charging_station_id = r.charging_station_id
                          WHERE start_ts BETWEEN CURRENT_TIMESTAMP
                              AND (CURRENT_TIMESTAMP + INTERVAL '${auctionReservationCheckInterval} seconds')
                              AND r.charging_station_id = '${reqObj.chargingStationId}'
                          GROUP BY r.charging_station_id,
                              cl.max_reservation_spots,
                              cl.total_charging_spots
                      ),
                      charger_order AS (
                          SELECT 
                              f.company_id,
                              cf.charging_station_id,
                              charger_id,
                              spot_assignment_ts,
                              start_charge_ts,
                              ROW_NUMBER() OVER (
                                  ORDER BY COALESCE(start_charge_ts, spot_assignment_ts)
                              ) AS spot_order,
                              COALESCE(future_rsv_count, 0) AS future_rsv_count
                          FROM masterthesis_schema.charging_flows AS cf
                              LEFT JOIN count_res AS cr ON cr.charging_station_id = cf.charging_station_id
                              LEFT JOIN masterthesis_schema.fleets AS f ON f.license_plate = cf.license_plate
                          WHERE cf.charging_station_id = '${reqObj.chargingStationId}'
                            AND f.company_id != '${ctx.state.companyId}'
                      ),
                      filtered_insertions AS (
                          SELECT *
                          FROM charger_order
                          WHERE spot_order > future_rsv_count
                      )
                      INSERT INTO sessions_to_insert
                      SELECT 
                          company_id,
                          charging_station_id,
                          charger_id
                      FROM filtered_insertions;
                      WITH auction_insert_prep AS (
                          SELECT DISTINCT ON (charging_station_id)
                              '${auctionUUID}'::uuid,
                              charging_station_id,
                              '${ctx.state.companyId}'::uuid,
                              '${reqObj.licensePlate}',
                              CURRENT_TIMESTAMP,
                              CURRENT_TIMESTAMP + INTERVAL '${maximumAuctionDuration} seconds',
                              ${reqObj.maxAmount ?? null},
                              ${reqObj.autoAccept ?? null},
                              'SPOT'::auction_type,
                              NULL::numeric,
                              FALSE
                          FROM sessions_to_insert
                      )
                      INSERT INTO masterthesis_schema.auctions
                      SELECT *
                      FROM auction_insert_prep
                      RETURNING 
                        auction_id,
                        charging_station_id,
                        company_id,
                        license_plate,
                        auction_start_ts,
                        auction_end_ts, 
                        max_accepted_price,
                        auto_accept,
                        auction_type,
                        winning_price, 
                        auction_finished;
                      INSERT INTO masterthesis_schema.spot_auction_offers (auction_id, company_id, charger_id)
                      SELECT 
                          '${auctionUUID}'::uuid,
                          company_id,
                          charger_id
                      FROM sessions_to_insert;
                      DROP TABLE sessions_to_insert;
              `,
          fields: [
            "auctionId",
            "chargingStationId",
            "companyId",
            "licensePlate",
            "auctionStartTimestamp",
            "auctionEndTimestamp",
            "maxAcceptedPrice",
            "autoAccept",
            "auctionType",
            "winningPrice",
            "auctionFinished",
          ],
        }).then((itm) => itm.rows);

        if (startedSpotAuctions?.length > 0) {
          log("INFO", "Successfully started spot auction");
          log(
            "DEBUG",
            `DB Insertion return: ${JSON.stringify(startedSpotAuctions)}`,
          );

          const startedSpotAuction = startedSpotAuctions[0];

          return new Response(JSON.stringify(startedSpotAuction), {
            status: STATUS_CODE.OK,
            headers: { "Content-Type": "application/json" },
          });
        } else {
          return returnConflict(
            "No auction for spots could be started",
            `Auction request object: ${JSON.stringify(reqObj)}`,
            "No auction for spots was started, please check your input.",
          );
        }
      } catch (err) {
        log(
          "ERROR",
          `Error when trying to start spot auction for (charging station ID: '${reqObj.chargingStationId}', license plate: '${reqObj.licensePlate}'): ${err}`,
        );
        return new Response(`Internal Server Error: ${err}`, {
          status: STATUS_CODE.InternalServerError,
        });
      }
    } // functionality for buffer interval constraint for reservation auctions, if needed - however, this then restricts
    // users from using the reservation auction to still get a reservation in urgent cases (scenario 3 in thesis)

    // else if (
    //   DateTime.fromFormat(
    //     reqObj?.startTimestamp,
    //     "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
    //   ) > DateTime.now().plus({ seconds: RESERVATION_EARLIEST_POSSIBLE })
    // ) {
    //   try {
    //     log(
    //       "INFO",
    //       `Start timestamp provided in request (start timestamp > now + ${Duration.fromObject({seconds:maximumReservationDuration}).toFormat('mm:ss')}) - Starting reservation auction procedure`,
    //     );
    //     const auctionUUID = crypto.randomUUID();

    //     const startedReservationAuctions = await sqlConnection.queryObject<
    //       Auction
    //     >({
    //       text: `
    //                 DROP TABLE IF EXISTS reservations_to_auction;
    //                 CREATE TEMPORARY TABLE reservations_to_auction (
    //                     license_plate text,
    //                     charging_station_id uuid,
    //                     start_ts timestamp,
    //                     end_ts timestamp
    //                 );
    //                 WITH res_to_auction AS (
    //                     SELECT *
    //                     FROM masterthesis_schema.reservations
    //                     WHERE start_ts <= '${reqObj.startTimestamp}'::timestamp
    //                         AND end_ts <= '${reqObj.endTimestamp}'::timestamp
    //                         AND charging_station_id = '${reqObj.chargingStationId}'
    //                 )
    //                 INSERT INTO reservations_to_auction
    //                 SELECT license_plate,
    //                     charging_station_id,
    //                     start_ts,
    //                     end_ts
    //                 FROM res_to_auction;
    //                 WITH auction_insert_prep AS(
    //                     SELECT DISTINCT ON (charging_station_id) '${auctionUUID}'::uuid AS auction_id,
    //                         charging_station_id,
    //                         '${ctx.state.companyId}'::uuid AS company_id,
    //                         '${reqObj.licensePlate}' AS license_plate,
    //                         CURRENT_TIMESTAMP AS auction_start_ts,
    //                         CURRENT_TIMESTAMP + INTERVAL '${maximumAuctionDuration} seconds' AS auction_end_ts,
    //                         ${reqObj.maxAmount ?? null} AS max_accepted_price,
    //                         ${reqObj.autoAccept ?? false} AS auto_accept,
    //                         'RESERVATION',
    //                         NULL::numeric,
    //                         FALSE
    //                     FROM reservations_to_auction
    //                 )
    //                 INSERT INTO masterthesis_schema.auctions
    //                 SELECT *
    //                 FROM auction_insert_prep
    //                 RETURNING auction_id,
    //                     charging_station_id,
    //                     company_id,
    //                     license_plate,
    //                     auction_start_ts,
    //                     auction_end_ts,
    //                     max_accepted_price,
    //                     auto_accept,
    //                     auction_type,
    //                     auction_finished;
    //                 WITH auction_offer_insert_prep AS (
    //                     SELECT '${auctionUUID}'::uuid,
    //                         charging_station_id,
    //                         '${ctx.state.companyId}'::uuid,
    //                         license_plate,
    //                         start_ts,
    //                         end_ts
    //                     FROM reservations_to_auction
    //                 )
    //                 INSERT INTO masterthesis_schema.reservation_auction_offers (
    //                         auction_id,
    //                         charging_station_id,
    //                         company_id,
    //                         license_plate,
    //                         start_ts,
    //                         end_ts
    //                     )
    //                 SELECT *
    //                 FROM auction_offer_insert_prep
    //                 ;
    //         `,
    //       fields: [
    //         "auctionId",
    //         "chargingStationId",
    //         "companyId",
    //         "licensePlate",
    //         "auctionStartTimestamp",
    //         "auctionEndTimestamp",
    //         "maxAcceptedPrice",
    //         "autoAccept",
    //         "auctionType",
    //         "winningPrice",
    //         "auctionFinished",
    //       ],
    //     }).then((itm) => itm.rows);

    //     if (startedReservationAuctions?.length > 0) {
    //       const startedReservationAuction = startedReservationAuctions[0];

    //       log("INFO", "Successfully started reservation auction");
    //       log(
    //         "DEBUG",
    //         `DB Insertion return: ${JSON.stringify(startedReservationAuction)}`,
    //       );

    //       return new Response(JSON.stringify(startedReservationAuction), {
    //         status: STATUS_CODE.OK,
    //         headers: { "Content-Type": "application/json" },
    //       });
    //     } else {
    //       return returnConflict(
    //         "No auction for reservation could be started",
    //         `Auction request object: ${JSON.stringify(reqObj)}`,
    //         "No auction for spots was started, please check your input.",
    //       );
    //     }
    //   } catch (err) {
    //     log(
    //       "ERROR",
    //       `Error when trying to start reservation auction for (charging station ID: '${reqObj.chargingStationId}', license plate: '${reqObj.licensePlate}', start timestamp: '${reqObj.startTimestamp}'): ${err}`,
    //     );
    //     return new Response(`Internal Server Error: ${err}`, {
    //       status: STATUS_CODE.InternalServerError,
    //     });
    //   }
    // } else {
    //   return returnConflict(
    //     "No auction started as the reservation timestamp is not later than the required buffer interval (1 hour)",
    //     `The timestamp sent is: '${reqObj?.startTimestamp}', the earliest possible start timestamp would to be > '${
    //       DateTime.now().plus({ hour: 1 }).toFormat(
    //         "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
    //       )
    //     }'`,
    //     `No auction started as the reservation timestamp is not later than the required buffer interval (1 hour), earliest possible start timestamp woulde be '${
    //       DateTime.now().plus({ hour: 1 }).toFormat(
    //         "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
    //       )
    //     }'`,
    //   );
    // }
    else {
      try {
        log(
          "INFO",
          "Start timestamp provided in request (start timestamp > now + 1 hour) - Starting reservation auction procedure",
        );
        const auctionUUID = crypto.randomUUID();

        const startedReservationAuctions = await sqlConnection.queryObject<
          Auction
        >({
          text: `
                    DROP TABLE IF EXISTS reservations_to_auction;
                    CREATE TEMPORARY TABLE reservations_to_auction (
                        license_plate text,
                        charging_station_id uuid,
                        start_ts timestamp,
                        end_ts timestamp
                    );
                    WITH res_to_auction AS (
                        SELECT *
                        FROM masterthesis_schema.reservations
                        WHERE start_ts <= '${reqObj.startTimestamp}'::timestamp
                            AND end_ts <= '${reqObj.endTimestamp}'::timestamp
                            AND charging_station_id = '${reqObj.chargingStationId}'
                    )
                    INSERT INTO reservations_to_auction
                    SELECT license_plate,
                        charging_station_id,
                        start_ts,
                        end_ts
                    FROM res_to_auction;
                    WITH auction_insert_prep AS(
                        SELECT DISTINCT ON (charging_station_id) '${auctionUUID}'::uuid AS auction_id,
                            charging_station_id,
                            '${ctx.state.companyId}'::uuid AS company_id,
                            '${reqObj.licensePlate}' AS license_plate,
                            CURRENT_TIMESTAMP AS auction_start_ts,
                            CURRENT_TIMESTAMP + INTERVAL '${maximumAuctionDuration} seconds' AS auction_end_ts,
                            ${reqObj.maxAmount ?? null} AS max_accepted_price,
                            ${reqObj.autoAccept ?? false} AS auto_accept,
                            'RESERVATION'::auction_type,
                            NULL::numeric,
                            FALSE
                        FROM reservations_to_auction
                    )
                    INSERT INTO masterthesis_schema.auctions
                    SELECT *
                    FROM auction_insert_prep
                    RETURNING auction_id,
                        charging_station_id,
                        company_id,
                        license_plate,
                        auction_start_ts,
                        auction_end_ts,
                        max_accepted_price,
                        auto_accept,
                        auction_type,
                        winning_price,
                        auction_finished;
                    WITH auction_offer_insert_prep AS (
                        SELECT '${auctionUUID}'::uuid,
                            charging_station_id,
                            '${ctx.state.companyId}'::uuid,
                            license_plate,
                            start_ts,
                            end_ts
                        FROM reservations_to_auction
                    )
                    INSERT INTO masterthesis_schema.reservation_auction_offers (
                            auction_id,
                            charging_station_id,
                            company_id,
                            license_plate,
                            start_ts,
                            end_ts
                        )
                    SELECT *
                    FROM auction_offer_insert_prep
                    ;
            `,
          fields: [
            "auctionId",
            "chargingStationId",
            "companyId",
            "licensePlate",
            "auctionStartTimestamp",
            "auctionEndTimestamp",
            "maxAcceptedPrice",
            "autoAccept",
            "auctionType",
            "winningPrice",
            "auctionFinished",
          ],
        }).then((itm) => itm.rows);

        if (startedReservationAuctions?.length > 0) {
          const startedReservationAuction = startedReservationAuctions[0];

          log("INFO", "Successfully started reservation auction");
          log(
            "DEBUG",
            `DB Insertion return: ${JSON.stringify(startedReservationAuction)}`,
          );

          return new Response(JSON.stringify(startedReservationAuction), {
            status: STATUS_CODE.OK,
            headers: { "Content-Type": "application/json" },
          });
        } else {
          return returnConflict(
            "No auction for reservation could be started",
            `Auction request object: ${JSON.stringify(reqObj)}`,
            "No auction for spots was started, please check your input.",
          );
        }
      } catch (err) {
        log(
          "ERROR",
          `Error when trying to start reservation auction for (charging station ID: '${reqObj.chargingStationId}', license plate: '${reqObj.licensePlate}', start timestamp: '${reqObj.startTimestamp}'): ${err}`,
        );
        return new Response(`Internal Server Error: ${err}`, {
          status: STATUS_CODE.InternalServerError,
        });
      }
    }
  },
};
