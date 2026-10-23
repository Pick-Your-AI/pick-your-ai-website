import type { ReactNode } from 'react';

export function PartsHead({
  crumbs,
  title,
  description,
  actions,
  tabs,
}: {
  crumbs?: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
}) {
  return (
    <>
      <div className="parts-head">
        <div>
          {crumbs ? <div className="crumbs">{crumbs}</div> : null}
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="parts-head-actions">{actions}</div> : null}
      </div>
      {tabs ? <div className="parts-tabs">{tabs}</div> : null}
    </>
  );
}
