import { LoadingBlock } from "@/components/ui/StateBlocks";

/**
 * Dashboard loading skeleton.
 *
 * Server-rendered while the dashboard's data is fetched, so an owner on a slow mobile
 * connection sees the shape of the page immediately instead of an empty white screen. It is
 * `aria-busy` and announces "Loading your businesses" once, rather than reading skeletons out.
 */
export default function DashboardLoading() {
  return (
    <div aria-busy="true">
      <p className="sr-only" role="status" aria-live="polite">
        Loading your businesses
      </p>
      <LoadingBlock label="Loading your businesses" />
    </div>
  );
}
