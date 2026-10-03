import Link from "next/link";

/**
 * The "not for you" state a POS page shows instead of data the actor may not read (§11, §36).
 *
 * It exists so the page layer answers exactly like the screen's API: a role that does not hold
 * the module's read permission is told so in plain language (§38), and nothing tenant-owned is
 * loaded or rendered behind it. The person is still inside their own POS — the shell's navigation
 * stays — so the way back is a link, not a dead end.
 */
export function PosRefusal({ message, basePath }: { message: string; basePath: string }) {
  return (
    <div className="jata-card p-6" data-pos-refusal="true">
      <p className="jata-kicker">Not allowed</p>
      <h2 className="text-lg font-bold">This screen is not for your role</h2>
      <p className="mt-1 text-sm text-zinc-600">{message}</p>
      <Link href={basePath} className="jata-btn jata-btn-secondary mt-4">
        Back to the dashboard
      </Link>
    </div>
  );
}
