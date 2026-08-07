import { useState } from "react";
import type { FormEvent } from "react";
import type { BillItem } from "../../../shared/types";
import Panel from "./Panel";
import { IconCheck, IconPencil, IconPlus, IconTrash, IconX } from "./icons";

interface BillsWidgetProps {
  bills: BillItem[];
  onChange: (bills: BillItem[]) => void;
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
        autoFocus
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

function BillRow({
  item,
  onSave,
  onDelete,
}: {
  item: BillItem;
  onSave: (label: string, dueDay: number, autopay: boolean) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);

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
    <div className="settings-array-row">
      <div className="settings-array-row-main">
        <span className="settings-array-row-label">{ordinal(item.dueDay)}</span>
        <span className="settings-array-row-sub">{item.label}</span>
      </div>
      <span className={`pip ${item.autopay ? "live" : ""}`}></span>
      <span className="tag">{item.autopay ? "Autopay" : "Manual"}</span>
      <span className="row-actions">
        <button className="row-action" onClick={() => setEditing(true)} aria-label="Edit">
          <IconPencil />
        </button>
        <button className="row-action danger" onClick={onDelete} aria-label="Delete">
          <IconTrash />
        </button>
      </span>
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

export default function BillsWidget({ bills, onChange }: BillsWidgetProps) {
  async function handleAdd(label: string, dueDay: number, autopay: boolean) {
    onChange(await window.api.bills.add(label, dueDay, autopay));
  }
  async function handleSave(id: number, label: string, dueDay: number, autopay: boolean) {
    onChange(await window.api.bills.update(id, label, dueDay, autopay));
  }
  async function handleDelete(id: number) {
    onChange(await window.api.bills.remove(id));
  }

  return (
    <Panel title="Bills">
      {bills.length === 0 ? (
        <p className="muted">No bills added yet.</p>
      ) : (
        bills.map((item) => (
          <BillRow
            key={item.id}
            item={item}
            onSave={(label, dueDay, autopay) => handleSave(item.id, label, dueDay, autopay)}
            onDelete={() => handleDelete(item.id)}
          />
        ))
      )}
      <AddForm onAdd={handleAdd} />
    </Panel>
  );
}
