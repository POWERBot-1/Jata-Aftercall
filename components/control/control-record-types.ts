export type RecordKind = "subscriptions" | "payments" | "agents" | "commissions";
export type RecordList = { items: any[]; nextCursor: string | null; loading: boolean; error: string };
