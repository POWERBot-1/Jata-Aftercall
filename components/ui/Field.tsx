"use client";

import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { controlA11yProps } from "@/lib/a11y";

type ControlProps = {
  className?: string;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

/**
 * Wires aria-describedby onto the control itself so hints and errors are announced.
 */
export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactElement<ControlProps>;
}) {
  const a11y = controlA11yProps(id, { hint: Boolean(hint), error: Boolean(error) });
  const control = isValidElement(children)
    ? cloneElement(children, {
        ...a11y,
        className: ["jata-input", children.props.className].filter(Boolean).join(" "),
      })
    : children;

  return (
    <div className="jata-field">
      <label htmlFor={id} className="jata-label">
        {label}
      </label>
      {control}
      {hint ? (
        <p id={`${id}-hint`} className="jata-hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="jata-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="jata-error" role="alert">
      {children}
    </p>
  );
}
