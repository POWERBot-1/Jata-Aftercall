import Link from "next/link";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";

export function Navbar({ session }: { session?: { email: string; role: string } | null }) {
  return (
    <nav className="jata-nav">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <BrandMark />
        <div className="flex items-center gap-2">
          {session ? (
            <>
              <Button href="/dashboard" variant="secondary">Dashboard</Button>
              {session.role === "ADMIN" ? <Button href="/admin">Admin</Button> : null}
              <form action="/api/auth/logout" method="post">
                <button className="jata-btn jata-btn-ghost">Logout</button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="text-sm font-semibold text-zinc-700">Login</Link>
              <Button href="/register">Get my business page</Button>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
