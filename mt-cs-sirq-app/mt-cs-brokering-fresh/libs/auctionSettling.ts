import { PoolClient } from "https://deno.land/x/postgres@v0.19.3/mod.ts";
import log from "./logs.ts";

export default async function settleAuctions(
  sqlConnection: PoolClient,
) {
  log("INFO", "Starting auction settling procedure");

  const auctionSpotAssignLockDuration = Deno.env.get('AUCTION_SPOT_ASSIGN_LOCK_DURATION');
  const minimalIntervalToChangeOffer = Deno.env.get('AUCTION_OFFER_MINIMUM_CHANGE_DURATION');

  const transaction = sqlConnection.createTransaction(
    "auction_settle_transaction",
  );

  try {
    await transaction.begin();

    const lockedSpots = await transaction.queryObject<
      {
        chargingStationId: string;
        chargerId: string;
        lockStartTimestamp: string;
        lockEndTimestamp: string;
      }
    >({
      text: `           
                    DROP TABLE IF EXISTS finish_auction;
                    DROP TABLE IF EXISTS winning_offer;
                    CREATE TEMPORARY TABLE finish_auction (auction_id uuid);
                    CREATE TEMPORARY TABLE winning_offer (
                        auction_id uuid,
                        charger_id uuid,
                        offer numeric
                    );
                    WITH spot_auctions AS (
                        SELECT DISTINCT auction_id
                        FROM masterthesis_schema.spot_auction_offers
                        WHERE offer IS NULL
                            OR (
                                offer IS NOT NULL
                                AND received_ts + INTERVAL '${minimalIntervalToChangeOffer} seconds' > CURRENT_TIMESTAMP
                            )
                    ),
                    auctions_to_finish AS (
                        SELECT DISTINCT a.auction_id
                        FROM masterthesis_schema.auctions AS a
                        WHERE auction_finished = FALSE
                            AND (
                                auction_end_ts < CURRENT_TIMESTAMP
                                OR (
                                    NOT EXISTS(
                                        SELECT 1
                                        FROM spot_auctions AS sa
                                        WHERE sa.auction_id = a.auction_id
                                    )
                                )
                            )
                    )
                    INSERT INTO finish_auction
                    SELECT *
                    FROM auctions_to_finish;
                    WITH ranking AS (
                        SELECT a.auction_id,
                            charger_id,
                            offer,
                            ROW_NUMBER() OVER (
                                PARTITION BY sao.auction_id
                                ORDER BY offer,
                                    received_ts NULLS LAST
                            ) AS auction_rank
                        FROM masterthesis_schema.spot_auction_offers AS sao
                            LEFT JOIN masterthesis_schema.auctions AS a ON sao.auction_id = a.auction_id
                        WHERE EXISTS(
                                SELECT 1
                                FROM finish_auction AS fa
                                WHERE sao.auction_id = fa.auction_id
                            )
                            AND offer IS NOT NULL
                            AND (
                                auto_accept = TRUE
                                OR offer <= max_accepted_price
                            )
                    )
                    INSERT INTO winning_offer
                    SELECT auction_id,
                        charger_id,
                        offer
                    FROM ranking
                    WHERE auction_rank = 1;
                    INSERT INTO masterthesis_schema.spot_assign_locks
                    SELECT a.charging_station_id,
                        charger_id,
                        a.license_plate,
                        CURRENT_TIMESTAMP,
                        CURRENT_TIMESTAMP + INTERVAL '${auctionSpotAssignLockDuration} seconds',
                        a.auction_id
                    FROM winning_offer AS wo
                        LEFT JOIN masterthesis_schema.auctions AS a ON a.auction_id = wo.auction_id
                    RETURNING charging_station_id,
                        charger_id,
                        lock_start_ts,
                        lock_end_ts;
            `,
      fields: [
        "chargingStationId",
        "chargerId",
        "lockStartTimestamp",
        "lockEndTimestamp",
      ],
    }).then((itm) => itm.rows);

    log(
      "DEBUG",
      `Successfully locked charging spots: ${JSON.stringify(lockedSpots)}`,
    );

    const closedSuccessfulSpotAuctions = await transaction.queryObject<
      {
        auctionId: string;
        auctionFinished: boolean;
        winningPrice: number;
      }
    >({
      text: `     
                    UPDATE masterthesis_schema.auctions AS a
                    SET winning_price = wo.offer,
                        auction_finished = TRUE
                    FROM winning_offer AS wo
                    WHERE a.auction_id = wo.auction_id
                    RETURNING a.auction_id,
                        auction_finished,
                        winning_price;

                    DROP TABLE finish_auction;
                    DROP TABLE winning_offer;
            `,
      fields: [
        "auctionId",
        "auctionFinished",
        "winningPrice",
      ],
    }).then((itm) => itm.rows);

    log(
      "DEBUG",
      `Successfully closed spot auctions with a winning price: ${
        JSON.stringify(closedSuccessfulSpotAuctions)
      }`,
    );

    const reservationChanges = await transaction.queryObject<
      {
        chargingStationId: string;
        chargerId: string;
        lockStartTimestamp: string;
        lockEndTimestamp: string;
      }
    >({
      text: `       DROP TABLE IF EXISTS finish_auction;
                    DROP TABLE IF EXISTS res_winning_offer;    
                    CREATE TEMPORARY TABLE finish_auction (auction_id uuid);
                    CREATE TEMPORARY TABLE res_winning_offer (
                        auction_id uuid,
                        license_plate text,
                        start_ts timestamp,
                        offer numeric
                    );
                    WITH reservation_auctions AS (
                        SELECT DISTINCT auction_id
                        FROM masterthesis_schema.reservation_auction_offers
                        WHERE offer IS NULL
                            OR (
                                offer IS NOT NULL
                                AND received_ts + INTERVAL '${minimalIntervalToChangeOffer} seconds' > CURRENT_TIMESTAMP
                            )
                    ),
                    auctions_to_finish AS (
                        SELECT DISTINCT a.auction_id
                        FROM masterthesis_schema.auctions AS a
                        WHERE auction_finished = FALSE
                            AND (
                                auction_end_ts < CURRENT_TIMESTAMP
                                OR (
                                    NOT EXISTS(
                                        SELECT 1
                                        FROM reservation_auctions AS ra
                                        WHERE ra.auction_id = a.auction_id
                                    )
                                )
                            )
                    )
                    INSERT INTO finish_auction
                    SELECT *
                    FROM auctions_to_finish;
                    WITH ranking AS (
                        SELECT rao.auction_id,
                            a.license_plate,
                            start_ts,
                            offer,
                            ROW_NUMBER() OVER (
                                PARTITION BY rao.auction_id
                                ORDER BY offer,
                                    received_ts NULLS LAST
                            ) AS auction_rank
                        FROM masterthesis_schema.reservation_auction_offers AS rao
                            LEFT JOIN masterthesis_schema.auctions AS a ON rao.auction_id = a.auction_id
                        WHERE EXISTS(
                                SELECT 1
                                FROM finish_auction AS fa
                                WHERE rao.auction_id = fa.auction_id
                            )
                            AND offer IS NOT NULL
                            AND (
                                auto_accept = TRUE
                                OR offer <= max_accepted_price
                            )
                    )
                    INSERT INTO res_winning_offer
                    SELECT auction_id,
                        license_plate,
                        start_ts,
                        offer
                    FROM ranking
                    WHERE auction_rank = 1;
                    UPDATE masterthesis_schema.reservations AS r
                    SET license_plate = a.license_plate
                    FROM res_winning_offer AS wo
                        LEFT JOIN masterthesis_schema.auctions AS a ON a.auction_id = wo.auction_id
                    RETURNING r.license_plate,
                        r.charging_station_id,
                        r.start_ts,
                        r.end_ts;
            `,
      fields: [
        "licensePlate",
        "chargingStationId",
        "startTimestamp",
        "endTimestamp",
      ],
    }).then((itm) => itm.rows);

    log(
      "DEBUG",
      `Successfully changed reservations: ${
        JSON.stringify(reservationChanges)
      }`,
    );

    const closedSuccessfulReservationAuctions = await transaction.queryObject<
      {
        auctionId: string;
        auctionFinished: boolean;
        winningPrice: number;
      }
    >({
      text: `     
                    UPDATE masterthesis_schema.auctions AS a
                    SET winning_price = rwo.offer,
                        auction_finished = TRUE
                    FROM res_winning_offer AS rwo
                    WHERE a.auction_id = rwo.auction_id
                    RETURNING a.auction_id,
                        auction_finished,
                        winning_price;
                        
                    DROP TABLE finish_auction;
                    DROP TABLE res_winning_offer;
            `,
      fields: [
        "auctionId",
        "auctionFinished",
        "winningPrice",
      ],
    }).then((itm) => itm.rows);

    log(
      "DEBUG",
      `Successfully closed spot auctions with a winning price: ${
        JSON.stringify(closedSuccessfulReservationAuctions)
      }`,
    );

    const closedExpiredAuctions = await transaction.queryObject<
      {
        auctionId: string;
        auctionFinished: boolean;
        winningPrice: number;
      }
    >({
      text: `     
                    WITH to_finish AS (
                        SELECT auction_id
                        FROM masterthesis_schema.auctions
                        WHERE auction_finished = FALSE
                            AND auction_end_ts > CURRENT_TIMESTAMP
                    )
                    UPDATE masterthesis_schema.auctions AS a
                    SET auction_finished = TRUE
                    FROM to_finish AS tf
                    WHERE a.auction_id = tf.auction_id
                    RETURNING a.auction_id,
                        a.winning_price,
                        a.auction_finished;
            `,
      fields: [
        "auctionId",
        "auctionFinished",
        "winningPrice",
      ],
    }).then((itm) => itm.rows);

    log(
      "DEBUG",
      `Successfully closed expired auctions: ${
        JSON.stringify(closedExpiredAuctions)
      }`,
    );

    await transaction.commit();

    const changes = {
      closedSuccessfulSpotAuctions: [...closedSuccessfulSpotAuctions],
      closedSuccessfulReservationAuctions: [
        ...closedSuccessfulReservationAuctions,
      ],
      lockedChargingSpots: [...lockedSpots],
      reservationChanges: [...reservationChanges],
      closedExpiredAuctions: [...closedExpiredAuctions],
    };
    await sqlConnection.queryObject<
      {
        executionTime: string;
        changes: string;
        cronJobType: string;
      }
    >({
      text: `
                  INSERT INTO masterthesis_schema.jobs (execution_time, changes, job_type)
                  VALUES (CURRENT_TIMESTAMP, '${JSON.stringify(changes)}', 'AUCTIONS_SETTLING')
                  RETURNING execution_time, changes, job_type
                  ;
          `,
      fields: [
        "executionTime",
        "changes",
        "cronJobType",
      ],
    }).then((itm) => itm.rows);

    log("INFO", "Successfully finished auction settling");
    log(
      "DEBUG",
      `Auction settling output: '${JSON.stringify(changes)}'`,
    );
  } catch (err) {
    const thrownError = err as Error;
    log("ERROR", "Could not settle auctions");
    log(
      "DEBUG",
      `Settling auctions failed due to: '${thrownError.message}' with cause: '${thrownError.cause}'`,
    );
  }
}
