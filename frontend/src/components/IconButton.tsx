import type { ButtonHTMLAttributes, ReactNode } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
}

export function IconButton({
  label,
  children,
  className = "",
  ...props
}: IconButtonProps) {
  return (
    <button
      className={`icon-button ${className}`}
      title={label}
      aria-label={label}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

