import { forwardRef, type InputHTMLAttributes } from "react";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string | null;
  hint?: string;
}

export const Field = forwardRef<HTMLInputElement, Props>(function Field(
  { label, error, hint, className = "", id, ...rest },
  ref,
) {
  const inputId = id ?? rest.name;
  return (
    <div className="w-full">
      {label && <label className="field-label" htmlFor={inputId}>{label}</label>}
      <input
        ref={ref}
        id={inputId}
        className={`field-input ${error ? "error" : ""} ${className}`}
        {...rest}
      />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      {!error && hint && <p className="mt-1 text-xs text-sand-100/55">{hint}</p>}
    </div>
  );
});
