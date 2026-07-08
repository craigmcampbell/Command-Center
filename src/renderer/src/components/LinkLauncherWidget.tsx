import { useState } from "react";
import type { FormEvent } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { LinkItem, LinkListKind } from "../../../shared/types";
import { useLinkList } from "../hooks/useLinkList";
import Panel from "./Panel";
import { IconArrowRight, IconCheck, IconGrip, IconPencil, IconPlus, IconTrash, IconX } from "./icons";

interface LinkLauncherWidgetProps {
  title: string;
  kind: LinkListKind;
  instances: LinkItem[];
  onChange: (items: LinkItem[]) => void;
  emptyLabel?: string;
  linkPlaceholder?: string;
}

function toDisplayHost(link: string): string {
  const raw = link.trim();
  if (!raw) return "";

  try {
    const withProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(raw) ? raw : `https://${raw}`;
    return new URL(withProtocol).host.replace(/^www\./i, "");
  } catch {
    return (
      raw
        .replace(/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//, "")
        .split(/[/?#]/)[0]
        ?.replace(/^www\./i, "") ?? raw
    );
  }
}

function EditForm({
  item,
  linkPlaceholder,
  onSave,
  onCancel,
}: {
  item: LinkItem;
  linkPlaceholder: string;
  onSave: (label: string, link: string) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(item.label);
  const [link, setLink] = useState(item.link);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const l = label.trim();
    const u = link.trim();
    if (!l || !u) return;
    onSave(l, u);
  }

  return (
    <form className="link-edit-form" onSubmit={handleSubmit}>
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Label"
        autoFocus
      />
      <input
        value={link}
        onChange={(e) => setLink(e.target.value)}
        placeholder={linkPlaceholder}
      />
      <button type="submit" className="link-edit-save" aria-label="Save">
        <IconCheck />
      </button>
      <button type="button" className="link-edit-cancel" onClick={onCancel} aria-label="Cancel">
        <IconX />
      </button>
    </form>
  );
}

function SortableRow({
  item,
  onSave,
  onDelete,
}: {
  item: LinkItem;
  onSave: (label: string, link: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  if (editing) {
    return (
      <div ref={setNodeRef} style={style} className="link-row editing">
        <EditForm
          item={item}
          linkPlaceholder="https://…"
          onSave={(label, link) => {
            onSave(label, link);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} className={`link-row ${isDragging ? "dragging" : ""}`}>
      <button className="drag-handle" {...attributes} {...listeners} aria-label="Reorder">
        <IconGrip />
      </button>
      <button className="launch" onClick={() => window.api.openUrl(item.link)}>
        <span>{item.label}</span>
        <span className="arrow">
          <span className="arrow-text">{toDisplayHost(item.link)}</span>
          <IconArrowRight />
        </span>
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
  );
}

function AddForm({
  linkPlaceholder,
  onAdd,
}: {
  linkPlaceholder: string;
  onAdd: (label: string, link: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [link, setLink] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const l = label.trim();
    const u = link.trim();
    if (!l || !u) return;
    onAdd(l, u);
    setLabel("");
    setLink("");
  }

  return (
    <form className="link-add-form" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="Label"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <input
        type="text"
        placeholder={linkPlaceholder}
        value={link}
        onChange={(e) => setLink(e.target.value)}
      />
      <button type="submit" disabled={!label.trim() || !link.trim()} aria-label="Add">
        <IconPlus />
      </button>
    </form>
  );
}

export default function LinkLauncherWidget({
  title,
  kind,
  instances,
  onChange,
  emptyLabel = "No instances configured.",
  linkPlaceholder = "https://…",
}: LinkLauncherWidgetProps) {
  const { add, update, remove, reorder } = useLinkList(kind, onChange);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = instances.findIndex((i) => i.id === active.id);
    const newIndex = instances.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    reorder(arrayMove(instances, oldIndex, newIndex));
  }

  return (
    <Panel title={title}>
      {instances.length === 0 ? (
        <p className="muted">{emptyLabel}</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={instances.map((i) => i.id)}
            strategy={verticalListSortingStrategy}
          >
            {instances.map((item) => (
              <SortableRow
                key={item.id}
                item={item}
                onSave={(label, link) => update(item.id, label, link)}
                onDelete={() => remove(item.id)}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}
      <AddForm linkPlaceholder={linkPlaceholder} onAdd={add} />
    </Panel>
  );
}
