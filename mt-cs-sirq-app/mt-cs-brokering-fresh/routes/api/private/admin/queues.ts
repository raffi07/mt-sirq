import { FreshContext, Handlers, STATUS_CODE } from "$fresh/server.ts";
import { sqlPool } from "../../../../fresh.config.ts";
import log from "../../../../libs/logs.ts";

type ContextState = {
  companyId: string;
  companyName: string;
  isAdmin: boolean;
};

export const handler: Handlers<Request, ContextState> = {
  async GET(req, _ctx: FreshContext<ContextState>) {
    const url = new URL(req.url);
    const chargingStationId = url.searchParams.get("q") || "";

    log("INFO", "admin/queues GET request received");
    log("DEBUG", `GET request for ID: '${chargingStationId}'`);

    const sqlConnection = await sqlPool.connect();

    try {
      if (chargingStationId.length < 0) {
        throw Error("No valid q-param presented", {
          cause:
            "Without a valid ID for a charging station as the parameter 'q' no queues can be fetched",
        });
      }
      log("INFO", "Fetching queue");
      const resultRows = await sqlConnection.queryObject<
        {
          sessionId: string;
          arrivalTimestamp: string;
          queuePosition: number;
        }
      >({
        text: `
                    SELECT session_id, arrival_ts, queue_position
                    FROM masterthesis_schema.v_queues
                    WHERE charging_station_id = ${chargingStationId}
                    ;
                    `,
        fields: [
          "sessionId",
          "arrivalTimestamp",
          "queuePosition",
        ],
      }).then((itm) => itm.rows);

      return new Response(
        JSON.stringify({ chargingStationId: chargingStationId, queue: resultRows }),
        {
          status: STATUS_CODE.OK,
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (err) {
      const thrownError = err as Error;
      log("ERROR", `Queues fetch error: '${thrownError}'`);
      if (thrownError.cause) {
        log("DEBUG", `Fail cause: '${thrownError.cause}'`);
      }
      return new Response(
        "Internal Server Error: Could not fetch queues",
        {
          status: STATUS_CODE.InternalServerError,
        },
      );
    } finally {
      sqlConnection.release();
      log(
        "INFO",
        "Releasing SQL connection from /api/private/shared/queues",
      );
    }
  },
};
