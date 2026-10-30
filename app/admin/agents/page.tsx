import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdminPage } from "@/lib/adminGuard";
import prisma from "@/lib/db";
import { AdminPage } from "@/components/admin/AdminUI";
import ReviewApplication from "@/components/agents/ReviewApplication";
import RejectApplication from "@/components/agents/RejectApplication";
import { agentAdminNotificationReadiness } from "@/lib/agents/admin-notification-config";
import { WorkspacePanel } from "@/components/workspace/WorkspaceUI";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

type ApplicationRow = { id: string; fullName: string; phoneE164: string; status: string; agentStatus: string; createdAt: Date };

export default async function AgentApplications({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const session = await requireAdminPage();
  // A signed session may contain an old role. Re-check the authoritative account before reading
  // application data, in addition to the standard per-page admin guard.
  const account = await prisma.user.findUnique({ where: { id: session.userId }, select: { role: true } });
  if (account?.role !== "ADMIN") redirect("/dashboard");
  const notificationReadiness = agentAdminNotificationReadiness();
  const params = await searchParams;
  const parsedPage = Number(params.page || "1");
  const page = Number.isSafeInteger(parsedPage) && parsedPage >= 1 && parsedPage <= 10000 ? parsedPage : 1;
  let rows: ApplicationRow[];
  try {
    rows = await prisma.agentApplication.findMany({
      select: { id: true, fullName: true, phoneE164: true, status: true, agentStatus: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1,
    });
  } catch {
    return <AdminPage title="Agent applications"><WorkspacePanel title="Unavailable"><p>Applications could not be loaded. Please try again later.</p></WorkspacePanel></AdminPage>;
  }
  const hasNext = rows.length > PAGE_SIZE;
  return <AdminPage title="Agent applications" meta="Phone verification does not activate applicants.">
    <WorkspacePanel title="Administrator notifications" meta="Configuration check only; notifications are not sent.">
      <p>{notificationReadiness === "CONFIGURED" ? "Recipient configuration is present." : notificationReadiness === "INVALID" ? "Recipient configuration is invalid; correct it securely on the server." : "Recipient configuration is not set."} Delivery, retries and provider approval are not yet available.</p>
    </WorkspacePanel>
    <WorkspacePanel title="Applications" meta="Phone numbers are masked. Manual review requires a verified phone and privacy acknowledgement. Activation and reinstatement are independently disabled unless separately enabled.">
      {rows.length === 0 ? <p>No applications on this page.</p> : <ul>
        {rows.slice(0, PAGE_SIZE).map((row) => <li key={row.id}>
          <strong>{row.fullName}</strong> · {row.phoneE164.slice(0, 4)}•••••{row.phoneE164.slice(-3)} · {new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" }).format(row.createdAt)} · {row.status === "REJECTED" ? "Rejected" : row.agentStatus === "ACTIVE" ? "Active" : row.agentStatus === "SUSPENDED" ? "Suspended" : "Pending review"}
          {row.status === "PENDING" && row.agentStatus === "INACTIVE" && <><RejectApplication id={row.id} />{process.env.AGENT_ACTIVATION_ENABLED === "true" && <ReviewApplication id={row.id} action="approve" />}</>}
          {row.status === "PENDING" && row.agentStatus === "SUSPENDED" && process.env.AGENT_REINSTATEMENT_ENABLED === "true" && <ReviewApplication id={row.id} action="reinstate" />}
          {row.agentStatus === "ACTIVE" && <ReviewApplication id={row.id} action="suspend" />}
        </li>)}
      </ul>}
      <nav aria-label="Application pages">
        {page > 1 && <Link href={`/admin/agents?page=${page - 1}`}>Previous page</Link>}{" "}
        {hasNext && <Link href={`/admin/agents?page=${page + 1}`}>Next page</Link>}
      </nav>
    </WorkspacePanel>
  </AdminPage>;
}
