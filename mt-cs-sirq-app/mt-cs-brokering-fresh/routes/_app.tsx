import { type PageProps } from "$fresh/server.ts";
import { Partial } from "$fresh/runtime.ts";
export default function App({ Component }: PageProps) {
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>mt-cs-brokering-fresh</title>
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body class="bg-gradient-to-r from-[#f0fcab] to-[#60bf8f]" f-client-nav>
        <Partial name="body">
          <Component />
        </Partial>
      </body>
    </html>
  );
}
