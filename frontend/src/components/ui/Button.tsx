import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "gold" | "outline" | "ghost" | "danger";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const variantClass: Record<Variant, string> = {
  gold: "btn-gold",
  outline: "btn-outline",
  ghost: "text-sand-50 hover:bg-app-subtle/60 px-4 py-2 rounded",
  danger: "bg-danger/20 text-danger border border-danger/40 px-4 py-2 rounded hover:bg-danger/30",
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "gold", loading, leftIcon, rightIcon, children, className = "", disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`btn-base ${variantClass[variant]} ${disabled || loading ? "opacity-60 cursor-not-allowed" : ""} ${className}`}
      {...rest}
    >
      {loading ? (
        <span className="inline-block animate-spin">⟳</span>
      ) : (
        leftIcon
      )}
      {children}
      {rightIcon}
    </button>
  );
});
