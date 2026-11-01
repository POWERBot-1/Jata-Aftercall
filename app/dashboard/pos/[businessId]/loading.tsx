import { LoadingBlock } from "@/components/ui/StateBlocks";

/** Loading state for POS screens while the next section's data is read on the server. */
export default function PosLoading() {
  return (
    <div className="jata-route-enter" aria-busy="true">
      <LoadingBlock label="Loading Business POS…" />
    </div>
  );
}
