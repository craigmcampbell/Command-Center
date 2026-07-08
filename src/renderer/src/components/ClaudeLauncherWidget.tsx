import { useEffect, useRef, useState } from "react";
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
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { LinkItem, LinkListKind } from "../../../shared/types";
import { useLinkList } from "../hooks/useLinkList";
import Panel from "./Panel";
import {
  IconArrowRight,
  IconCheck,
  IconGrip,
  IconPencil,
  IconPlus,
  IconTrash,
  IconX,
} from "./icons";

interface ClaudeLauncherWidgetProps {
  kind: LinkListKind;
  projects: LinkItem[];
  onChange: (items: LinkItem[]) => void;
}

type LaunchState = "idle" | "opening" | "opened" | "failed";

function EditForm({
  item,
  onSave,
  onCancel,
}: {
  item: LinkItem;
  onSave: (label: string, link: string) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(item.label);
  const [link, setLink] = useState(item.link);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const l = label.trim();
    const p = link.trim();
    if (!l || !p) return;
    onSave(l, p);
  }

  return (
    <form className="link-edit-form chip-edit-form" onSubmit={handleSubmit}>
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Label"
        autoFocus
      />
      <input
        value={link}
        onChange={(e) => setLink(e.target.value)}
        placeholder="/absolute/path/to/project"
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

function SortableChip({
  item,
  onSave,
  onDelete,
}: {
  item: LinkItem;
  onSave: (label: string, link: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<LaunchState>("idle");
  const revertTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  useEffect(() => () => clearTimeout(revertTimeout.current), []);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  async function handleClick() {
    setState("opening");
    const res = await window.api.claude.launch(item.link);
    setState(res.ok ? "opened" : "failed");
    revertTimeout.current = setTimeout(() => setState("idle"), 2000);
  }

  if (editing) {
    return (
      <div ref={setNodeRef} style={style} className="launch-chip-wrap editing">
        <EditForm
          item={item}
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
    <div ref={setNodeRef} style={style} className={`launch-chip-wrap ${isDragging ? "dragging" : ""}`}>
      <button className="drag-handle chip-handle" {...attributes} {...listeners} aria-label="Reorder">
        <IconGrip />
      </button>
      <button className={`launch-chip state-${state}`} onClick={handleClick}>
        <span>{item.label}</span>
        <span className="chip-status">
          {state === "idle" && (
            <>
              launch <IconArrowRight />
            </>
          )}
          {state === "opening" && "opening…"}
          {state === "opened" && (
            <>
              opened <IconCheck />
            </>
          )}
          {state === "failed" && "failed"}
        </span>
      </button>
      <span className="row-actions chip-actions">
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

function AddForm({ onAdd }: { onAdd: (label: string, link: string) => void }) {
  const [label, setLabel] = useState("");
  const [link, setLink] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const l = label.trim();
    const p = link.trim();
    if (!l || !p) return;
    onAdd(l, p);
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
        placeholder="/absolute/path/to/project"
        value={link}
        onChange={(e) => setLink(e.target.value)}
      />
      <button type="submit" disabled={!label.trim() || !link.trim()} aria-label="Add">
        <IconPlus />
      </button>
    </form>
  );
}

export default function ClaudeLauncherWidget({ kind, projects, onChange }: ClaudeLauncherWidgetProps) {
  const { add, update, remove, reorder } = useLinkList(kind, onChange);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = projects.findIndex((p) => p.id === active.id);
    const newIndex = projects.findIndex((p) => p.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    reorder(arrayMove(projects, oldIndex, newIndex));
  }

  return (
    <Panel title="Claude Code">
      {projects.length === 0 ? (
        <p className="muted">No projects configured.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={projects.map((p) => p.id)}
            strategy={horizontalListSortingStrategy}
          >
            <div className="chip-row">
              {projects.map((item) => (
                <SortableChip
                  key={item.id}
                  item={item}
                  onSave={(label, link) => update(item.id, label, link)}
                  onDelete={() => remove(item.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <AddForm onAdd={add} />
    </Panel>
  );
}
