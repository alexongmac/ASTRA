import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthError } from "next-auth";
import { auth, signIn } from "@/auth";
import { BrandGear, LowPolyBackground } from "./low-poly-background";
import { PasswordField } from "./password-field";
import "./login.css";

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
    <main className="login-page">
      <LowPolyBackground />

      <section className="login-card">
        <form action={login}>
          <div className="brand">
            <BrandGear />
            <span>R2D2 Operator</span>
          </div>

          <h2>Welcome back</h2>
          <p className="sub">Log in to see Operation Excellence.</p>

          <label htmlFor="username">Operator name</label>
          <div className="inp-ic">
            <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
            </svg>
            <input
              id="username"
              name="username"
              autoComplete="username"
              required
              maxLength={64}
            />
          </div>

          <label htmlFor="password">Password</label>
          <PasswordField />

          <p className="login-error" role="alert">
            {error ? "Invalid operator name or password." : ""}
          </p>

          <button type="submit" className="login-submit">
            Log in
          </button>
        </form>
      </section>
    </main>
  );
}
