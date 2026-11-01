import { LoadingBlock } from "@/components/ui/StateBlocks";

/**
 * Shown while a workspace section loads on navigation. Skeleton tiles keep the final layout
 * stable, and the sr-only label announces progress to screen-reader users.
 */
export default function DashboardLoading() {
  return (
    <div className="jata-route-enter" aria-busy="true">
      <LoadingBlock label="Loading your workspace…" />
    </div>
  );
}
