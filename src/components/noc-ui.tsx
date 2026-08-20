import type { ReactNode } from "react";
import { Check, CircleAlert, CircleHelp, LoaderCircle } from "lucide-react";

export function NocPageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="noc-feature-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div className="noc-feature-header-action">{action}</div>}
    </header>
  );
}

export function NocPanel({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`noc-feature-panel ${className}`}>
      {(title || description || action) && (
        <div className="noc-feature-panel-heading">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {action}
        </div>
      )}
      <div className="noc-feature-panel-body">{children}</div>
    </section>
  );
}

export function NocState({
  kind,
  children,
}: {
  kind: "loading" | "empty" | "error" | "success";
  children: ReactNode;
}) {
  const Icon = kind === "loading"
    ? LoaderCircle
    : kind === "error"
      ? CircleAlert
      : kind === "success"
        ? Check
        : CircleHelp;
  return (
    <div className={`noc-feature-state is-${kind}`} role={kind === "error" ? "alert" : undefined}>
      <Icon aria-hidden="true" className={kind === "loading" ? "is-spinning" : undefined} />
      <span>{children}</span>
    </div>
  );
}

export function NocStatus({
  label,
  tone = "neutral",
  dot = true,
}: {
  label: string;
  tone?: "positive" | "warning" | "danger" | "neutral" | "info";
  dot?: boolean;
}) {
  return (
    <span className={`noc-status-chip is-${tone}`}>
      {dot && <i aria-hidden="true" />}
      {label}
    </span>
  );
}

export function NocMetric({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="noc-feature-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}
