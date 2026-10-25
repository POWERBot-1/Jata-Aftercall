import { WorkspaceSkeleton } from "@/components/workspace/WorkspaceUI";

/**
 * Workspace loading skeleton.
 *
 * Server-rendered while the dashboard's data is fetched, so an owner on a slow mobile
 * connection sees the shape of the page immediately instead of an empty white screen: the
 * hero band, the metric row and two business cards, in the same proportions as the real
 * page. It is `aria-busy` and announces "Loading your businesses" once, rather than reading
 * every skeleton box out.
 */
export default function DashboardLoading() {
  return (
    <div aria-busy="true" className="ws-stack">
      <p className="sr-only" role="status" aria-live="polite">
        Loading your businesses
      </p>
      <WorkspaceSkeleton className="h-[15rem] rounded-[1.6rem] sm:h-[17rem]" />
      <div className="grid gap-3 sm:grid-cols-2">
        <WorkspaceSkeleton className="h-24" />
        <WorkspaceSkeleton className="h-24" />
      </div>
      <div className="space-y-4 rounded-[1.6rem] border border-[color:var(--ws-line)] bg-[color:var(--ws-paper)] p-4">
        <WorkspaceSkeleton className="h-40 rounded-xl" />
        <WorkspaceSkeleton className="h-8 w-2/3" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <WorkspaceSkeleton className="h-20" />
          <WorkspaceSkeleton className="h-20" />
          <WorkspaceSkeleton className="h-20" />
          <WorkspaceSkeleton className="h-20" />
        </div>
        <WorkspaceSkeleton className="h-52 rounded-xl" />
      </div>
    </div>
  );
}
