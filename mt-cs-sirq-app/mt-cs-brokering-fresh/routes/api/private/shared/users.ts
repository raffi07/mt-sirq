import { FreshContext, Handlers, STATUS_CODE } from "$fresh/server.ts";
import { sqlPool } from "../../../../fresh.config.ts";
import log from "../../../../libs/logs.ts";

type ContextState = {
  companyId: string;
  companyName: string;
  isAdmin: boolean;
};

type UsersRequest = {
  users: UsersToEdit;
};

type UsersToEdit = {
  companyName: string;
  active: boolean;
}[];

type User = {
  companyName: string;
  username: string;
  active: boolean;
}[];

function sqlResultToResponse(resultRows: User[]): Response {
  return new Response(JSON.stringify({ users: resultRows }), {
    status: STATUS_CODE.OK,
    headers: { "Content-Type": "application/json" },
  });
}

export const handler: Handlers<Request, ContextState> = {
  async GET(_req, ctx: FreshContext<ContextState>) {
    log("INFO", "shared/users GET request received");
    const sqlConnection = await sqlPool.connect();
    const companyId = ctx.state.companyId;

    log("INFO", "Fetching all users");

    try {
      if (ctx.state.isAdmin) {
        const resultRows = await sqlConnection.queryObject<User>`
                  SELECT company_name, uname, active
                  FROM masterthesis_schema.users
                  NATURAL JOIN masterthesis_schema.companies
                  WHERE company_name != 'TheAdminCompanyInc.'
                  ;
              `.then((itm) => itm.rows);
        return sqlResultToResponse(resultRows);
      } else {
        const resultRows = await sqlConnection.queryObject<User>`
                  SELECT company_name, uname, active
                  FROM masterthesis_schema.users
                  NATURAL JOIN masterthesis_schema.companies
                  WHERE company_id = ${companyId}
                  ;
              `.then((itm) => itm.rows);
        return sqlResultToResponse(resultRows);
      }
    } catch (err) {
      const thrownError = err as Error;
      log("ERROR", `User fetch error: '${thrownError}'`);
      if (thrownError.cause) {
        log("DEBUG", `Fail cause: '${thrownError.cause}'`);
      }
      return new Response(
        "Internal Server Error: Could not fetch users.",
        {
          status: STATUS_CODE.InternalServerError,
        },
      );
    } finally {
      sqlConnection.release();
      log("INFO", "Releasing SQL connection from /api/private/shared/users");
    }
  },

  async POST(req, ctx: FreshContext<ContextState>) {
    const reqObj = (await req.json()) as UsersRequest;

    log("INFO", "/shared/users POST request received");
    log("DEBUG", `Request: ${JSON.stringify(reqObj)}`);

    const results: {
      success: UsersToEdit[];
      errors: { companyName: string }[];
    } = { success: [], errors: [] };

    const sqlConnection = await sqlPool.connect();

    for (const e of reqObj.users) {
      const compName = e.companyName;
      const activate = e.active;

      try {
        if (!ctx.state.isAdmin && ctx.state.companyName != e.companyName) {
          throw Error("Unauthorized", {
            cause:
              "A company can only change users belonging to its own entity",
          });
        }

        log("INFO", `Updating companyName: ${compName}, active: ${activate}`);
        const resultRows = await sqlConnection.queryObject<UsersToEdit>`
                  UPDATE masterthesis_schema.users AS u
                  SET active = ${activate}
                  FROM masterthesis_schema.companies AS c
                  WHERE c.company_id = u.company_id
                  AND c.company_name = ${compName}
                  RETURNING c.company_name AS companyName, u.active
                  ;
              `.then((itm) => itm.rows);
        if (resultRows.length > 0) {
          results.success.push(resultRows[0]);
        } else {
          results.errors.push({ companyName: compName });
        }
      } catch (err) {
        const thrownError = err as Error;
        log("ERROR", `Error when updating users: '${thrownError.message}'`);
        log(
          "DEBUG",
          `Could not set: ${compName}, ${activate} with cause: '${thrownError.cause}'`,
        );
        results.errors.push({ companyName: compName });
      }
    }
    sqlConnection.release();
    log("INFO", "Releasing SQL connection from /api/private/shared/users");
    return new Response(JSON.stringify(results), {
      status: STATUS_CODE.OK,
      headers: { "Content-Type": "application/json" },
    });
  },
};
