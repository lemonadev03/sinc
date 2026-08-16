"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

/**
 * Submit button that reflects the enclosing <form> action's pending state.
 * Must be rendered inside a <form action={serverAction}>.
 */
export function SubmitButton({
  children,
  pendingLabel,
  className,
  disabled,
}: {
  children: ReactNode;
  pendingLabel: string;
  className: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending || disabled}>
      {pending ? (
        <span className="inline-flex items-center gap-2">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          {pendingLabel}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
