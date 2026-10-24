import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CardItem,
  DebtInput,
  DebtItem,
  DebtOneTimePayment,
  DebtPlanSettings,
  YnabAccountsResult,
} from "../../../shared/types";
import {
  DEBT_STRATEGIES,
  MAX_MONTHS,
  addMonths,
  simulate,
  type DebtStrategy,
  type SimResult,
} from "../../../shared/debtPlan";
import {
  buildDebtMarkdown,
  formatDuration,
  formatMoney,
  formatMonth,
  planStartMonth,
  resolveDebts,
  toSimDebts,
  type ResolvedDebt,
} from "../lib/debtPlanView";
import Panel from "./Panel";
import Select from "./Select";
import { IconArrowUp, IconCheck, IconPencil, IconPlus, IconTrash, IconX } from "./icons";

interface DebtTabProps {
  ynabAccounts: YnabAccountsResult | null;
  cards: CardItem[];
}

const DEFAULT_PLAN: DebtPlanSettings = {
  extra: 0,
  strategy: "avalanche",
  startsNextMonth: false,
  customOrder: [],
};

const SERIES_COLORS = ["#5c7fd1", "#5fb8a6", "#d1a05f", "#d1795f", "#9a7fd1", "#7fb0d1", "#c4d17f", "#d17fa8"];
const SCHEDULE_PREVIEW_ROWS = 24;

function parseMoney(text: string): number | null {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// ---- debt form (add + edit share it) ----

interface DebtDraft {
  name: string;
  balance: string;
  apr: string;
  minPayment: string;
  payInFull: string;
  payInFullAuto: boolean;
  ynabAccountId: string;
  cardId: string;
}

const EMPTY_DRAFT: DebtDraft = {
  name: "",
  balance: "",
  apr: "",
  minPayment: "",
  payInFull: "",
  payInFullAuto: true,
  ynabAccountId: "",
  cardId: "",
};

function draftFromDebt(d: DebtItem): DebtDraft {
  return {
    name: d.name,
    balance: d.balance === null ? "" : String(d.balance),
    apr: String(d.apr),
    minPayment: String(d.minPayment),
    payInFull: d.payInFullSpending ? String(d.payInFullSpending) : "",
    payInFullAuto: d.payInFullAuto,
    ynabAccountId: d.ynabAccountId ?? "",
    cardId: d.cardId === null ? "" : String(d.cardId),
  };
}

function inputFromDraft(d: DebtDraft): DebtInput | null {
  const apr = parseMoney(d.apr);
  const minPayment = parseMoney(d.minPayment);
  if (!d.name.trim() || apr === null || minPayment === null) return null;
  const balance = d.balance.trim() === "" ? null : parseMoney(d.balance);
  if (d.balance.trim() !== "" && balance === null) return null;
  // An unlinked debt has nowhere to get a balance from.
  if (balance === null && !d.ynabAccountId) return null;
  const payInFull = d.payInFull.trim() === "" ? 0 : parseMoney(d.payInFull);
  if (payInFull === null) return null;
  return {
    name: d.name.trim(),
    balance,
    apr,
    minPayment,
    payInFullSpending: payInFull,
    payInFullAuto: d.payInFullAuto,
    ynabAccountId: d.ynabAccountId || null,
    cardId: d.cardId ? Number(d.cardId) : null,
  };
}

function DebtForm({
  initial,
  cards,
  ynabAccounts,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: DebtDraft;
  cards: CardItem[];
  ynabAccounts: YnabAccountsResult | null;
  submitLabel: string;
  onSubmit: (input: DebtInput) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const set = (patch: Partial<DebtDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const input = inputFromDraft(draft);
  const accounts = ynabAccounts?.ok ? ynabAccounts.accounts : [];

  function pickCard(value: string) {
    const card = cards.find((c) => String(c.id) === value);
    if (!card) return set({ cardId: "" });
    // A one-time prefill, not a live link: the debt keeps its own figures after.
    set({
      cardId: value,
      name: draft.name.trim() ? draft.name : card.name,
      apr: String(card.apr),
      ynabAccountId: card.ynabAccountId ?? draft.ynabAccountId,
    });
  }

  function submit() {
    if (!input) return;
    onSubmit(input);
    if (!onCancel) setDraft(EMPTY_DRAFT);
  }

  return (
    <div className="debt-form" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), submit())}>
      <label className="debt-field debt-field-wide">
        <span>Name</span>
        <input className="settings-input" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Chase Sapphire, Car loan…" />
      </label>
      <label className="debt-field">
        <span>Balance override</span>
        <input
          className="settings-input"
          inputMode="decimal"
          value={draft.balance}
          onChange={(e) => set({ balance: e.target.value })}
          placeholder={draft.ynabAccountId ? "Live from YNAB" : "Required"}
        />
      </label>
      <label className="debt-field">
        <span>APR %</span>
        <input className="settings-input" inputMode="decimal" value={draft.apr} onChange={(e) => set({ apr: e.target.value })} placeholder="24.99" />
      </label>
      <label className="debt-field">
        <span>Minimum payment</span>
        <input className="settings-input" inputMode="decimal" value={draft.minPayment} onChange={(e) => set({ minPayment: e.target.value })} placeholder="120" />
      </label>
      {draft.ynabAccountId && draft.payInFullAuto ? (
        <div className="debt-field">
          <span>Pay-in-full spending</span>
          <span className="debt-auto-note">This month's spending in YNAB</span>
        </div>
      ) : (
        <label className="debt-field">
          <span>Pay-in-full spending</span>
          <input className="settings-input" inputMode="decimal" value={draft.payInFull} onChange={(e) => set({ payInFull: e.target.value })} placeholder="0" />
        </label>
      )}
      <div className="debt-field">
        <span>YNAB account</span>
        <Select
          value={draft.ynabAccountId}
          onChange={(v) => set({ ynabAccountId: v })}
          options={[{ value: "", label: "Not linked" }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
        />
      </div>
      <div className="debt-field">
        <span>Prefill from card</span>
        <Select
          value={draft.cardId}
          onChange={pickCard}
          options={[{ value: "", label: "None" }, ...cards.map((c) => ({ value: String(c.id), label: c.name }))]}
        />
      </div>
      {draft.ynabAccountId && (
        <label className="debt-check">
          <input type="checkbox" checked={draft.payInFullAuto} onChange={(e) => set({ payInFullAuto: e.target.checked })} />
          Work out pay-in-full spending from this month's YNAB charges
        </label>
      )}
      <div className="debt-form-actions">
        <button className="row-action always-visible" onClick={submit} disabled={!input} aria-label={submitLabel} title={submitLabel}>
          {onCancel ? <IconCheck /> : <IconPlus />}
        </button>
        {onCancel && (
          <button className="row-action always-visible" onClick={onCancel} aria-label="Cancel" title="Cancel">
            <IconX />
          </button>
        )}
      </div>
      <p className="debt-help">
        Minimum payment is the issuer's required minimum only — don't include what you pay to clear new spending.
        Pay-in-full spending is the charges already on the card from this month that you'll pay off in full. It is
        subtracted from a live YNAB balance (automatically from this month's non-transfer YNAB transactions, or the
        amount you type); a balance override is used as the carried balance as-is.
      </p>
    </div>
  );
}

function DebtRowView({
  resolved,
  index,
  count,
  cards,
  ynabAccounts,
  onSave,
  onDelete,
  onMove,
}: {
  resolved: ResolvedDebt;
  index: number;
  count: number;
  cards: CardItem[];
  ynabAccounts: YnabAccountsResult | null;
  onSave: (input: DebtInput) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [editing, setEditing] = useState(false);
  const { debt } = resolved;

  if (editing) {
    return (
      <li className="debt-row debt-row-editing">
        <DebtForm
          initial={draftFromDebt(debt)}
          cards={cards}
          ynabAccounts={ynabAccounts}
          submitLabel="Save"
          onSubmit={(input) => {
            onSave(input);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  let detail: string;
  if (resolved.source === "missing") {
    detail = debt.ynabAccountId ? "Linked account not found — set a balance override" : "No balance set";
  } else if (resolved.paidOff) {
    detail = "Paid off";
  } else if (resolved.source === "ynab") {
    if (resolved.spendingUnknown) {
      detail = "Live from YNAB — this month's spending couldn't be read, so none is subtracted";
    } else if (resolved.payInFull > 0) {
      detail = `${formatMoney(resolved.live ?? 0, true)} live − ${formatMoney(resolved.payInFull, true)} ${
        debt.payInFullAuto ? "spent this month" : "pay-in-full"
      }`;
    } else {
      detail = "Live from YNAB";
    }
  } else {
    detail = "Manual balance";
  }

  return (
    <li className="debt-row">
      <div className="debt-row-main">
        <span className="debt-row-name">{debt.name}</span>
        <span className="muted">{detail}</span>
        {resolved.drift !== null && (
          <span className="debt-drift">Balance is {formatMoney(resolved.drift, true)} higher than your plan assumes</span>
        )}
      </div>
      <span className={`debt-row-balance${resolved.paidOff ? " paid" : ""}`}>{formatMoney(resolved.carried, true)}</span>
      <span className="debt-row-meta">{debt.apr}% APR</span>
      <span className="debt-row-meta">{formatMoney(debt.minPayment, true)} min</span>
      <span className="debt-row-actions">
        <button className="row-action always-visible" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up" title="Move up (tie-break order)">
          <IconArrowUp />
        </button>
        <button className="row-action always-visible debt-flip" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move down" title="Move down">
          <IconArrowUp />
        </button>
        <button className="row-action always-visible" onClick={() => setEditing(true)} aria-label="Edit" title="Edit">
          <IconPencil />
        </button>
        <button className="row-action always-visible danger" onClick={onDelete} aria-label="Delete" title="Delete">
          <IconTrash />
        </button>
      </span>
    </li>
  );
}

// ---- one-time payments ----

function OneTimeRow({
  payment,
  debts,
  onSave,
  onDelete,
}: {
  payment: DebtOneTimePayment;
  debts: DebtItem[];
  onSave: (month: string, amount: number, target: number | null) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [month, setMonth] = useState(payment.month);
  const [amount, setAmount] = useState(String(payment.amount));
  const [target, setTarget] = useState(payment.targetDebtId === null ? "" : String(payment.targetDebtId));
  const targetName =
    payment.targetDebtId === null
      ? "Follows strategy"
      : (debts.find((d) => d.id === payment.targetDebtId)?.name ?? "Removed debt");
  const amt = parseMoney(amount);

  if (!editing) {
    return (
      <li className="debt-row">
        <span className="debt-row-name">{formatMonth(payment.month)}</span>
        <span className="debt-row-balance">{formatMoney(payment.amount, true)}</span>
        <span className="muted debt-grow">{targetName}</span>
        <span className="debt-row-actions">
          <button className="row-action always-visible" onClick={() => setEditing(true)} aria-label="Edit" title="Edit">
            <IconPencil />
          </button>
          <button className="row-action always-visible danger" onClick={onDelete} aria-label="Delete" title="Delete">
            <IconTrash />
          </button>
        </span>
      </li>
    );
  }
  return (
    <li className="debt-row debt-row-editing">
      <OneTimeFields month={month} amount={amount} target={target} debts={debts} setMonth={setMonth} setAmount={setAmount} setTarget={setTarget} />
      <button
        className="row-action always-visible"
        disabled={amt === null || amt === 0 || !month}
        onClick={() => {
          onSave(month, amt as number, target ? Number(target) : null);
          setEditing(false);
        }}
        aria-label="Save"
      >
        <IconCheck />
      </button>
      <button className="row-action always-visible" onClick={() => setEditing(false)} aria-label="Cancel">
        <IconX />
      </button>
    </li>
  );
}

function OneTimeFields(props: {
  month: string;
  amount: string;
  target: string;
  debts: DebtItem[];
  setMonth: (v: string) => void;
  setAmount: (v: string) => void;
  setTarget: (v: string) => void;
}) {
  return (
    <>
      <input className="settings-input" type="month" value={props.month} onChange={(e) => props.setMonth(e.target.value)} aria-label="Month" />
      <input className="settings-input debt-amount" inputMode="decimal" value={props.amount} onChange={(e) => props.setAmount(e.target.value)} placeholder="Amount" aria-label="Amount" />
      <div className="debt-grow">
        <Select
          value={props.target}
          onChange={props.setTarget}
          options={[{ value: "", label: "Follow strategy" }, ...props.debts.map((d) => ({ value: String(d.id), label: d.name }))]}
        />
      </div>
    </>
  );
}

function OneTimeAddRow({ debts, defaultMonth, onAdd }: { debts: DebtItem[]; defaultMonth: string; onAdd: (month: string, amount: number, target: number | null) => void }) {
  const [month, setMonth] = useState(defaultMonth);
  const [amount, setAmount] = useState("");
  const [target, setTarget] = useState("");
  const amt = parseMoney(amount);
  return (
    <li className="debt-row debt-row-editing">
      <OneTimeFields month={month} amount={amount} target={target} debts={debts} setMonth={setMonth} setAmount={setAmount} setTarget={setTarget} />
      <button
        className="row-action always-visible"
        disabled={amt === null || amt === 0 || !month}
        onClick={() => {
          onAdd(month, amt as number, target ? Number(target) : null);
          setAmount("");
        }}
        aria-label="Add one-time payment"
      >
        <IconPlus />
      </button>
    </li>
  );
}

// ---- results ----

function StackedChart({ result, debts }: { result: SimResult; debts: { id: number; name: string }[] }) {
  const W = 640;
  const H = 180;
  const PAD = 6;
  const months = result.months;
  if (months.length < 2) return null;
  // Thin very long projections so the path stays small; always keep the last month.
  const stride = Math.max(1, Math.ceil(months.length / 240));
  const picked = months.filter((m, i) => i % stride === 0 || i === months.length - 1);
  const max = Math.max(...picked.map((m) => m.balance), 1);
  const x = (i: number) => PAD + (i / (picked.length - 1)) * (W - PAD * 2);
  const y = (v: number) => PAD + (1 - v / max) * (H - PAD * 2);

  const layers = debts.map((d, di) => {
    const lower = picked.map((m) => debts.slice(0, di).reduce((s, o) => s + (m.perDebt.find((p) => p.debtId === o.id)?.balance ?? 0), 0));
    const upper = picked.map((m, i) => lower[i] + (m.perDebt.find((p) => p.debtId === d.id)?.balance ?? 0));
    const top = upper.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const bottom = lower
      .map((v, i) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`)
      .reverse()
      .join(" ");
    return { d, path: `${top} ${bottom} Z`, color: SERIES_COLORS[di % SERIES_COLORS.length] };
  });

  return (
    <div className="debt-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Balance over time, stacked by debt">
        {layers.map((l) => (
          <path key={l.d.id} d={l.path} fill={l.color} fillOpacity={0.55} stroke={l.color} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="debt-chart-axis">
        <span>{formatMonth(picked[0].month)}</span>
        <span>{formatMoney(max)} peak</span>
        <span>{formatMonth(picked[picked.length - 1].month)}</span>
      </div>
      <div className="debt-legend">
        {layers.map((l) => (
          <span key={l.d.id}>
            <i style={{ background: l.color }} />
            {l.d.name}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---- the tab ----

export default function DebtTab({ ynabAccounts, cards }: DebtTabProps) {
  const [debts, setDebts] = useState<DebtItem[]>([]);
  const [oneTimes, setOneTimes] = useState<DebtOneTimePayment[]>([]);
  const [plan, setPlan] = useState<DebtPlanSettings>(DEFAULT_PLAN);
  const [loaded, setLoaded] = useState(false);
  const [extraText, setExtraText] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<DebtPlanSettings | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([window.api.debts.list(), window.api.debts.oneTimeList(), window.api.debts.getPlan()]).then(
      ([d, o, p]) => {
        if (!alive) return;
        setDebts(d);
        setOneTimes(o);
        setPlan(p);
        setExtraText(p.extra ? String(p.extra) : "");
        setLoaded(true);
      }
    );
    return () => {
      alive = false;
    };
  }, []);

  // Plan edits recompute instantly; the write is debounced and flushed on unmount.
  const flush = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (pending.current) {
      void window.api.debts.setPlan(pending.current);
      pending.current = null;
    }
  }, []);
  useEffect(() => flush, [flush]);

  function updatePlan(patch: Partial<DebtPlanSettings>) {
    const next = { ...plan, ...patch };
    setPlan(next);
    pending.current = next;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 400);
  }

  const accounts = ynabAccounts?.ok ? ynabAccounts.accounts : null;

  // This month's spending for debts that work out pay-in-full from YNAB. Refetched
  // whenever the accounts poll lands (it's delta-cached upstream, so cheap).
  const [spending, setSpending] = useState<Record<string, number> | null>(null);
  const autoIds = useMemo(
    () =>
      Array.from(new Set(debts.filter((d) => d.payInFullAuto && d.ynabAccountId).map((d) => d.ynabAccountId as string))).sort(),
    [debts]
  );
  const autoKey = autoIds.join(",");
  useEffect(() => {
    if (autoIds.length === 0) {
      setSpending(null);
      return;
    }
    let alive = true;
    window.api.ynab.monthSpending(autoIds).then((r) => {
      if (alive) setSpending(r.ok ? r.spending : null);
    });
    return () => {
      alive = false;
    };
    // autoIds is derived from autoKey; ynabAccounts re-triggers on each YNAB poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoKey, ynabAccounts]);

  const resolved = useMemo(() => resolveDebts(debts, accounts, spending), [debts, accounts, spending]);
  const startMonth = planStartMonth(new Date(), plan.startsNextMonth);

  const results = useMemo(() => {
    const simDebts = toSimDebts(resolved);
    const customOrder = plan.customOrder;
    return Object.fromEntries(
      DEBT_STRATEGIES.map((s) => [
        s.id,
        simulate({
          debts: simDebts,
          strategy: s.id,
          extra: plan.extra,
          oneTimes,
          startMonth,
          customOrder,
        }),
      ])
    ) as Record<DebtStrategy, SimResult>;
  }, [resolved, plan.extra, plan.customOrder, oneTimes, startMonth]);

  const selected = results[plan.strategy];
  const baseline = results.minimums;
  const active = resolved.filter((r) => !r.paidOff && r.source !== "missing");
  const activeSim = active.map((r) => ({ id: r.debt.id, name: r.debt.name }));
  const nameOf = (id: number) => debts.find((d) => d.id === id)?.name ?? "Removed debt";
  const missing = resolved.filter((r) => r.source === "missing");
  const underwater = active.filter((r) => r.debt.apr > 0 && r.debt.minPayment <= (r.carried * r.debt.apr) / 1200);

  // Custom order shown in full, with any debt not yet ranked appended.
  const customList = useMemo(() => {
    const ranked = plan.customOrder.filter((id) => active.some((a) => a.debt.id === id));
    const rest = active.map((a) => a.debt.id).filter((id) => !ranked.includes(id));
    return [...ranked, ...rest];
  }, [plan.customOrder, active]);

  function moveCustom(id: number, dir: -1 | 1) {
    const list = [...customList];
    const i = list.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    updatePlan({ customOrder: list });
  }

  async function moveDebt(id: number, dir: -1 | 1) {
    const ids = debts.map((d) => d.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setDebts(await window.api.debts.reorder(ids));
  }

  async function handleExport() {
    flush();
    const today = new Date();
    const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const markdown = buildDebtMarkdown({ exportedOn: stamp, plan, startMonth, resolved, oneTimes, results });
    const res = await window.api.debts.exportMarkdown(markdown, `debt-plan-${stamp}.md`);
    if (res.canceled) return setExportMsg(null);
    setExportMsg(res.ok ? "Exported" : (res.reason ?? "Export failed"));
  }

  if (!loaded) {
    return (
      <Panel title="Debt plan">
        <p className="muted">Loading…</p>
      </Panel>
    );
  }

  const interestSaved = selected.debtFreeMonth && baseline.debtFreeMonth ? baseline.totalInterest - selected.totalInterest : null;
  const monthsSaved = selected.debtFreeMonth && baseline.debtFreeMonth ? baseline.months.length - selected.months.length : null;
  const scheduleRows = showAll ? selected.months : selected.months.slice(0, SCHEDULE_PREVIEW_ROWS);

  return (
    <>
      <div className="slot slot-debt-plan">
        <Panel
          title="Plan"
          headerRight={
            <span className="muted">
              {active.length} active {active.length === 1 ? "debt" : "debts"} ·{" "}
              {formatMoney(active.reduce((s, r) => s + r.carried, 0))} carried
            </span>
          }
        >
          <div className="debt-plan-controls">
            <label className="debt-field">
              <span>Extra per month</span>
              <input
                className="settings-input"
                inputMode="decimal"
                value={extraText}
                placeholder="0"
                onChange={(e) => {
                  setExtraText(e.target.value);
                  updatePlan({ extra: parseMoney(e.target.value) ?? 0 });
                }}
              />
            </label>
            <div className="debt-field">
              <span>Starts</span>
              <Select
                value={plan.startsNextMonth ? "next" : "this"}
                onChange={(v) => updatePlan({ startsNextMonth: v === "next" })}
                options={[
                  { value: "this", label: `This month (${formatMonth(planStartMonth(new Date(), false))})` },
                  { value: "next", label: `Next month (${formatMonth(planStartMonth(new Date(), true))})` },
                ]}
              />
            </div>
          </div>

          <h3 className="debt-subhead">Debts</h3>
          {debts.length === 0 && <p className="muted">No debts yet — add one below.</p>}
          <ul className="debt-list">
            {resolved.map((r, i) => (
              <DebtRowView
                key={r.debt.id}
                resolved={r}
                index={i}
                count={resolved.length}
                cards={cards}
                ynabAccounts={ynabAccounts}
                onSave={async (input) => setDebts(await window.api.debts.update(r.debt.id, input))}
                onDelete={async () => {
                  setDebts(await window.api.debts.remove(r.debt.id));
                  setOneTimes(await window.api.debts.oneTimeList());
                }}
                onMove={(dir) => moveDebt(r.debt.id, dir)}
              />
            ))}
          </ul>
          <DebtForm
            key={debts.length}
            initial={EMPTY_DRAFT}
            cards={cards}
            ynabAccounts={ynabAccounts}
            submitLabel="Add debt"
            onSubmit={async (input) => setDebts(await window.api.debts.add(input))}
          />

          <h3 className="debt-subhead">One-time payments</h3>
          <ul className="debt-list">
            {oneTimes.length === 0 && <li className="muted">None scheduled.</li>}
            {oneTimes.map((o) => (
              <OneTimeRow
                key={o.id}
                payment={o}
                debts={debts}
                onSave={async (month, amount, target) =>
                  setOneTimes(await window.api.debts.oneTimeUpdate(o.id, { month, amount, targetDebtId: target }))
                }
                onDelete={async () => setOneTimes(await window.api.debts.oneTimeRemove(o.id))}
              />
            ))}
            <OneTimeAddRow
              debts={debts}
              defaultMonth={startMonth}
              onAdd={async (month, amount, target) =>
                setOneTimes(await window.api.debts.oneTimeAdd({ month, amount, targetDebtId: target }))
              }
            />
          </ul>
          {oneTimes.some((o) => o.month < startMonth) && (
            <p className="debt-help">Payments dated before {formatMonth(startMonth)} are ignored by the projection.</p>
          )}
        </Panel>
      </div>

      <div className="slot slot-debt-strategies">
        <Panel title="Strategies">
          {missing.length > 0 && (
            <p className="debt-warn">
              {missing.map((m) => m.debt.name).join(", ")} {missing.length === 1 ? "has" : "have"} no balance and{" "}
              {missing.length === 1 ? "is" : "are"} left out of the projection.
            </p>
          )}
          {active.length === 0 ? (
            <p className="muted">Add a debt with a balance to see a payoff plan.</p>
          ) : (
            <>
              <div className="debt-strategy-row" role="radiogroup" aria-label="Payoff strategy">
                {DEBT_STRATEGIES.map((s) => {
                  const r = results[s.id];
                  const saved = s.id !== "minimums" && r.debtFreeMonth && baseline.debtFreeMonth ? baseline.totalInterest - r.totalInterest : null;
                  return (
                    <button
                      key={s.id}
                      role="radio"
                      aria-checked={plan.strategy === s.id}
                      className={`debt-strategy${plan.strategy === s.id ? " active" : ""}`}
                      onClick={() => updatePlan({ strategy: s.id })}
                    >
                      <span className="debt-strategy-name">{s.label}</span>
                      <span className="muted">{s.blurb}</span>
                      <span className="debt-strategy-date">{r.debtFreeMonth ? formatMonth(r.debtFreeMonth) : "Never"}</span>
                      <span className="muted">
                        {r.debtFreeMonth ? formatDuration(r.months.length) : `Not paid off in ${MAX_MONTHS / 12} years`}
                      </span>
                      <span className="debt-strategy-interest">{formatMoney(r.totalInterest)} interest</span>
                      {saved !== null && saved >= 1 && <span className="debt-saved">saves {formatMoney(saved)}</span>}
                    </button>
                  );
                })}
              </div>

              {plan.strategy === "custom" && (
                <ol className="debt-custom-order">
                  {customList.map((id, i) => (
                    <li key={id}>
                      <span className="debt-custom-rank">{i + 1}</span>
                      <span className="debt-grow">{nameOf(id)}</span>
                      <button className="row-action always-visible" disabled={i === 0} onClick={() => moveCustom(id, -1)} aria-label="Move up">
                        <IconArrowUp />
                      </button>
                      <button className="row-action always-visible debt-flip" disabled={i === customList.length - 1} onClick={() => moveCustom(id, 1)} aria-label="Move down">
                        <IconArrowUp />
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </Panel>
      </div>

      {active.length > 0 && (
        <div className="slot slot-debt-detail">
          <Panel
            title={`${DEBT_STRATEGIES.find((s) => s.id === plan.strategy)?.label} detail`}
            headerRight={
              <span className="debt-export">
                {exportMsg && <span className="muted">{exportMsg}</span>}
                <button className="debt-btn" onClick={handleExport}>
                  Export Markdown
                </button>
              </span>
            }
          >
            {underwater.length > 0 && (
              <p className="debt-warn">
                {underwater.map((u) => u.debt.name).join(", ")}: the minimum payment doesn't cover the monthly interest, so it
                only shrinks once an extra payment or rollover reaches it.
              </p>
            )}
            <div className="debt-summary">
              <div>
                <span className="muted">Debt-free</span>
                <strong>{selected.debtFreeMonth ? formatMonth(selected.debtFreeMonth) : "Never"}</strong>
                <span className="muted">{selected.debtFreeMonth ? formatDuration(selected.months.length) : "within 50 years"}</span>
              </div>
              <div>
                <span className="muted">Total interest</span>
                <strong>{formatMoney(selected.totalInterest)}</strong>
                <span className="muted">of {formatMoney(selected.totalPaid)} paid</span>
              </div>
              {plan.strategy !== "minimums" && (
                <div>
                  <span className="muted">Versus minimums only</span>
                  <strong className="debt-saved">{interestSaved === null ? "—" : `${formatMoney(interestSaved)} saved`}</strong>
                  <span className="muted">{monthsSaved === null ? "" : `${formatDuration(monthsSaved)} sooner`}</span>
                </div>
              )}
            </div>

            <StackedChart result={selected} debts={activeSim} />

            <h3 className="debt-subhead">Payoff order</h3>
            {selected.payoffs.length === 0 ? (
              <p className="muted">Nothing is paid off within 50 years at these payments.</p>
            ) : (
              <ol className="debt-payoffs">
                {selected.payoffs.map((p) => (
                  <li key={p.debtId}>
                    <span className="debt-grow">{nameOf(p.debtId)}</span>
                    <span>{formatMonth(p.month)}</span>
                    <span className="muted">month {p.monthIndex + 1}</span>
                  </li>
                ))}
              </ol>
            )}

            <h3 className="debt-subhead">Month by month</h3>
            <div className="debt-schedule-wrap">
              <table className="ynab-table debt-schedule">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Paid</th>
                    <th>Interest</th>
                    <th>Balance</th>
                    {activeSim.map((d) => (
                      <th key={d.id} title={d.name}>
                        {d.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {scheduleRows.map((m) => (
                    <tr key={m.month}>
                      <td>{formatMonth(m.month)}</td>
                      <td>{formatMoney(m.payment, true)}</td>
                      <td>{formatMoney(m.interest, true)}</td>
                      <td>{formatMoney(m.balance, true)}</td>
                      {activeSim.map((d) => (
                        <td key={d.id}>{formatMoney(m.perDebt.find((p) => p.debtId === d.id)?.balance ?? 0, true)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {selected.months.length > SCHEDULE_PREVIEW_ROWS && (
              <button className="debt-btn" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show fewer months" : `Show all ${selected.months.length} months`}
              </button>
            )}
            <p className="debt-help">
              Projection assumes no new charges and fixed APRs. It models only the carried balance — payments that clear
              current spending are not part of it. Month 1 is {formatMonth(startMonth)}; month {selected.months.length} ends{" "}
              {formatMonth(addMonths(startMonth, Math.max(0, selected.months.length - 1)))}.
            </p>
          </Panel>
        </div>
      )}
    </>
  );
}
