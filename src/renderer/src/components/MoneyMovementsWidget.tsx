import { useState } from "react";
import type { YnabMoneyMovementsResult } from "../../../shared/types";
import Panel from "./Panel";
import { IconArrowRight } from "./icons";

interface MoneyMovementsWidgetProps {
  data: YnabMoneyMovementsResult | null;
}

const INITIAL = 12;

function formatAmount(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDate(date: string | null, month: string | null): string {
  const day = date ?? month;
  if (!day) return "";
  const label = new Date(day.slice(0, 10) + "T12:00:00");
  return date
    ? label.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : label.toLocaleDateString("en-US", { month: "short" });
}

export default function MoneyMovementsWidget({ data }: MoneyMovementsWidgetProps) {
  const [showAll, setShowAll] = useState(false);

  let body;
  if (!data) {
    body = <p className="muted">Loading money movements…</p>;
  } else if (!data.ok) {
    body = <p className="muted">{data.reason}</p>;
  } else if (data.movements.length === 0) {
    body = <p className="muted">No money has been moved between categories.</p>;
  } else {
    const shown = showAll ? data.movements : data.movements.slice(0, INITIAL);
    body = (
      <>
        <table className="ynab-table movements-table">
          <tbody>
            {shown.map((m) => (
              <tr key={m.id}>
                <td className="movement-date">{formatDate(m.date, m.month)}</td>
                <td className="movement-route">
                  <span>{m.fromName}</span>
                  <IconArrowRight className="movement-arrow" />
                  <span>{m.toName}</span>
                </td>
                <td className="movement-note muted">{m.note ?? ""}</td>
                <td className="ynab-balance">{formatAmount(m.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.movements.length > INITIAL && (
          <button type="button" className="row-action trend-more" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show fewer" : `Show all ${data.movements.length}`}
          </button>
        )}
      </>
    );
  }

  return (
    <Panel title="Money Movements" headerRight={data?.ok ? <span className="pip live"></span> : undefined}>
      {body}
    </Panel>
  );
}
