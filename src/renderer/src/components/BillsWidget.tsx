import { useEffect, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import type { BillItem, CardItem, YnabAccount, YnabAccountsResult } from "../../../shared/types";
import Panel from "./Panel";
import { IconCheck, IconNote, IconPencil, IconPlus, IconTrash, IconX } from "./icons";

interface BillsWidgetProps {
  bills: BillItem[];
  onChange: (bills: BillItem[]) => void;
  cards: CardItem[];
  onCardsChange: (cards: CardItem[]) => void;
  ynabAccounts: YnabAccountsResult | null;
}

type Tab = "bills" | "cards";

function formatCurrency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatApr(n: number): string {
  return `${n}%`;
}

function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`;
}

function BillFields({
  label,
  dueDay,
  autopay,
  onLabelChange,
  onDueDayChange,
  onAutopayChange,
}: {
  label: string;
  dueDay: string;
  autopay: boolean;
  onLabelChange: (v: string) => void;
  onDueDayChange: (v: string) => void;
  onAutopayChange: (v: boolean) => void;
}) {
  return (
    <>
      <input
        className="settings-input"
        value={label}
        onChange={(e) => onLabelChange(e.target.value)}
        placeholder="Bill / account"
      />
      <input
        className="settings-input settings-input-narrow"
        type="number"
        min={1}
        max={31}
        value={dueDay}
        onChange={(e) => onDueDayChange(e.target.value)}
        placeholder="Day due"
      />
      <label className="settings-checkbox-label">
        <input
          type="checkbox"
          checked={autopay}
          onChange={(e) => onAutopayChange(e.target.checked)}
        />
        Autopay
      </label>
    </>
  );
}

function isValidDueDay(text: string): boolean {
  const d = Number(text);
  return Number.isInteger(d) && d >= 1 && d <= 31;
}

function EditForm({
  item,
  onSave,
  onCancel,
}: {
  item: BillItem;
  onSave: (label: string, dueDay: number, autopay: boolean) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(item.label);
  const [dueDay, setDueDay] = useState(String(item.dueDay));
  const [autopay, setAutopay] = useState(item.autopay);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const l = label.trim();
    if (!l || !isValidDueDay(dueDay)) return;
    onSave(l, Number(dueDay), autopay);
  }

  return (
    <form className="settings-array-form" onSubmit={handleSubmit}>
      <BillFields
        label={label}
        dueDay={dueDay}
        autopay={autopay}
        onLabelChange={setLabel}
        onDueDayChange={setDueDay}
        onAutopayChange={setAutopay}
      />
      <div className="settings-array-form-actions">
        <button type="submit" className="settings-array-save" aria-label="Save">
          <IconCheck /> Save
        </button>
        <button type="button" className="settings-array-cancel" onClick={onCancel} aria-label="Cancel">
          <IconX /> Cancel
        </button>
      </div>
    </form>
  );
}

// onBlur-save, same pattern as YnabUnapprovedWidget's MemoCell — no
// debounce needed for a field that's only visible while its row is
// expanded, and it avoids writing on every keystroke.
function BillNoteEditor({
  item,
  onSave,
}: {
  item: BillItem;
  onSave: (note: string) => Promise<void>;
}) {
  const [value, setValue] = useState(item.note ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => setValue(item.note ?? ""), [item.note]);

  async function handleBlur() {
    const current = item.note ?? "";
    if (value === current) return;
    setSaving(true);
    await onSave(value);
    setSaving(false);
  }

  return (
    <textarea
      className="bill-note-textarea"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      placeholder="Add a note…"
      disabled={saving}
      rows={2}
    />
  );
}

function BillRow({
  item,
  onSave,
  onSaveNote,
  onDelete,
}: {
  item: BillItem;
  onSave: (label: string, dueDay: number, autopay: boolean) => void;
  onSaveNote: (note: string) => Promise<void>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);

  if (editing) {
    return (
      <div className="settings-array-row editing">
        <EditForm
          item={item}
          onSave={(label, dueDay, autopay) => {
            onSave(label, dueDay, autopay);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="bill-item">
      <div className="settings-array-row">
        <div className="settings-array-row-main">
          <span className="bill-row-label">{ordinal(item.dueDay)}</span>
          <span className="bill-row-sub">{item.label}</span>
        </div>
        <span className={`pip ${item.autopay ? "live" : ""}`}></span>
        <span className="tag">{item.autopay ? "Autopay" : "Manual"}</span>
        <button
          className={`desc-toggle ${item.note ? "has-note" : ""}`}
          onClick={() => setNoteOpen((v) => !v)}
          title={noteOpen ? "Hide note" : "Show note"}
        >
          <IconNote />
        </button>
        <span className="row-actions">
          <button className="row-action" onClick={() => setEditing(true)} aria-label="Edit">
            <IconPencil />
          </button>
          <button className="row-action danger" onClick={onDelete} aria-label="Delete">
            <IconTrash />
          </button>
        </span>
      </div>
      {noteOpen && (
        <div className="bill-expand">
          <BillNoteEditor item={item} onSave={onSaveNote} />
        </div>
      )}
    </div>
  );
}

function AddForm({ onAdd }: { onAdd: (label: string, dueDay: number, autopay: boolean) => void }) {
  const [label, setLabel] = useState("");
  const [dueDay, setDueDay] = useState("");
  const [autopay, setAutopay] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const l = label.trim();
    if (!l || !isValidDueDay(dueDay)) return;
    onAdd(l, Number(dueDay), autopay);
    setLabel("");
    setDueDay("");
    setAutopay(false);
  }

  return (
    <form className="settings-array-form" onSubmit={handleSubmit}>
      <BillFields
        label={label}
        dueDay={dueDay}
        autopay={autopay}
        onLabelChange={setLabel}
        onDueDayChange={setDueDay}
        onAutopayChange={setAutopay}
      />
      <button type="submit" disabled={!label.trim() || !isValidDueDay(dueDay)} aria-label="Add">
        <IconPlus />
      </button>
    </form>
  );
}

function BillsBody({ bills, onChange }: Pick<BillsWidgetProps, "bills" | "onChange">) {
  async function handleAdd(label: string, dueDay: number, autopay: boolean) {
    onChange(await window.api.bills.add(label, dueDay, autopay));
  }
  async function handleSave(id: number, label: string, dueDay: number, autopay: boolean) {
    onChange(await window.api.bills.update(id, label, dueDay, autopay));
  }
  async function handleDelete(id: number) {
    onChange(await window.api.bills.remove(id));
  }
  async function handleSaveNote(id: number, note: string) {
    onChange(await window.api.bills.setNote(id, note));
  }

  return (
    <>
      {bills.length === 0 ? (
        <p className="muted">No bills added yet.</p>
      ) : (
        bills.map((item) => (
          <BillRow
            key={item.id}
            item={item}
            onSave={(label, dueDay, autopay) => handleSave(item.id, label, dueDay, autopay)}
            onSaveNote={(note) => handleSaveNote(item.id, note)}
            onDelete={() => handleDelete(item.id)}
          />
        ))
      )}
      <AddForm onAdd={handleAdd} />
    </>
  );
}

function isValidPositiveNumber(text: string): boolean {
  const n = Number(text);
  return text.trim() !== "" && Number.isFinite(n) && n >= 0;
}

// APR above this is colored red (--alert), at or below is green (--live) —
// a plain "is this card expensive to carry a balance on" signal, not tied
// to any particular issuer's rate tiers.
const HIGH_APR_THRESHOLD = 7;

// Utilization above this is colored red (--alert), same "carry too much of a
// balance" signal as HIGH_APR_THRESHOLD, not a credit-score-modeling figure.
const UTILIZATION_WARN_THRESHOLD = 30;

function CardFields({
  name,
  creditLimit,
  apr,
  ynabAccountId,
  ynabAccountOptions,
  onNameChange,
  onCreditLimitChange,
  onAprChange,
  onYnabAccountIdChange,
  onKeyDown,
}: {
  name: string;
  creditLimit: string;
  apr: string;
  ynabAccountId: string;
  ynabAccountOptions: YnabAccount[];
  onNameChange: (v: string) => void;
  onCreditLimitChange: (v: string) => void;
  onAprChange: (v: string) => void;
  onYnabAccountIdChange: (v: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <>
      <td className="card-col-name">
        <input
          className="settings-input card-table-input"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Card name"
          autoFocus
        />
      </td>
      <td className="card-col-limit">
        <input
          className="settings-input card-table-input"
          type="number"
          min={0}
          step="1"
          value={creditLimit}
          onChange={(e) => onCreditLimitChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Credit limit"
        />
      </td>
      <td className="card-col-apr">
        <input
          className="settings-input card-table-input"
          type="number"
          min={0}
          step="0.01"
          value={apr}
          onChange={(e) => onAprChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="APR %"
        />
      </td>
      <td className="card-col-balance">
        <select
          className="settings-input card-table-input"
          value={ynabAccountId}
          onChange={(e) => onYnabAccountIdChange(e.target.value)}
        >
          <option value="">Not linked</option>
          {ynabAccountOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </td>
    </>
  );
}

function CardEditRow({
  item,
  ynabAccountOptions,
  onSave,
  onCancel,
}: {
  item: CardItem;
  ynabAccountOptions: YnabAccount[];
  onSave: (name: string, creditLimit: number, apr: number, ynabAccountId: string | null) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [creditLimit, setCreditLimit] = useState(String(item.creditLimit));
  const [apr, setApr] = useState(String(item.apr));
  const [ynabAccountId, setYnabAccountId] = useState(item.ynabAccountId ?? "");

  const valid = name.trim() !== "" && isValidPositiveNumber(creditLimit) && isValidPositiveNumber(apr);

  function handleSave() {
    if (!valid) return;
    onSave(name.trim(), Number(creditLimit), Number(apr), ynabAccountId || null);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      onCancel();
    }
  }

  return (
    <tr className="card-row-editing">
      <CardFields
        name={name}
        creditLimit={creditLimit}
        apr={apr}
        ynabAccountId={ynabAccountId}
        ynabAccountOptions={ynabAccountOptions}
        onNameChange={setName}
        onCreditLimitChange={setCreditLimit}
        onAprChange={setApr}
        onYnabAccountIdChange={setYnabAccountId}
        onKeyDown={handleKeyDown}
      />
      <td className="card-col-actions">
        <span className="row-actions always-visible">
          <button className="row-action" onClick={handleSave} disabled={!valid} aria-label="Save">
            <IconCheck />
          </button>
          <button className="row-action" onClick={onCancel} aria-label="Cancel">
            <IconX />
          </button>
        </span>
      </td>
    </tr>
  );
}

function CardRow({
  item,
  ynabAccountOptions,
  onSave,
  onDelete,
}: {
  item: CardItem;
  ynabAccountOptions: YnabAccount[];
  onSave: (name: string, creditLimit: number, apr: number, ynabAccountId: string | null) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <CardEditRow
        item={item}
        ynabAccountOptions={ynabAccountOptions}
        onSave={(name, creditLimit, apr, ynabAccountId) => {
          onSave(name, creditLimit, apr, ynabAccountId);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  // A stale link (account closed upstream, or the YNAB fetch failed) fails
  // soft rather than throwing on an undefined lookup.
  const linkedAccount = item.ynabAccountId
    ? ynabAccountOptions.find((a) => a.id === item.ynabAccountId)
    : undefined;

  let balanceCell: ReactNode;
  if (!item.ynabAccountId) {
    balanceCell = <span className="muted">—</span>;
  } else if (!linkedAccount) {
    balanceCell = <span className="muted">Link unavailable</span>;
  } else {
    // A YNAB credit-card balance is negative when money is owed.
    const liveBalance = Math.abs(linkedAccount.balance);
    const utilizationPct = item.creditLimit > 0 ? (liveBalance / item.creditLimit) * 100 : null;
    balanceCell = (
      <>
        <span className={utilizationPct != null && utilizationPct > UTILIZATION_WARN_THRESHOLD ? "ynab-balance negative" : "ynab-balance"}>
          {formatCurrency(liveBalance)}
        </span>
        {utilizationPct != null && (
          <span className="card-utilization">{Math.round(utilizationPct)}%</span>
        )}
      </>
    );
  }

  return (
    <tr>
      <td className="card-col-name">{item.name}</td>
      <td className="card-col-limit">{formatCurrency(item.creditLimit)}</td>
      <td className={`card-col-apr ${item.apr > HIGH_APR_THRESHOLD ? "apr-high" : "apr-low"}`}>
        {formatApr(item.apr)}
      </td>
      <td className="card-col-balance">{balanceCell}</td>
      <td className="card-col-actions">
        <span className="row-actions">
          <button className="row-action" onClick={() => setEditing(true)} aria-label="Edit">
            <IconPencil />
          </button>
          <button className="row-action danger" onClick={onDelete} aria-label="Delete">
            <IconTrash />
          </button>
        </span>
      </td>
    </tr>
  );
}

function CardAddRow({
  ynabAccountOptions,
  onAdd,
}: {
  ynabAccountOptions: YnabAccount[];
  onAdd: (name: string, creditLimit: number, apr: number, ynabAccountId: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [apr, setApr] = useState("");
  const [ynabAccountId, setYnabAccountId] = useState("");

  const valid = name.trim() !== "" && isValidPositiveNumber(creditLimit) && isValidPositiveNumber(apr);

  function handleAdd() {
    if (!valid) return;
    onAdd(name.trim(), Number(creditLimit), Number(apr), ynabAccountId || null);
    setName("");
    setCreditLimit("");
    setApr("");
    setYnabAccountId("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  }

  return (
    <tr className="card-row-editing">
      <CardFields
        name={name}
        creditLimit={creditLimit}
        apr={apr}
        ynabAccountId={ynabAccountId}
        ynabAccountOptions={ynabAccountOptions}
        onNameChange={setName}
        onCreditLimitChange={setCreditLimit}
        onAprChange={setApr}
        onYnabAccountIdChange={setYnabAccountId}
        onKeyDown={handleKeyDown}
      />
      <td className="card-col-actions">
        <button className="row-action always-visible" onClick={handleAdd} disabled={!valid} aria-label="Add">
          <IconPlus />
        </button>
      </td>
    </tr>
  );
}

function CardsBody({
  cards,
  onCardsChange,
  ynabAccounts,
}: {
  cards: CardItem[];
  onCardsChange: (cards: CardItem[]) => void;
  ynabAccounts: YnabAccountsResult | null;
}) {
  const ynabAccountOptions = ynabAccounts?.ok ? ynabAccounts.accounts : [];

  async function handleAdd(
    name: string,
    creditLimit: number,
    apr: number,
    ynabAccountId: string | null
  ) {
    onCardsChange(await window.api.cards.add(name, creditLimit, apr, ynabAccountId));
  }
  async function handleSave(
    id: number,
    name: string,
    creditLimit: number,
    apr: number,
    ynabAccountId: string | null
  ) {
    onCardsChange(await window.api.cards.update(id, name, creditLimit, apr, ynabAccountId));
  }
  async function handleDelete(id: number) {
    onCardsChange(await window.api.cards.remove(id));
  }

  return (
    <table className="ynab-table cards-table">
      <thead>
        <tr>
          <th className="card-col-name">Name</th>
          <th className="card-col-limit">Limit</th>
          <th className="card-col-apr">APR</th>
          <th className="card-col-balance">Balance</th>
          <th className="card-col-actions" aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {cards.length === 0 && (
          <tr>
            <td colSpan={5} className="muted">
              No cards added yet.
            </td>
          </tr>
        )}
        {cards.map((item) => (
          <CardRow
            key={item.id}
            item={item}
            ynabAccountOptions={ynabAccountOptions}
            onSave={(name, creditLimit, apr, ynabAccountId) =>
              handleSave(item.id, name, creditLimit, apr, ynabAccountId)
            }
            onDelete={() => handleDelete(item.id)}
          />
        ))}
        <CardAddRow ynabAccountOptions={ynabAccountOptions} onAdd={handleAdd} />
      </tbody>
    </table>
  );
}

export default function BillsWidget({
  bills,
  onChange,
  cards,
  onCardsChange,
  ynabAccounts,
}: BillsWidgetProps) {
  const [tab, setTab] = useState<Tab>("bills");

  const headerRight = (
    <div className="scratchpad-toolbar">
      <div className="scratchpad-modes">
        <button
          type="button"
          className={`scratchpad-mode ${tab === "bills" ? "active" : ""}`}
          onClick={() => setTab("bills")}
        >
          Bills
        </button>
        <button
          type="button"
          className={`scratchpad-mode ${tab === "cards" ? "active" : ""}`}
          onClick={() => setTab("cards")}
        >
          Cards
        </button>
      </div>
    </div>
  );

  return (
    <Panel title={tab === "bills" ? "Bills" : "Cards"} headerRight={headerRight}>
      {tab === "bills" ? (
        <BillsBody bills={bills} onChange={onChange} />
      ) : (
        <CardsBody cards={cards} onCardsChange={onCardsChange} ynabAccounts={ynabAccounts} />
      )}
    </Panel>
  );
}
