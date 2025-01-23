import { Handlers, STATUS_CODE } from "$fresh/server.ts";
import { sqlPool } from "../../fresh.config.ts";
import log from "../../libs/logs.ts";

type RegisterRequest = {
  username: string;
  password: string;
  companyName: string;
};

export const handler: Handlers = {
  async POST(req, _ctx) {
    const registerObj = (await req.json()) as RegisterRequest;
    log("INFO", "/register POST request received");
    const username = registerObj.username;
    const password = registerObj.password;
    const companyName = registerObj.companyName;

    const sqlConnection = await sqlPool.connect();

    try {
      const transaction = sqlConnection.createTransaction(
        "register_user_and_company",
      );
      await transaction.begin();

      const resultRows = await transaction.queryObject<{ company_id: string }>`
                INSERT INTO masterthesis_schema.companies (company_id, company_name)
                VALUES (gen_random_uuid(), ${companyName})
                RETURNING (company_id);
            `.then((itm) => itm.rows);

      if (resultRows.length > 0) {
        const result = resultRows[0];
        const newCompanyId = result.company_id;

        log("INFO", `Successfully registered new company.`);
        log(
          "DEBUG",
          `Registered username: '${username}' New company ID: '${result.company_id}' New company name: '${companyName}'`,
        );

        await transaction.queryObject<{ company_id: string }>`
                INSERT INTO masterthesis_schema.users (company_id, uname, pwd, active)
                VALUES (${newCompanyId}, ${username}, ${password}, TRUE);
            `;

        log("INFO", `Successfully registered new user.`);

        await transaction.commit();
      } else {
        log(
          "DEBUG",
          `No companyId received for newly registered user'${username}'`,
        );
        return new Response(null, { status: STATUS_CODE.Unauthorized });
      }

      const headers = new Headers();

      headers.set("location", "/login");
      // return new Response(null, {
      //   status: 307,
      //   headers,
      // });
      return new Response(
        JSON.stringify({message: 'Account successfully registered. Please proceed with the login.'}),
        {
          status: STATUS_CODE.OK,
          headers
        }
      );
    } catch (err) {
      const thrownError = err as Error;
      log("ERROR", `Register error: ${thrownError}`);
      if (thrownError.cause) {
        log("DEBUG", `Fail cause: ${thrownError.cause}`);
      }
      return new Response(
        `Internal Server Error: Could not register the desired user, please try again.`,
        {
          status: STATUS_CODE.InternalServerError,
        },
      );
    } finally {
      sqlConnection.release();
      log("INFO", "Releasing SQL connection from /api/register");
    }
  },
};
