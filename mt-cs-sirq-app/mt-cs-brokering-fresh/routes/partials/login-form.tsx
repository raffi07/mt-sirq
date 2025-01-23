import { defineRoute, RouteConfig } from "$fresh/server.ts";
import { Partial } from "$fresh/runtime.ts";
import LoginMask from "../../islands/LoginForm.tsx";
import LoginRegisterNav from "../../islands/LoginRegisterSwitch.tsx";

// We only want to render the content, so disable
// the `_app.tsx` template as well as any potentially
// inherited layouts
export const config: RouteConfig = {
  skipAppWrapper: true,
  skipInheritedLayouts: true,
};

export default defineRoute((_req, _ctx) => {
  return (
    <Partial name="auth-content">
      <LoginRegisterNav />
      <LoginMask />
    </Partial>
  );
});
