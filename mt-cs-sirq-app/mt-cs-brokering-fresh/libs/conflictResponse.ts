import log from "./logs.ts";
import { STATUS_CODE } from "$fresh/server.ts";

export function returnConflict(
  errorMsg: string | null,
  debugMsg: string | null,
  verboseResponse: string | null,
): Response {
  if (errorMsg) {
    log(
      "ERROR",
      errorMsg,
    );
  }
  if (debugMsg) {
    log(
      "DEBUG",
      debugMsg,
    );
  }
  return new Response(
    verboseResponse,
    {
      status: STATUS_CODE.Conflict,
    },
  );
}
