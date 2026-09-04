"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@astryxdesign/core/Button";

/**
 * Submit button that reflects the enclosing <form> action's pending state.
 * Must be rendered inside a <form action={serverAction}>.
 */
export function SubmitButton({
  label,
  pendingLabel,
  variant = "secondary",
  size = "md",
  disabled,
}: {
  label: string;
  pendingLabel: string;
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      label={pending ? pendingLabel : label}
      variant={variant}
      size={size}
      isLoading={pending}
      isDisabled={disabled}
    />
  );
}
