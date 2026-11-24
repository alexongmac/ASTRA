import { signOut } from "@/auth";

// Must be rendered after connection(): the log-out form is a Server Action,
// whose id is generated per render.
export function Header({ userName }: { userName?: string | null }) {
  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <header className="flex items-center justify-between">
      <h1 className="text-sm font-semibold text-white">R2D2 · Operation Excellence</h1>
      <div className="flex items-center gap-3 text-xs text-slate-300">
        <span>Signed in as {userName}</span>
        <form action={logout}>
          <button className="rounded border border-slate-600 bg-slate-800 px-3 py-1.5 hover:bg-slate-700">
            Log out
          </button>
        </form>
      </div>
    </header>
  );
}
