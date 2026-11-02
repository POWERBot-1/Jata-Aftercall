import { notFound } from "next/navigation";
import { loadWorkforceOverview } from "@/lib/mjengo/workspace";

export const dynamic = "force-dynamic";

export default async function MjengoWorkforce({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId: raw } = await params;
  const businessId = String(raw ?? "").trim();
  if (!businessId) notFound();
  const { staff, payroll } = await loadWorkforceOverview(businessId);

  return (
    <section aria-labelledby="mjengo-workforce-heading">
      <h2 id="mjengo-workforce-heading" className="text-lg font-semibold">Workforce</h2>
      <p className="text-sm text-muted-foreground">
        Staff identity, role and location are stored and enforced by the POS access layer: a
        branch-bound cashier can only write to their own location.
      </p>

      <table className="mt-4 w-full text-sm">
        <caption className="sr-only">Staff</caption>
        <thead><tr className="text-left text-muted-foreground"><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Location</th><th scope="col">Active</th></tr></thead>
        <tbody>
          {staff.map((member: any) => (
            <tr key={member.id} className="border-t">
              <td className="py-1">{member.name}</td>
              <td>{member.role}</td>
              <td>{member.branchId || "All locations"}</td>
              <td>{member.isActive ? "Yes" : "No"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {staff.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No staff recorded.</p> : null}

      <div className="mt-6 rounded-sm border border-amber-300 bg-amber-50 p-4">
        <h3 className="font-medium">Payroll — BLOCKED</h3>
        <p className="mt-1 text-sm">{payroll.reason}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          No wage, deduction, payslip or statutory remittance is calculated or displayed, because
          showing one without a ledger would be a fabricated figure.
        </p>
      </div>
    </section>
  );
}
