import Link from "next/link";
import { loadErpWorkspace } from "@/lib/erp/workspace";
import { loadNotificationCentre } from "@/lib/erp/loaders";
import { Badge, EmptyState, Kpi, Notice, PageHead, humanise } from "@/components/erp/ErpBits";
import { markAllNotificationsReadAction, markNotificationReadAction } from "../actions";
import { NOTIFICATION_KIND_LABELS, NOTIFICATION_PRIORITY_LABELS, isActionablePriority, notificationKind } from "@/lib/erp/notifications";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * The notification centre.
 *
 * Everything here is a stored row for this tenant: what raised it, who it is for, whether this
 * person has read it and whether anything was delivered outside the product. Unread first because a
 * notification list that is not ordered by "needs you" is just an activity feed.
 */
export default async function NotificationsPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { businessId } = await params;
  const query = await searchParams;
  const workspace = await loadErpWorkspace(businessId);
  const unreadOnly = query.filter === "unread";
  const centre = await loadNotificationCentre(businessId, { userId: workspace.session.userId, role: workspace.role }, { unreadOnly });
  const error = typeof query.error === "string" ? query.error : null;
  const ok = typeof query.ok === "string" ? query.ok : null;
  const base = workspace.basePath;

  return (
    <>
      <PageHead
        title="Notifications"
        description="Work assigned to you, overdue items, orders and campaign results. These are in-app notices — nothing here was sent by SMS, WhatsApp or email."
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {ok ? <Notice tone="success">{ok}</Notice> : null}

      <dl className="erp-grid erp-grid-3">
        <Kpi label="Unread" value={String(centre.unread)} hint={centre.unread ? "Waiting for you" : "You are up to date"} />
        <Kpi label="Shown here" value={String(centre.notifications.length)} hint={unreadOnly ? "Unread only" : "Newest first"} />
        <Kpi label="Stored for this business" value={String(centre.stored)} hint="Everyone's notices, all time" />
      </dl>

      <div className="erp-page-head" style={{ alignItems: "center" }}>
        <div className="erp-actions" style={{ flexWrap: "nowrap" }} aria-label="Filter notifications">
          <Link href={`${base}/notifications`} className="erp-btn erp-btn-sm" aria-current={!unreadOnly ? "page" : undefined} data-active={!unreadOnly}>All</Link>
          <Link href={`${base}/notifications?filter=unread`} className="erp-btn erp-btn-sm" aria-current={unreadOnly ? "page" : undefined} data-active={unreadOnly}>Unread</Link>
        </div>
        {centre.unread > 0 ? (
          <form action={markAllNotificationsReadAction}>
            <input type="hidden" name="businessId" value={businessId} />
            <input type="hidden" name="filter" value={unreadOnly ? "unread" : "all"} />
            <button className="erp-btn erp-btn-sm erp-btn-secondary" type="submit">Mark all as read</button>
          </form>
        ) : null}
      </div>

      <section className="erp-card" aria-labelledby="notifications-heading">
        <h2 id="notifications-heading" className="sr-only">Your notifications</h2>
        {centre.notifications.length === 0 ? (
          <EmptyState glyph="✉" title={unreadOnly ? "Nothing unread" : "No notifications yet"}>
            <p>
              {unreadOnly
                ? "You have read everything addressed to you."
                : "Work assigned to you, overdue tasks, online orders and campaign results appear here. You can keep working; nothing is waiting."}
            </p>
          </EmptyState>
        ) : (
          <ul className="erp-list">
            {centre.notifications.map((notification: any) => {
              const read = Boolean(notification.read);
              const kind = notificationKind(notification.kind);
              return (
                <li
                  key={notification.id}
                  style={{ display: "grid", gap: 6, padding: "12px 0", borderBottom: "1px solid var(--erp-line)" }}
                  data-read={read}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <strong className="erp-small">{notification.title}</strong>
                    {read ? null : <Badge tone="lime">New</Badge>}
                    <Badge tone={isActionablePriority(notification.priority) ? "bad" : "neutral"}>
                      {NOTIFICATION_PRIORITY_LABELS[notification.priority as keyof typeof NOTIFICATION_PRIORITY_LABELS] ?? humanise(notification.priority)}
                    </Badge>
                    <span className="erp-small erp-muted">{NOTIFICATION_KIND_LABELS[kind]}</span>
                    <span className="erp-small erp-muted">· {formatDate(notification.createdAt)}</span>
                  </div>
                  <p className="erp-small erp-muted" style={{ margin: 0 }}>{notification.body}</p>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    {notification.href ? (
                      <Link className="erp-small erp-strong" href={String(notification.href)}>Open →</Link>
                    ) : null}
                    {read ? (
                      <span className="erp-small erp-muted">Read</span>
                    ) : (
                      <form action={markNotificationReadAction} style={{ display: "inline" }}>
                        <input type="hidden" name="businessId" value={businessId} />
                        <input type="hidden" name="notificationId" value={notification.id} />
                        <input type="hidden" name="filter" value={unreadOnly ? "unread" : "all"} />
                        <button className="erp-btn erp-btn-sm erp-btn-secondary" type="submit">Mark as read</button>
                      </form>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="erp-footer">
        Notifications are stored for this business only. Delivery outside the product is switched off in this release, so a notice cannot cost you anything.
      </p>
    </>
  );
}
