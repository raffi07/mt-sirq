import { FreshContext, Handlers, STATUS_CODE } from "$fresh/server.ts";
import { sqlPool } from "../../../../fresh.config.ts";
import log from "../../../../libs/logs.ts";

type ContextState = {
  companyId: string;
  companyName: string;
  isAdmin: boolean;
};

type FleetInput = {
  fleets: Fleet[];
};

type Fleet = {
  companyName: string;
  vehicles: Vehicle[];
};

type DatabaseVehicle = {
  licensePlate: string;
  companyId: string;
  companyName: string;
  active: boolean;
};

type GroupedFleets = {
  companyId: string;
  companyName: string;
  vehicles: Vehicle[];
};

type Vehicle = {
  licensePlate: string;
  active: boolean;
};

type CompanyIdToNameMap = {
  companyId: string;
  companyName: string;
};

function sqlResultToGetResponse(
  resultRows: { vehicles: Vehicle[] } | GroupedFleets[],
): Response {
  return new Response(JSON.stringify({ fleets: resultRows }), {
    status: STATUS_CODE.OK,
    headers: { "Content-Type": "application/json" },
  });
}

export const handler: Handlers<Request, ContextState> = {
  async GET(_req, ctx: FreshContext<ContextState>) {
    log("INFO", "shared/fleets GET request received");
    const sqlConnection = await sqlPool.connect();
    const companyId = ctx.state.companyId;

    try {
      if (ctx.state.isAdmin) {
        const groupedFleetsOutput: GroupedFleets[] = [];
        log("INFO", "Fetching all fleets");
        const resultRows = await sqlConnection.queryObject<
          DatabaseVehicle
        >({
          text: `
                            SELECT f.license_plate, f.company_id, f.active, c.company_name
                            FROM masterthesis_schema.fleets AS f
                            NATURAL JOIN masterthesis_schema.companies AS c
                            ;
                    `,
          fields: [
            "licensePlate",
            "companyId",
            "active",
            "companyName",
          ],
        }).then((itm) => itm.rows);
        resultRows.forEach((e) => {
          const foundIdx = groupedFleetsOutput.findIndex((itm) =>
            itm?.companyId === e.companyId
          );
          if (foundIdx == -1) {
            groupedFleetsOutput.push({
              companyId: e.companyId,
              companyName: e.companyName,
              vehicles: [{
                licensePlate: e.licensePlate,
                active: e.active,
              }],
            });
          } else {
            groupedFleetsOutput[foundIdx].vehicles.push({
              licensePlate: e.licensePlate,
              active: e.active,
            });
          }
        });
        return sqlResultToGetResponse(groupedFleetsOutput);
      } else {
        log("INFO", "Fetching company fleet");
        log("DEBUG", `Company: ${companyId}`);
        const resultRows = await sqlConnection.queryObject<Vehicle>({
          text: `
                  SELECT license_plate, active
                  FROM masterthesis_schema.fleets
                  WHERE company_id = ${companyId}
                  ;
              `,
          fields: [
            "licensePlate",
            "active",
          ],
        }).then((itm) => itm.rows);
        return sqlResultToGetResponse({ vehicles: resultRows });
      }
    } catch (err) {
      const thrownError = err as Error;
      log("ERROR", `Fleets fetch error: '${thrownError}'`);
      if (thrownError.cause) {
        log("DEBUG", `Fail cause: '${thrownError.cause}'`);
      }
      return new Response(
        "Internal Server Error: Could not fetch fleets.",
        {
          status: STATUS_CODE.InternalServerError,
        },
      );
    } finally {
      sqlConnection.release();
      log(
        "INFO",
        "Releasing SQL connection from /api/private/shared/fleets",
      );
    }
  },

  async POST(req, ctx) {
    const reqObj = (await req.json()) as FleetInput;

    log("INFO", "/shared/fleets POST request received");
    log("DEBUG", `Request: ${JSON.stringify(reqObj)}`);

    const results: {
      success: Vehicle[];
      errors: { licensePlate: string }[];
    } = { success: [], errors: [] };

    const sqlConnection = await sqlPool.connect();

    for (const e of reqObj.fleets) {
      const compName = e.companyName;
      const vehicles = e.vehicles;
      const nameToIdMapping: CompanyIdToNameMap[] = [];

      if (!ctx.state.isAdmin && ctx.state.companyName != e.companyName) {
        try{
          throw Error("Unauthorized", {
            cause:
              "A company can only change vehicles belonging to its own entity",
          });
        }
        catch(err){
          const thrownError = err as Error;
          log(
            "ERROR",
            `Token not maching entity of given Company Name: '${thrownError}'`,
          );
          if (thrownError.cause) {
            log("DEBUG", `Fail cause: '${thrownError.cause}'`);
          }
          return new Response(
            "Internal Server Error: Could not update fleets.",
            {
              status: STATUS_CODE.InternalServerError,
            },
          );
        }
      }

      if (ctx.state.isAdmin) {
        try {
          await sqlConnection.queryObject<CompanyIdToNameMap>({
            text: `
                                SELECT c.company_id, company_name
                                FROM masterthesis_schema.companies AS c
                                LEFT JOIN masterthesis_schema.users AS u ON c.company_id = u.company_id
                                WHERE active = TRUE
                                ;
                        `,
            fields: [
              "companyId",
              "companyName",
            ],
          }).then((itm) => nameToIdMapping.push(...itm.rows));
        } catch (err) {
          const thrownError = err as Error;
          log(
            "ERROR",
            `Company ID to Company Name fetch error: '${thrownError}'`,
          );
          if (thrownError.cause) {
            log("DEBUG", `Fail cause: '${thrownError.cause}'`);
          }
          return new Response(
            "Internal Server Error: Could not update fleets.",
            {
              status: STATUS_CODE.InternalServerError,
            },
          );
        }
      }

      for (const v of vehicles) {
        log("INFO", `Updating fleet for company: ${compName}`);
        log(
          "DEBUG",
          `Upserting companyName: ${compName}, vehicle: ${v.licensePlate} active: ${v.active}`,
        );

        const companyId = ctx.state.isAdmin
          ? nameToIdMapping.filter((e) =>
            e.companyId === ctx.state.companyId
          )[0].companyId
          : ctx.state.companyId;

        try {
          const resultRows = await sqlConnection.queryObject<
            Vehicle
          >({
            text: `
                                INSERT INTO masterthesis_schema.fleets (license_plate, company_id, active)
                                VALUES ('${v.licensePlate}', '${companyId}', ${v.active})
                                ON CONFLICT (license_plate) DO UPDATE 
                                SET active = EXCLUDED.active 
                                RETURNING license_plate, active
                                ;
                        `,
            fields: [
              "licensePlate",
              "active",
            ],
          }).then((itm) => itm.rows);
          if (resultRows.length > 0) {
            results.success.push(resultRows[0]);
          } else {
            results.errors.push({ licensePlate: v.licensePlate });
          }
        } catch (err) {
          const thrownError = err as Error;
          log(
            "ERROR",
            `Error when upserting vehicles: '${thrownError.message}'`,
          );
          log(
            "DEBUG",
            `Could not set: ${v.licensePlate}, ${v.active} with cause: '${thrownError.cause}'`,
          );
          results.errors.push({ licensePlate: v.licensePlate });
        }
      }
    }
    sqlConnection.release();
    log("INFO", "Releasing SQL connection from /api/private/shared/fleets");
    return new Response(JSON.stringify(results), {
      status: STATUS_CODE.OK,
      headers: { "Content-Type": "application/json" },
    });
  },
};
