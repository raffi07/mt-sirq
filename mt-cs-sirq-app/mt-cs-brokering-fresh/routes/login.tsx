import { PageProps } from "$fresh/server.ts";
import { Partial } from "$fresh/runtime.ts";
import LoginMask from "../islands/LoginForm.tsx";
import LoginRegisterNav from "../islands/LoginRegisterSwitch.tsx";
import RegisterMask from "../islands/RegisterForm.tsx";

function registerOrLogin(props: PageProps) {
  if (props.route.includes("register")) {
    return <RegisterMask />;
  } else {
    return <LoginMask />;
  }
}

export default function Login(props: PageProps) {
  return (
    <div class="px-4 py-8 h-screen w-screen flex flex-col justify-center items-center">
      <div class="max-w-screen-sm mx-auto h-1/2 py-4 w-full flex flex-col items-center justify-evenly bg-gradient-to-br from-[#ffffffc0] to-[#dfdfdf18] rounded-lg shadow-2xl">
        <Partial name="auth-content">
          <LoginRegisterNav />
          {registerOrLogin(props)}
        </Partial>
      </div>
    </div>
  );
}
