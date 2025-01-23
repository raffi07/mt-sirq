import { Handlers, STATUS_CODE } from "$fresh/server.ts";
import { key } from "../../fresh.config.ts";
import { sqlPool } from "../../fresh.config.ts";
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";
import log from "../../libs/logs.ts";
import { setCookie } from "$std/http/cookie.ts";

type LoginCredentials = {
  username: string;
  password: string;
};

export const handler: Handlers = {
  async POST(req, _ctx) {
    const loginObject = (await req.json()) as LoginCredentials;
    log("INFO", "/login POST request received");
    const username = loginObject.username;
    const password = loginObject.password;
    const tokenExpiry = Number(Deno.env.get('BEARER_TOKEN_EXPIRY'));

    const sqlConnection = await sqlPool.connect();

    try {
      const resultRows = await sqlConnection.queryObject<{
        company_id: string;
        uname: string;
        pwd: string;
      }>`
                SELECT *
                FROM masterthesis_schema.users
                WHERE uname = ${username}
                ;
            `.then((itm) => itm.rows);

      if (resultRows.length > 0) {
        const result = resultRows[0];

        if (result.pwd === password) {
          const jwt = await create(
            {
              alg: "HS512",
              typ: "JWT",
            },
            {
              sub: result.company_id,
              exp: getNumericDate(tokenExpiry),
            },
            key,
          );

          log("INFO", `Bearer token generated upon successful login`);
          log("DEBUG", `Bearer token: ${jwt}`);

          const headers = new Headers();
          const url = new URL(req.url);
          setCookie(headers, {
            name: "bearerToken",
            value: jwt, // this should be a unique value for each session
            maxAge: tokenExpiry,
            sameSite: "Lax", // this is important to prevent CSRF attacks
            domain: url.hostname,
            path: "/",
            secure: false,
          });

          headers.set("location", "/");
          // This was used for the frontend redirect
          // return new Response(null, {
          //   status: 303,
          //   headers,
          // });
          return new Response(
            JSON.stringify({bearerToken: jwt}),
            {
              status: STATUS_CODE.OK,
              headers
            }
          );
        } else {
          log("DEBUG", `Passwords not matching for user '${username}'`);
          return new Response(null, { status: STATUS_CODE.Unauthorized });
        }
      } else {
        log("DEBUG", `No user found with '${username}'`);
        return new Response(null, { status: STATUS_CODE.Unauthorized });
      }
    } catch (err) {
      const thrownError = err as Error;
      log("ERROR", `Login error: '${thrownError}'`);
      log("DEBUG", `Fail cause: '${thrownError.cause}'`);
      return new Response(`Internal Server Error: '${thrownError}'`, {
        status: STATUS_CODE.InternalServerError,
      });
    } finally {
      sqlConnection.release();
      log("INFO", "Releasing SQL connection from /api/login");
    }
  },
};
