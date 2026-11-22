/**
 * Walks a server component's returned element tree without rendering it, so a test can read the
 * exact values a page passes to its presentation components.
 */
type AnyElement = { type?: unknown; props?: Record<string, any> } | null | undefined;

export function walkElements(node: unknown, visit: (element: AnyElement & object) => void): void {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (Array.isArray(node)) { for (const child of node) walkElements(child, visit); return; }
  if (typeof node !== "object") return;
  const element = node as AnyElement & object;
  visit(element);
  const props = element.props;
  if (!props) return;
  for (const value of Object.values(props)) {
    if (value && typeof value === "object") walkElements(value, visit);
  }
}

/** `{ label: value }` for every element that receives both `label` and `value` props (stat tiles). */
export function collectStats(tree: unknown): Record<string, string> {
  const stats: Record<string, string> = {};
  walkElements(tree, (element) => {
    const props = element.props;
    if (props && typeof props.label === "string" && "value" in props) stats[props.label] = String(props.value);
  });
  return stats;
}

/** The first `meta` prop found (AdminPage header line). */
export function findMeta(tree: unknown): string | undefined {
  let meta: string | undefined;
  walkElements(tree, (element) => {
    if (meta === undefined && typeof element.props?.meta === "string" && "title" in (element.props || {})) meta = element.props.meta;
  });
  return meta;
}
