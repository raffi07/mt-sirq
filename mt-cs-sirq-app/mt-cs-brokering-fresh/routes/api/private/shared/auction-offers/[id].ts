import { FreshContext, Handlers, STATUS_CODE } from "$fresh/server.ts";
import { sqlPool } from "../../../../../fresh.config.ts";
import log from "../../../../../libs/logs.ts";

type ContextState = {
  companyId: string;
  companyName: string;
  isAdmin: boolean;
};

type spotAuctionOfferOutput = {
  auctionId: string;
  chargingStationId: string;
  chargerId: string;
  offer: number;
  receivedTimestamp: string;
};

type reservationAuctionOfferOutput = {
  auctionId: string;
  licensePlate: string;
  startTimestamp: string;
  endTimestamp: string;
  offer: number;
  receivedTimestamp: string;
};

function sqlResultToGetResponse(
  output: spotAuctionOfferOutput | reservationAuctionOfferOutput,
): Response {
  return new Response(JSON.stringify(output), {
    status: STATUS_CODE.OK,
    headers: { "Content-Type": "application/json" },
  });
}

export const handler: Handlers<Request, ContextState> = {
  async GET(_req, ctx: FreshContext<ContextState>) {
    const id = ctx.params.id;

    log("INFO", "shared/auction-offers GET request received");
    log("DEBUG", `GET request for ID: '${id}'`);

    const sqlConnection = await sqlPool.connect();

    try {
      const companyFilter = ctx.state.isAdmin
        ? ""
        : `AND company_id = '${ctx.state.companyId}'::uuid`;

      log(
        "INFO",
        `Start procedure for fetching auction offer`,
      );

      const auctionsResult = await sqlConnection.queryObject<
        {
          auctionId: string;
          auctionType: string;
        }
      >({
        text: `
                              SELECT auction_id, auction_type
                                FROM masterthesis_schema.auctions
                                WHERE auction_id = '${id}'
                                ${companyFilter}
                              ;
                      `,
        fields: [
          "auctionId",
          "auctionType",
        ],
      }).then((itm) => itm.rows);

      if (auctionsResult.length < 1) {
        return new Response(
          "Check if the requested ID is correct and/or existing",
          { status: STATUS_CODE.Forbidden },
        );
      }

      const auction = auctionsResult[0];
      if (auction.auctionType === "SPOT") {
        const offersResult = await sqlConnection.queryObject<
          spotAuctionOfferOutput
        >({
          text: `
                              SELECT auction_id, charger_id, offer, received_ts
                                FROM masterthesis_schema.auctions
                                WHERE auction_id = '${id}'
                                ${companyFilter}
                              ;
                      `,
          fields: [
            "auctionId",
            "chargerId",
            "offer",
            "receivedTimestamp",
          ],
        }).then((itm) => itm.rows);
        return sqlResultToGetResponse(offersResult[0]);
      } else if (auction.auctionType === "RESERVATION") {
        const offersResult = await sqlConnection.queryObject<
          reservationAuctionOfferOutput
        >({
          text: `
                              SELECT auction_id, license_plat, start_ts, end_ts, offer, received_ts
                                FROM masterthesis_schema.auctions
                                WHERE auction_id = '${id}'
                                ${companyFilter}
                              ;
                      `,
          fields: [
            "auctionId",
            "licensePlate",
            "startTimestamp",
            "endTimestamp",
            "offer",
            "receivedTimestamp",
          ],
        }).then((itm) => itm.rows);
        return sqlResultToGetResponse(offersResult[0]);
      } else {
        return new Response(
          "Check if the requested ID is correct and/or existing",
          { status: STATUS_CODE.Forbidden },
        );
      }
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
        "Releasing SQL connection from GET /api/private/shared/auction-offers/",
      );
    }
  },
};
