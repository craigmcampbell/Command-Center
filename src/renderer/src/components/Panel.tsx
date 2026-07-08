import type { ReactNode } from "react";

interface PanelProps {
  title: string;
  headerRight?: ReactNode;
  children: ReactNode;
}

export default function Panel({ title, headerRight, children }: PanelProps) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        {headerRight}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}
