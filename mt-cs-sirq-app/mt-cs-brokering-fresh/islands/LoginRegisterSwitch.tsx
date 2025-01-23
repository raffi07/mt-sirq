export default function LoginRegisterNav() {
  return (
    <nav class="h-11 -mt-12 w-full flex flex-col justify-center">
      <ul class="h-full flex flex-row items-center justify-center">
        <li class="px-8 h-full w-1/3 max-w-xs flex justify-center items-center">
          <a
            class="w-full text-center border-solid border-b-2 border-transparent aria-[current]:border-green-500"
            href="/login"
            f-partial="/partials/login-form"
          >
            Login
          </a>
        </li>
        <li class="px-8 h-full w-1/3 max-w-xs flex justify-center items-center">
          <a
            class="w-full text-center border-solid border-b-2 border-transparent aria-[current]:border-green-500"
            href="/register"
            f-partial="/partials/register-form"
          >
            Register
          </a>
        </li>
      </ul>
    </nav>
  );
}
