import { useState } from "react";
import type { CalendarEvent, CalendarResult } from "../../../shared/types";
import Panel from "./Panel";
import { IconChevronLeft, IconChevronRight, IconExternal, IconNote, IconVideo } from "./icons";

interface CalendarWidgetProps {
  data: CalendarResult | null;
  onNavigate: (date: string) => Promise<void>;
  onConnect: () => Promise<void>;
}

function formatEventTime(event: CalendarEvent): string {
  if (event.allDay) return "All day";
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${fmt(event.start)} – ${fmt(event.end)}`;
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function CalendarRow({ event }: { event: CalendarEvent }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="todoist-item">
      <div className="row">
        <span className="cal-time">{formatEventTime(event)}</span>
        <span className="name link" onClick={() => window.api.openUrl(event.htmlLink)}>
          {event.summary}
          <IconExternal className="external-icon" />
        </span>
        {event.description && (
          <button
            className="desc-toggle"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? "Hide notes" : "Show notes"}
          >
            <IconNote />
          </button>
        )}
        <span className="due-meta">
          {event.meetingUrl && (
            <button
              className="desc-toggle"
              onClick={() => window.api.openUrl(event.meetingUrl!)}
              title="Join meeting"
            >
              <IconVideo />
            </button>
          )}
        </span>
      </div>
      {expanded && event.description && <div className="expand-note">{event.description}</div>}
    </div>
  );
}

export default function CalendarWidget({ data, onNavigate, onConnect }: CalendarWidgetProps) {
  let body;

  if (!data) {
    body = <p className="muted">Loading schedule…</p>;
  } else if (data.needsAuth) {
    body = (
      <div className="calendar-connect">
        <p className="muted">{data.reason}.</p>
        <button className="launch" onClick={onConnect}>
          <span>Connect Google Calendar</span>
        </button>
      </div>
    );
  } else if (!data.ok) {
    body = <p className="muted">{data.reason}.</p>;
  } else if (data.events.length === 0) {
    body = <p className="muted">Nothing on the calendar.</p>;
  } else {
    body = data.events.map((e) => <CalendarRow key={e.id} event={e} />);
  }

  return (
    <Panel
      title="Today's Schedule"
      headerRight={
        <div className="daily-nav">
          <button
            className="daily-nav-btn"
            onClick={() => data && onNavigate(shiftDate(data.date, -1))}
            title="Previous day"
          >
            <IconChevronLeft />
          </button>
          <span className="tag">{data?.date || ""}</span>
          <button
            className="daily-nav-btn"
            onClick={() => data && onNavigate(shiftDate(data.date, 1))}
            title="Next day"
          >
            <IconChevronRight />
          </button>
        </div>
      }
    >
      {body}
    </Panel>
  );
}
