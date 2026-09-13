import Link from "next/link";

export function Navbar({ session }: { session?: { email: string; role: string } | null }) {
  return (
    <nav className="sticky top-0 z-30 border-b border-zinc-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="rounded-lg bg-zinc-900 px-2.5 py-1 text-sm font-bold tracking-tight text-white">JATA</span>
          <span className="text-sm font-semibold tracking-tight">AFTERCALL</span>
          <span className="hidden text-xs text-zinc-500 sm:inline">Every call leaves your business behind.</span>
        </Link>
        <div className="flex items-center gap-2">
          {session ? (
            <>
              <Link href="/dashboard" className="rounded-full border border-zinc-200 px-4 py-1.5 text-sm font-medium hover:bg-zinc-50">Dashboard</Link>
              {session.role === "ADMIN" && (
                <Link href="/admin" className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white">Admin</Link>
              )}
              <form action="/api/auth/logout" method="post">
                <button className="text-sm text-zinc-600 hover:text-zinc-900">Logout</button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="text-sm font-medium text-zinc-700 hover:text-zinc-900">Login</Link>
              <Link href="/register" className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-semibold text-white hover:bg-black">Get my business page</Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
