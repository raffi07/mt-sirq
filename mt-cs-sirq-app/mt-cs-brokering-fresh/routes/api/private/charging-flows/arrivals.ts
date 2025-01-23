import { Handlers, STATUS_CODE } from "$fresh/server.ts";
import log from "../../../../libs/logs.ts";
import { ChargingFlowsRequest } from "../../../../libs/sharedTypes.ts";
import assignChargingSpots from "../../../../libs/assignSpots.ts";
import enforceFlow from "../../../../libs/flowEnforcer.ts";
import { setCookie } from "$std/http/cookie.ts";
import { sqlPool } from "../../../../fresh.config.ts";
import { returnConflict } from "../../../../libs/conflictResponse.ts";
import settleAuctions from "../../../../libs/auctionSettling.ts";

type ContextState = {
  companyId: string;
  companyName: string;
  isAdmin: boolean;
};

type SuccessResponse = {
  sessionId: string;
  arrivalTimestamp: string;
  chargerId: string | null;
  spotAssignmentTimestamp: string | null;
};

export const handler: Handlers<Request, ContextState> = {
  async POST(req, _ctx) {
    const reqObj = (await req.json()) as ChargingFlowsRequest;

    log("INFO", "/charging-flows/arrivals POST request received");
    log("DEBUG", `Request: ${JSON.stringify(reqObj)}`);

    log(
      "DEBUG",
      `Received arrival POST request for: license plate: '${reqObj.licensePlate}', in charging station with ID: '${reqObj.chargingStationId}'`,
    );

    const sqlConnection = await sqlPool.connect();

    try {
      log(
        "INFO",
        `Retrieving opened charging flows for license plate: '${reqObj.licensePlate}'`,
      );

      const openChargingFlowsResult = await sqlConnection.queryObject<
        {
          sessionId: string;
          chargingStationId: string;
          arrivalTimestamp: string;
        }
      >({
        text: `
                      SELECT session_id, charging_station_id, arrival_ts
                      FROM masterthesis_schema.charging_flows
                      WHERE license_plate = '${reqObj.licensePlate}' AND departure_ts IS NULL
                      ; 
              `,
        fields: [
          "sessionId",
          "chargingStationId",
          "arrivalTimestamp",
        ],
      }).then((itm) => itm.rows);

      if (openChargingFlowsResult.length > 0) {
        return returnConflict(
          "Open charging flow found",
          `Open charging flow(s) found: '${
            JSON.stringify(openChargingFlowsResult)
          }'`,
          "Open charging flow found. Only one open charging flow per license plate allowed, please settle this first",
        );
      } else {
        await settleAuctions(sqlConnection);
        await enforceFlow(sqlConnection);
        log(
          "INFO",
          `Setting new charging flow for license plate: '${reqObj.licensePlate}'`,
        );

        const chargingFlowInsertion = await sqlConnection.queryObject<
          { sessionId: string; chargingStationId: string; arrivalTimestamp: string }
        >({
          text: `
                        INSERT INTO masterthesis_schema.charging_flows (session_id, license_plate, charging_station_id, arrival_ts)
                        VALUES (gen_random_uuid(), '${reqObj.licensePlate}', '${reqObj.chargingStationId}'::uuid, current_timestamp)
                        RETURNING session_id, charging_station_id, arrival_ts
                        ; 
                `,
          fields: [
            "sessionId",
            "chargingStationId",
            "arrivalTimestamp",
          ],
        }).then((itm) => itm.rows);

        const result: SuccessResponse = {
          sessionId: chargingFlowInsertion?.[0].sessionId,
          arrivalTimestamp: chargingFlowInsertion?.[0].arrivalTimestamp,
          chargerId: null,
          spotAssignmentTimestamp: null,
        };

        if (chargingFlowInsertion.length > 0) {
          const assignedSpot = await assignChargingSpots(
            sqlConnection,
          ).then((itm) =>
            itm.insertions.filter((e) =>
              e.chargingStationId === reqObj.chargingStationId &&
              e.sessionId === result.sessionId
            )[0]
          );

          result.chargerId = assignedSpot?.chargerId ?? null;
          result.spotAssignmentTimestamp = assignedSpot?.spotAssignmentTimestamp ?? null;
        }

        const headers = new Headers();
        const url = new URL(req.url);
        setCookie(headers, {
          name: "chargingSession",
          value: result.sessionId,
          maxAge: 120 * 60,
          sameSite: "Lax",
          domain: url.hostname,
          path: "/",
          secure: false,
        });
        headers.set("Content-Type", "application/json");

        return new Response(
          JSON.stringify(result),
          {
            status: STATUS_CODE.OK,
            headers: headers,
          },
        );
      }
    } catch (err) {
      log(
        "ERROR",
        `Error when trying to insert arrival into charging_flows table: ${err}`,
      );
      return new Response(`Internal Server Error: ${err}`, {
        status: STATUS_CODE.InternalServerError,
      });
    } finally {
      sqlConnection.release();
      log(
        "INFO",
        "Releasing SQL connection from /api/private/charging-flows/arrivals",
      );
    }
  },
};
