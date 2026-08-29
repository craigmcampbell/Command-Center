import { useEffect, useState } from "react";
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
import type {
  Habit,
  HabitFrequencyType,
  HabitStreak,
  HabitWeekEntry,
  HabitWeekView,
} from "../../../shared/types";
import { useHabits } from "../hooks/useHabits";
import Panel from "./Panel";
import Select from "./Select";
import HabitTrendChart from "./HabitTrendChart";
import HabitHeatmap from "./HabitHeatmap";
import {
  IconArchive,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconFlame,
  IconGrip,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconSkip,
  IconTrash,
  IconX,
} from "./icons";

function formatWeekRange(weekStart: string, weekEnd: string): string {
  const start = new Date(weekStart + "T12:00:00");
  const end = new Date(weekEnd + "T12:00:00");
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const startStr = start.toLocaleDateString("en-US", opts);
  const endStr = end.toLocaleDateString("en-US", { ...opts, year: "numeric" });
  return `${startStr} – ${endStr}`;
}

function frequencyLabel(type: HabitFrequencyType, target: number): string {
  switch (type) {
    case "daily":
      return "Daily";
    case "weekly":
      return "Weekly";
    case "times_per_week":
      return `${target}×/week`;
  }
}

// Shared by the edit-habit and add-habit frequency selects below.
const FREQUENCY_OPTIONS: { value: HabitFrequencyType; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "times_per_week", label: "Times per week" },
];

function visibleHabits(habits: HabitWeekEntry[], categoryFilter: string | null): HabitWeekEntry[] {
  return categoryFilter ? habits.filter((h) => h.habit.category === categoryFilter) : habits;
}

/** Re-inserts a reordered filtered subset back into its original slots
 *  within the full list, so dragging while a category filter is active
 *  doesn't silently reorder habits outside the filter. */
function mergeReordered(full: HabitWeekEntry[], reorderedSubset: HabitWeekEntry[]): HabitWeekEntry[] {
  const subsetIds = new Set(reorderedSubset.map((h) => h.habit.id));
  const queue = [...reorderedSubset];
  return full.map((h) => (subsetIds.has(h.habit.id) ? queue.shift()! : h));
}

interface EditState {
  id: number;
  name: string;
  frequencyType: HabitFrequencyType;
  targetCount: number;
  category: string;
}

interface SortableHabitRowProps {
  entry: HabitWeekEntry;
  days: HabitWeekView["days"];
  todayIso: string;
  streak?: HabitStreak;
  onToggle: (habitId: number, date: string) => void;
  onNote: (habitId: number, date: string, existingNote: string | undefined) => void;
  onEdit: (habit: Habit) => void;
  onArchive: (habit: Habit) => void;
}

function SortableHabitRow({
  entry,
  days,
  todayIso,
  streak,
  onToggle,
  onNote,
  onEdit,
  onArchive,
}: SortableHabitRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.habit.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`habits-row ${entry.goalMet ? "goal-met" : ""} ${isDragging ? "dragging" : ""}`}
    >
      <td className="habits-col-drag">
        <button
          type="button"
          className="drag-handle habit-drag-handle"
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${entry.habit.name}`}
        >
          <IconGrip />
        </button>
      </td>
      <td className="habits-col-name">
        <span className="habit-name">{entry.habit.name}</span>
        {streak && streak.current > 0 && (
          <span className="habit-streak-badge" title={`Longest streak: ${streak.longest}`}>
            <IconFlame size={10} />
            {streak.current}
          </span>
        )}
        <span className="habit-freq-tag">
          {frequencyLabel(entry.habit.frequencyType, entry.habit.targetCount)}
        </span>
        {entry.habit.category && <span className="habit-category-tag">{entry.habit.category}</span>}
      </td>
      {days.map((day) => {
        const status = entry.completions[day.date];
        const note = entry.notes[day.date];
        const isToday = day.date === todayIso;
        return (
          <td key={day.date} className={`habits-col-day ${isToday ? "today" : ""}`}>
            <button
              type="button"
              className={`habit-check ${status ?? ""} ${note ? "has-note" : ""}`}
              onClick={() => onToggle(entry.habit.id, day.date)}
              onContextMenu={(e) => {
                e.preventDefault();
                onNote(entry.habit.id, day.date, note);
              }}
              aria-label={`${entry.habit.name} on ${day.label}`}
              aria-pressed={status === "done"}
              title={note ?? "Right-click to add a note"}
            >
              {status === "done" && <IconCheck size={11} />}
              {status === "skipped" && <IconSkip size={9} />}
            </button>
          </td>
        );
      })}
      <td className="habits-col-progress">
        <span className={`habit-progress ${entry.goalMet ? "met" : ""}`}>
          {entry.weekCount}/{entry.weekTarget}
          {entry.goalMet && <IconCheck size={10} className="habit-progress-check" />}
        </span>
      </td>
      <td className="habits-col-actions">
        <div className="habits-row-actions">
          <button
            type="button"
            className="row-action"
            onClick={() => onEdit(entry.habit)}
            title="Edit habit"
          >
            <IconPencil />
          </button>
          <button
            type="button"
            className="row-action danger"
            onClick={() => onArchive(entry.habit)}
            title="Archive habit"
          >
            <IconArchive />
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function HabitsWidget() {
  const {
    week,
    trends,
    streaks,
    categories,
    archivedHabits,
    loaded,
    heatmapHabitId,
    heatmapData,
    navigate,
    goToday,
    toggle,
    setNote,
    reorderLocal,
    persistReorder,
    add,
    update,
    archive,
    restore,
    remove,
    loadArchived,
    setHeatmapHabitId,
  } = useHabits();

  const [newName, setNewName] = useState("");
  const [newFreq, setNewFreq] = useState<HabitFrequencyType>("daily");
  const [newTarget, setNewTarget] = useState(3);
  const [newCategory, setNewCategory] = useState("");
  const [editing, setEditing] = useState<EditState | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    if (week && week.habits.length > 0 && heatmapHabitId == null) {
      void setHeatmapHabitId(week.habits[0].habit.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);

  function toggleArchivedSection() {
    const next = !showArchived;
    setShowArchived(next);
    if (next && archivedHabits === null) void loadArchived();
  }

  async function handleToggle(habitId: number, date: string) {
    await toggle(habitId, date);
  }

  async function handleNote(habitId: number, date: string, existingNote: string | undefined) {
    const next = window.prompt("Note for this day:", existingNote ?? "");
    if (next === null) return;
    await setNote(habitId, date, next.trim() || null);
  }

  async function handleDragEnd(e: DragEndEvent) {
    if (!week) return;
    const { active, over } = e;
    if (!over || active.id === over.id) return;

    const visible = visibleHabits(week.habits, categoryFilter);
    const oldIndex = visible.findIndex((h) => h.habit.id === active.id);
    const newIndex = visible.findIndex((h) => h.habit.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reorderedVisible = arrayMove(visible, oldIndex, newIndex);
    const reorderedFull = categoryFilter
      ? mergeReordered(week.habits, reorderedVisible)
      : reorderedVisible;

    reorderLocal(reorderedFull);
    await persistReorder(reorderedFull.map((h) => h.habit.id));
  }

  async function handleAdd() {
    if (!newName.trim()) return;
    await add(
      newName,
      newFreq,
      newFreq === "times_per_week" ? newTarget : undefined,
      newCategory.trim() || null
    );
    setNewName("");
    setNewFreq("daily");
    setNewTarget(3);
    setNewCategory("");
    setShowAdd(false);
  }

  async function handleUpdate() {
    if (!editing || !editing.name.trim()) return;
    await update(
      editing.id,
      editing.name,
      editing.frequencyType,
      editing.frequencyType === "times_per_week" ? editing.targetCount : undefined,
      editing.category.trim() || null
    );
    setEditing(null);
  }

  async function handleArchive(habit: Habit) {
    if (
      !window.confirm(
        `Archive "${habit.name}"? It'll disappear from the week grid but its history is kept.`
      )
    )
      return;
    if (editing?.id === habit.id) setEditing(null);
    await archive(habit.id);
  }

  async function handleRestore(habit: Habit) {
    await restore(habit.id);
  }

  async function handleDeletePermanently(habit: Habit) {
    if (
      !window.confirm(`Permanently delete "${habit.name}" and all its history? This can't be undone.`)
    )
      return;
    await remove(habit.id);
  }

  function startEdit(habit: Habit) {
    setEditing({
      id: habit.id,
      name: habit.name,
      frequencyType: habit.frequencyType,
      targetCount: habit.targetCount,
      category: habit.category ?? "",
    });
    setShowAdd(false);
  }

  if (!loaded || !week) {
    return (
      <Panel title="Habits">
        <p className="muted">Loading…</p>
      </Panel>
    );
  }

  const todayIso = (() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  })();

  const rows = visibleHabits(week.habits, categoryFilter);

  return (
    <div className="habits-layout">
      <Panel
        title="This Week"
        headerRight={
          <div className="habits-week-nav">
            {categories.length > 0 && (
              <Select
                className="habits-category-filter"
                value={categoryFilter ?? ""}
                onChange={(v) => setCategoryFilter(v || null)}
                options={[
                  { value: "", label: "All categories" },
                  ...categories.map((c) => ({ value: c, label: c })),
                ]}
              />
            )}
            <button type="button" className="daily-nav-btn" onClick={() => navigate(-1)} title="Previous week">
              <IconChevronLeft />
            </button>
            <button type="button" className="daily-nav-btn today-btn" onClick={goToday}>
              Today
            </button>
            <button type="button" className="daily-nav-btn" onClick={() => navigate(1)} title="Next week">
              <IconChevronRight />
            </button>
            <span className="habits-week-range">{formatWeekRange(week.weekStart, week.weekEnd)}</span>
          </div>
        }
      >
        {week.habits.length === 0 && !showAdd ? (
          <p className="muted">No habits yet. Add one to get started.</p>
        ) : rows.length === 0 ? (
          <p className="muted">No habits in this category.</p>
        ) : (
          <div className="habits-grid-wrap">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <table className="habits-grid">
                <thead>
                  <tr>
                    <th className="habits-col-drag" aria-label="Reorder" />
                    <th className="habits-col-name">Habit</th>
                    {week.days.map((day) => (
                      <th
                        key={day.date}
                        className={`habits-col-day ${day.date === todayIso ? "today" : ""}`}
                      >
                        {day.label}
                      </th>
                    ))}
                    <th className="habits-col-progress">Goal</th>
                    <th className="habits-col-actions" />
                  </tr>
                </thead>
                <SortableContext
                  items={rows.map((h) => h.habit.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <tbody>
                    {rows.map((entry) => (
                      <SortableHabitRow
                        key={entry.habit.id}
                        entry={entry}
                        days={week.days}
                        todayIso={todayIso}
                        streak={streaks.get(entry.habit.id)}
                        onToggle={handleToggle}
                        onNote={handleNote}
                        onEdit={startEdit}
                        onArchive={handleArchive}
                      />
                    ))}
                  </tbody>
                </SortableContext>
              </table>
            </DndContext>
          </div>
        )}

        {editing && (
          <div className="habit-form habit-edit-form">
            <input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="Habit name"
              autoFocus
            />
            <Select
              value={editing.frequencyType}
              onChange={(v) => setEditing({ ...editing, frequencyType: v as HabitFrequencyType })}
              options={FREQUENCY_OPTIONS}
            />
            {editing.frequencyType === "times_per_week" && (
              <input
                type="number"
                min={1}
                max={7}
                value={editing.targetCount}
                onChange={(e) =>
                  setEditing({ ...editing, targetCount: Number(e.target.value) || 1 })
                }
                className="habit-target-input"
              />
            )}
            <input
              value={editing.category}
              onChange={(e) => setEditing({ ...editing, category: e.target.value })}
              placeholder="Category (optional)"
              list="habit-categories"
            />
            <button type="button" className="habit-form-btn save" onClick={handleUpdate}>
              Save
            </button>
            <button type="button" className="habit-form-btn cancel" onClick={() => setEditing(null)}>
              <IconX size={12} />
            </button>
          </div>
        )}

        {showAdd ? (
          <div className="habit-form habit-add-form">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Habit name"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
            <Select
              value={newFreq}
              onChange={(v) => setNewFreq(v as HabitFrequencyType)}
              options={FREQUENCY_OPTIONS}
            />
            {newFreq === "times_per_week" && (
              <input
                type="number"
                min={1}
                max={7}
                value={newTarget}
                onChange={(e) => setNewTarget(Number(e.target.value) || 1)}
                className="habit-target-input"
              />
            )}
            <input
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="Category (optional)"
              list="habit-categories"
            />
            <button type="button" className="habit-form-btn save" onClick={handleAdd} disabled={!newName.trim()}>
              <IconPlus size={12} />
              Add
            </button>
            <button type="button" className="habit-form-btn cancel" onClick={() => setShowAdd(false)}>
              <IconX size={12} />
            </button>
          </div>
        ) : (
          <button type="button" className="habit-add-toggle" onClick={() => { setShowAdd(true); setEditing(null); }}>
            <IconPlus size={12} />
            Add habit
          </button>
        )}

        <datalist id="habit-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Panel>

      {trends.length > 0 && (
        <Panel title="Trends — last 12 weeks">
          <div className="habit-trends-grid">
            {trends.map((t) => (
              <HabitTrendChart key={t.habit.id} trend={t} streak={streaks.get(t.habit.id)} />
            ))}
          </div>
        </Panel>
      )}

      {week.habits.length > 0 && (
        <Panel
          title="Year in Review"
          headerRight={
            <Select
              value={heatmapHabitId !== null ? String(heatmapHabitId) : ""}
              onChange={(v) => void setHeatmapHabitId(v ? Number(v) : null)}
              options={week.habits.map((h) => ({ value: String(h.habit.id), label: h.habit.name }))}
            />
          }
        >
          {heatmapData ? (
            <HabitHeatmap data={heatmapData} />
          ) : (
            <p className="muted">Pick a habit to see its year at a glance.</p>
          )}
        </Panel>
      )}

      <Panel
        title="Archived"
        headerRight={
          <button type="button" className="daily-nav-btn" onClick={toggleArchivedSection}>
            {showArchived ? "Hide" : "Show"}
          </button>
        }
      >
        {!showArchived ? (
          <p className="muted">Paused habits keep their history here.</p>
        ) : archivedHabits === null ? (
          <p className="muted">Loading…</p>
        ) : archivedHabits.length === 0 ? (
          <p className="muted">No archived habits.</p>
        ) : (
          <ul className="habit-archived-list">
            {archivedHabits.map((h) => (
              <li key={h.id} className="habit-archived-row">
                <span className="habit-name">{h.name}</span>
                <span className="habit-freq-tag">{frequencyLabel(h.frequencyType, h.targetCount)}</span>
                <div className="habits-row-actions habit-archived-actions">
                  <button
                    type="button"
                    className="row-action"
                    onClick={() => handleRestore(h)}
                    title="Restore"
                  >
                    <IconRefresh size={12} />
                  </button>
                  <button
                    type="button"
                    className="row-action danger"
                    onClick={() => handleDeletePermanently(h)}
                    title="Delete permanently"
                  >
                    <IconTrash />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
