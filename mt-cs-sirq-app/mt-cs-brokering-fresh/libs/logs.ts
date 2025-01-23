import { DateTime } from "https://deno.land/x/ts_luxon@5.0.6-4/src/datetime.ts";

export default function log(level: string, msg: string) {
  const timestamp = DateTime.now().toFormat("yyyy-MM-dd HH:mm:ss");

  if (level === "INFO") {
    console.info(
      `%c${timestamp} --- [INFO] --- ${msg}`,
      "color: blue",
    );
  }

  if (level === "DEBUG") {
    console.debug(
      `%c${timestamp} --- [DEBUG] --- ${msg}`,
      "color: yellow",
    );
  }

  if (level === "ERROR") {
    console.error(
      `%c${timestamp} --- [ERROR] --- ${msg}`,
      "color: red",
    );
  }
}
