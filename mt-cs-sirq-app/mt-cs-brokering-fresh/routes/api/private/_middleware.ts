import { FreshContext, STATUS_CODE } from "$fresh/server.ts";
import log from "../../../libs/logs.ts";
import { key } from "../../../fresh.config.ts";
import { verify } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

interface ContextState {
  companyId: string;
}

export async function handler(
  req: Request,
  ctx: FreshContext<ContextState>,
): Promise<Response> {
  const reqBearerToken = req.headers.get("Authorization")?.replace(
    "Bearer ",
    "",
  );
  log(
    "DEBUG",
    `Private Middleware entered - bearerToken retrieved: ${reqBearerToken}`,
  );

  try {
    if (!reqBearerToken) {
      throw Error("No token available", {
        cause: "reqBearerToken is undefined",
      });
    }

    const payload = await verify(reqBearerToken, key);
    const companyId = payload.sub;

    if (!companyId) {
      throw Error("No companyId available", {
        cause: '"sub"-attribute in payload is null or undefined',
      });
    }

    ctx.state.companyId = companyId;
  } catch (err) {
    const thrownError = err as Error;
    log(
      "ERROR",
      `Private Middleware error: ${thrownError}, ${thrownError.cause}`,
    );
    return new Response("Unauthorized", { status: STATUS_CODE.Unauthorized });
  }

  const resp = await ctx.next();
  return resp;
}
