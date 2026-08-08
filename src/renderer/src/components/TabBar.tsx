// The top-level tab strip. Normally just a row of plain buttons; an "Edit
// tabs" toggle switches it into a drag-to-reorder + click-to-rename mode
// (same dnd-kit shape as LinkLauncherWidget's SortableRow) backed by
// window.api.settings.tabs.*. Tab *content* is still gated on the fixed
// TabId union in App.tsx — this only ever reorders/relabels that fixed set,
// it can't add or remove a tab.

import { useState } from "react";
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
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TabConfig } from "../../../shared/types";
import { IconCheck, IconGrip, IconPencil } from "./icons";

interface TabBarProps {
  tabs: TabConfig[];
  activeId: string;
  onSelect: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onRename: (id: string, label: string) => void;
}

function SortableTab({
  tab,
  active,
  editing,
  onSelect,
  onRename,
}: {
  tab: TabConfig;
  active: boolean;
  editing: boolean;
  onSelect: () => void;
  onRename: (label: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(tab.label);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
    disabled: !editing,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  function commit() {
    setRenaming(false);
    const trimmed = value.trim();
    if (trimmed && trimmed !== tab.label) {
      onRename(trimmed);
    } else {
      setValue(tab.label);
    }
  }

  if (editing && renaming) {
    return (
      <span ref={setNodeRef} style={style} className="tab tab-renaming">
        <input
          className="tab-rename-input"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setValue(tab.label);
              setRenaming(false);
            }
          }}
        />
      </span>
    );
  }

  return (
    <span
      ref={setNodeRef}
      style={style}
      className={`tab ${active ? "active" : ""} ${editing ? "tab-editable" : ""} ${
        isDragging ? "dragging" : ""
      }`}
    >
      {editing && (
        <button
          type="button"
          className="tab-drag-handle"
          {...attributes}
          {...listeners}
          aria-label="Reorder tab"
        >
          <IconGrip size={11} />
        </button>
      )}
      <button
        type="button"
        className="tab-label"
        onClick={() => (editing ? setRenaming(true) : onSelect())}
      >
        {tab.label}
        {editing && <IconPencil size={10} className="tab-edit-icon" />}
      </button>
    </span>
  );
}

export default function TabBar({ tabs, activeId, onSelect, onReorder, onRename }: TabBarProps) {
  const [editing, setEditing] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = tabs.findIndex((t) => t.id === active.id);
    const newIndex = tabs.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(arrayMove(tabs, oldIndex, newIndex).map((t) => t.id));
  }

  return (
    <nav className={`tabs ${editing ? "tabs-editing" : ""}`}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
          {tabs.map((tab) => (
            <SortableTab
              key={tab.id}
              tab={tab}
              active={tab.id === activeId}
              editing={editing}
              onSelect={() => onSelect(tab.id)}
              onRename={(label) => onRename(tab.id, label)}
            />
          ))}
        </SortableContext>
      </DndContext>
      <button
        type="button"
        className="tabs-edit-toggle"
        onClick={() => setEditing((v) => !v)}
        title={editing ? "Done rearranging tabs" : "Rearrange or rename tabs"}
      >
        {editing ? <IconCheck size={12} /> : <IconPencil size={12} />}
      </button>
    </nav>
  );
}
