import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthError } from "next-auth";
import { auth, signIn } from "@/auth";

// Reads the session to redirect signed-in operators, so it blocks on the server.
export const instant = false;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // The sign-in form is a Server Action, whose id is generated per render.
  await connection();
  if (await auth()) redirect("/");
  const { error } = await searchParams;

  async function login(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        username: formData.get("username"),
        password: formData.get("password"),
        redirectTo: "/",
      });
    } catch (err) {
      if (err instanceof AuthError) redirect("/login?error=1");
      throw err;
    }
  }

  return (
    <main className="min-h-screen bg-slate-900 px-4 py-6">
      <h1 className="text-sm font-semibold text-slate-100">R2D2 · Alarm Acknowledgement</h1>

      <div className="mx-auto mt-24 w-full max-w-sm rounded-lg border border-slate-700 bg-slate-800 p-6 shadow-sm">
        <form action={login} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm text-slate-300">
              Operator name
            </label>
            <input
              id="username"
              name="username"
              required
              autoComplete="username"
              className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm text-slate-300">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
            />
          </div>

          {error ? <p className="text-sm text-red-400">Invalid operator name or password.</p> : null}

          <button
            type="submit"
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Log in
          </button>
        </form>
      </div>
    </main>
  );
}
