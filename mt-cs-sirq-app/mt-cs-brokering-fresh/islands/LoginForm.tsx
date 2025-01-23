import { Button } from "../components/Button.tsx";
import { useRef } from "https://esm.sh/v128/preact@10.22.0/hooks";

async function sendLoginData(uname: string, password: string) {
  const url = "api/login";
  const body = JSON.stringify({
    username: uname,
    password: password,
  });

  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: body,
    });
  } catch (err) {
    return Promise.reject(`Could not login successfully: ${err}`);
  }
}

export default function LoginMask() {
  const usernameInput = useRef<HTMLInputElement | null>(null);
  const passwordInput = useRef<HTMLInputElement | null>(null);

  const clickLogin = async (event: Event) => {
    event.preventDefault();
    const username = usernameInput.current?.value;
    const password = passwordInput.current?.value;

    if (username && password) {
      await sendLoginData(username, password);
    }
  };

  return (
    <div class="min-h-60 flex flex-col justify-between items-center">
      <h1 class="text-4xl font-bold text-gray-600">Login</h1>
      <input
        ref={usernameInput}
        class="bg-[#ffffff3b] p-3 rounded-lg focus:outline-none border-solid border-b-2 border-gray-300 shadow-inner placeholder:text-slate-900 focus:border-green-800 transition-colors ease-in"
        type="text"
        id="usernameInput"
        placeholder="Username"
      />
      <input
        ref={passwordInput}
        class="bg-[#ffffff3b] p-3 rounded-lg focus:outline-none border-solid border-b-2 border-gray-300 shadow-inner placeholder:text-slate-900 focus:border-green-800 transition-colors ease-in"
        type="password"
        id="passwordInput"
        placeholder="Password"
      />
      <Button
        class="px-2 py-1 w-1/2 shadow-inner rounded bg-gradient-to-r from-[#70b869fb] to-[#cac70062] text-gray-50 font-bold hover:bg-green-800 transition-colors duration-300"
        onClick={clickLogin}
      >
        Log In
      </Button>
    </div>
  );
}
