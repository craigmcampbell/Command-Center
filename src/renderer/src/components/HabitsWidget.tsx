import { useCallback, useEffect, useState } from "react";
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
  HabitTrendResult,
  HabitWeekEntry,
  HabitWeekView,
} from "../../../shared/types";
import Panel from "./Panel";
import HabitTrendChart from "./HabitTrendChart";
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconGrip,
  IconPencil,
  IconPlus,
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

function shiftWeek(weekStart: string, delta: number): string {
  const d = new Date(weekStart + "T12:00:00");
  d.setDate(d.getDate() + delta * 7);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

function reorderTrends(
  trends: HabitTrendResult[],
  habits: HabitWeekEntry[]
): HabitTrendResult[] {
  const byId = new Map(trends.map((t) => [t.habit.id, t]));
  return habits
    .map((h) => byId.get(h.habit.id))
    .filter((t): t is HabitTrendResult => t != null);
}

interface EditState {
  id: number;
  name: string;
  frequencyType: HabitFrequencyType;
  targetCount: number;
}

interface SortableHabitRowProps {
  entry: HabitWeekEntry;
  days: HabitWeekView["days"];
  todayIso: string;
  onToggle: (habitId: number, date: string) => void;
  onEdit: (habit: Habit) => void;
  onRemove: (habit: Habit) => void;
}

function SortableHabitRow({
  entry,
  days,
  todayIso,
  onToggle,
  onEdit,
  onRemove,
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
        <span className="habit-freq-tag">
          {frequencyLabel(entry.habit.frequencyType, entry.habit.targetCount)}
        </span>
      </td>
      {days.map((day) => {
        const done = entry.completions[day.date];
        const isToday = day.date === todayIso;
        return (
          <td key={day.date} className={`habits-col-day ${isToday ? "today" : ""}`}>
            <button
              type="button"
              className={`habit-check ${done ? "done" : ""}`}
              onClick={() => onToggle(entry.habit.id, day.date)}
              aria-label={`${entry.habit.name} on ${day.label}`}
              aria-pressed={done}
            >
              {done && <IconCheck size={11} />}
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
            onClick={() => onRemove(entry.habit)}
            title="Delete habit"
          >
            <IconTrash />
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function HabitsWidget() {
  const [week, setWeek] = useState<HabitWeekView | null>(null);
  const [trends, setTrends] = useState<HabitTrendResult[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFreq, setNewFreq] = useState<HabitFrequencyType>("daily");
  const [newTarget, setNewTarget] = useState(3);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const load = useCallback(async (weekStart?: string) => {
    const [weekData, trendData] = await Promise.all([
      window.api.habits.getWeek(weekStart),
      window.api.habits.trends(),
    ]);
    setWeek(weekData);
    setTrends(trendData as HabitTrendResult[]);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function navigate(delta: number) {
    if (!week) return;
    await load(shiftWeek(week.weekStart, delta));
  }

  async function goToday() {
    await load();
  }

  async function handleToggle(habitId: number, date: string) {
    const updated = await window.api.habits.toggle(habitId, date);
    setWeek(updated);
    const trendData = await window.api.habits.trends();
    setTrends(trendData as HabitTrendResult[]);
  }

  async function handleDragEnd(e: DragEndEvent) {
    if (!week) return;
    const { active, over } = e;
    if (!over || active.id === over.id) return;

    const oldIndex = week.habits.findIndex((h) => h.habit.id === active.id);
    const newIndex = week.habits.findIndex((h) => h.habit.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reorderedHabits = arrayMove(week.habits, oldIndex, newIndex);
    setWeek({ ...week, habits: reorderedHabits });
    setTrends(reorderTrends(trends, reorderedHabits));
    await window.api.habits.reorder(reorderedHabits.map((h) => h.habit.id));
  }

  async function handleAdd() {
    if (!newName.trim()) return;
    await window.api.habits.add(
      newName,
      newFreq,
      newFreq === "times_per_week" ? newTarget : undefined
    );
    setNewName("");
    setNewFreq("daily");
    setNewTarget(3);
    setShowAdd(false);
    await load(week?.weekStart);
  }

  async function handleUpdate() {
    if (!editing || !editing.name.trim()) return;
    await window.api.habits.update(
      editing.id,
      editing.name,
      editing.frequencyType,
      editing.frequencyType === "times_per_week" ? editing.targetCount : undefined
    );
    setEditing(null);
    await load(week?.weekStart);
  }

  async function handleRemove(habit: Habit) {
    await window.api.habits.remove(habit.id);
    if (editing?.id === habit.id) setEditing(null);
    await load(week?.weekStart);
  }

  function startEdit(habit: Habit) {
    setEditing({
      id: habit.id,
      name: habit.name,
      frequencyType: habit.frequencyType,
      targetCount: habit.targetCount,
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

  return (
    <div className="habits-layout">
      <Panel
        title="This Week"
        headerRight={
          <div className="habits-week-nav">
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
                  items={week.habits.map((h) => h.habit.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <tbody>
                    {week.habits.map((entry) => (
                      <SortableHabitRow
                        key={entry.habit.id}
                        entry={entry}
                        days={week.days}
                        todayIso={todayIso}
                        onToggle={handleToggle}
                        onEdit={startEdit}
                        onRemove={handleRemove}
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
            <select
              value={editing.frequencyType}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  frequencyType: e.target.value as HabitFrequencyType,
                })
              }
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="times_per_week">Times per week</option>
            </select>
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
            <select
              value={newFreq}
              onChange={(e) => setNewFreq(e.target.value as HabitFrequencyType)}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="times_per_week">Times per week</option>
            </select>
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
      </Panel>

      {trends.length > 0 && (
        <Panel title="Trends — last 12 weeks">
          <div className="habit-trends-grid">
            {trends.map((t) => (
              <HabitTrendChart key={t.habit.id} trend={t} />
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
