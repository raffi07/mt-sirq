import { FreshContext, Handlers, STATUS_CODE } from "$fresh/server.ts";
import { sqlPool } from "../../../../../fresh.config.ts";
import log from "../../../../../libs/logs.ts";

type ContextState = {
  companyId: string;
  companyName: string;
  isAdmin: boolean;
};

type OfferRequest = {
  auctionId: string;
  offer: number;
};

type spotAuctionOfferOutput = {
  auctionId: string;
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

function sqlResultToPostResponse(
  output: spotAuctionOfferOutput | reservationAuctionOfferOutput,
): Response {
  return new Response(JSON.stringify(output), {
    status: STATUS_CODE.OK,
    headers: { "Content-Type": "application/json" },
  });
}

export const handler: Handlers<Request, ContextState> = {
  async POST(req, ctx: FreshContext<ContextState>) {
    const reqObj = (await req.json()) as OfferRequest;

    log("INFO", "/shared/auction-offers POST request received");
    log("DEBUG", `Request: ${JSON.stringify(reqObj)}`);

    if (ctx.state.isAdmin) {
      log(
        "ERROR",
        "Trying to set auction offers as admin, which is not intended",
      );
      return new Response("Unauthorized", {
        status: STATUS_CODE.Unauthorized,
      });
    }

    const sqlConnection = await sqlPool.connect();

    try {
      log(
        "INFO",
        `Start procedure for inserting auction offer`,
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
                                WHERE auction_id = '${reqObj.auctionId}'
                                AND auction_end_ts > CURRENT_TIMESTAMP
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
                              UPDATE masterthesis_schema.spot_auction_offers
                                SET offer = ${reqObj.offer}, 
                                    received_ts = CURRENT_TIMESTAMP
                                WHERE auction_id = '${reqObj.auctionId}'
                                AND company_id = '${ctx.state.companyId}'::uuid
                                RETURNING
                                    auction_id,
                                    charger_id,
                                    offer,
                                    received_ts
                              ;
                      `,
          fields: [
            "auctionId",
            "chargerId",
            "offer",
            "receivedTimestamp",
          ],
        }).then((itm) => itm.rows);
        return sqlResultToPostResponse(offersResult[0]);
      } else if (auction.auctionType === "RESERVATION") {
        const offersResult = await sqlConnection.queryObject<
          reservationAuctionOfferOutput
        >({
          text: `
                              UPDATE masterthesis_schema.reservation_auction_offers
                                SET offer = ${reqObj.offer}, 
                                    received_ts = CURRENT_TIMESTAMP
                                WHERE auction_id = '${reqObj.auctionId}'
                                AND company_id = '${ctx.state.companyId}'::uuid
                                RETURNING
                                    auction_id,
                                    license_plate,
                                    start_ts,
                                    end_ts,
                                    offer,
                                    received_ts
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
        return sqlResultToPostResponse(offersResult[0]);
      } else {
        return new Response(
          "Check if the requested ID is correct and/or existing",
          { status: STATUS_CODE.Forbidden },
        );
      }
    } catch (err) {
      const thrownError = err as Error;
      log("ERROR", `Setting auction offers error: '${thrownError}'`);
      if (thrownError.cause) {
        log("DEBUG", `Fail cause: '${thrownError.cause}'`);
      }
      return new Response(
        "Internal Server Error: Could not set auction offers.",
        {
          status: STATUS_CODE.InternalServerError,
        },
      );
    } finally {
      sqlConnection.release();
      log(
        "INFO",
        "Releasing SQL connection from POST /api/private/shared/auction-offers/",
      );
    }
  },
};
