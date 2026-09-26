export type FieldDescribedByOptions = {
  hint?: boolean;
  error?: boolean;
};

/** Ids that a field control must set on aria-describedby. Undefined when nothing describes it. */
export function fieldDescribedBy(id: string, options: FieldDescribedByOptions): string | undefined {
  const ids: string[] = [];
  if (options.hint) ids.push(`${id}-hint`);
  if (options.error) ids.push(`${id}-error`);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

/** Props that must be applied to the control itself, not only the wrapper. */
export function controlA11yProps(id: string, options: FieldDescribedByOptions) {
  const describedBy = fieldDescribedBy(id, options);
  return {
    id,
    "aria-describedby": describedBy,
    "aria-invalid": options.error ? true : undefined,
  };
}
