import { JSX } from "preact";
import { IS_BROWSER } from "$fresh/runtime.ts";

export function Button(props: JSX.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      disabled={!IS_BROWSER || props.disabled}
      // class="px-2 py-1 border-gray-500 shadow-inner rounded bg-green-900 text-white font-bold hover:bg-gray-200 transition-colors"
    />
  );
}
