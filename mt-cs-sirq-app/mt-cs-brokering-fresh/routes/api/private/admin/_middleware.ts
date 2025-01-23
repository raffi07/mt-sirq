import { FreshContext, STATUS_CODE } from "$fresh/server.ts";
import log from "../../../../libs/logs.ts";
import { sqlPool } from "../../../../fresh.config.ts";

interface ContextState {
  companyId: string;
}

function terminateMiddleware(errorMsg: string) {
  log(
    "ERROR",
    `Admin Middleware error: ${errorMsg}`,
  );
  return new Response("Unauthorized", {
    status: STATUS_CODE.Unauthorized,
  });
}

export async function handler(
  _req: Request,
  ctx: FreshContext<ContextState>,
): Promise<Response> {
  const companyId = ctx.state.companyId;
  log(
    "DEBUG",
    `Admin Middleware entered - company ID retrieved: ${companyId}`,
  );

  if (!companyId) {
    return terminateMiddleware(
      'No company ID available, "companyId" is undefined',
    );
  }

  const sqlConnection = await sqlPool.connect();

  try {
    const resultRows = await sqlConnection.queryObject<{
      company_id: string;
      company_name: string;
    }>`
            SELECT *
            FROM masterthesis_schema.companies
            WHERE company_id = ${companyId} AND company_name = 'TheAdminCompanyInc.'
            ;
        `.then((itm) => itm.rows);

    if (resultRows.length < 1) {
      log("DEBUG", `No company found with '${companyId}'`);
      return terminateMiddleware(
        "Company ID was either not found or does not have admin rights",
      );
    }
  } catch (err) {
    const thrownError = err as Error;
    log("ERROR", `Admin check error: '${thrownError}'`);
    return new Response(`Internal Server Error: '${thrownError}'`, {
      status: STATUS_CODE.InternalServerError,
    });
  } finally {
    sqlConnection.release();
    log("INFO", "Releasing SQL connection from Admin Middleware");
  }
  const resp = await ctx.next();
  return resp;
}
