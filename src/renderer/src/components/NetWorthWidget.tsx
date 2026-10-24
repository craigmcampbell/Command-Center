import type { YnabNetWorthResult } from "../../../shared/types";
import Panel from "./Panel";

interface NetWorthWidgetProps {
  data: YnabNetWorthResult | null;
}

const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 110;
const PAD = 8;

function formatAmount(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function monthLabel(month: string): string {
  return new Date(month + "T12:00:00").toLocaleDateString("en-US", { month: "short" });
}

function Chart({ values }: { values: number[] }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series would divide by zero; draw it mid-height instead.
  const span = max - min || 1;
  const stepX = (VIEW_WIDTH - PAD * 2) / Math.max(1, values.length - 1);
  const y = (v: number) => PAD + (1 - (v - min) / span) * (VIEW_HEIGHT - PAD * 2);
  const points = values.map((v, i) => `${(PAD + i * stepX).toFixed(1)},${(max === min ? VIEW_HEIGHT / 2 : y(v)).toFixed(1)}`);
  const line = `M${points.join(" L")}`;
  const area = `${line} L${PAD + (values.length - 1) * stepX},${VIEW_HEIGHT} L${PAD},${VIEW_HEIGHT} Z`;

  return (
    <svg className="networth-chart" viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={area} className="networth-area" />
      <path d={line} className="networth-line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function NetWorthWidget({ data }: NetWorthWidgetProps) {
  let body;
  if (!data) {
    body = <p className="muted">Loading net worth…</p>;
  } else if (!data.ok) {
    body = <p className="muted">{data.reason}</p>;
  } else if (data.points.length === 0) {
    body = <p className="muted">No accounts to total.</p>;
  } else {
    const first = data.points[0];
    const last = data.points[data.points.length - 1];
    const change = last.netWorth - first.netWorth;
    body = (
      <>
        <div className={`networth-total ynab-balance ${data.current < 0 ? "negative" : ""}`}>
          {formatAmount(data.current)}
        </div>
        <div className="muted networth-change">
          {change >= 0 ? "+" : "−"}
          {formatAmount(Math.abs(change))} since {monthLabel(first.month)}
        </div>
        <Chart values={data.points.map((p) => p.netWorth)} />
        <div className="networth-axis">
          <span>{monthLabel(first.month)}</span>
          <span>{monthLabel(last.month)}</span>
        </div>
        <p className="muted networth-note">
          Worked back from today's balances, for the accounts shown above. Hidden accounts are left out.
        </p>
      </>
    );
  }

  return (
    <Panel title="Net Worth" headerRight={data?.ok ? <span className="pip live"></span> : undefined}>
      {body}
    </Panel>
  );
}
