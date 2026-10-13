import { useEffect, useState } from "react";
import { useAssistantChat } from "../hooks/useAssistantChat";
import AssistantChat from "./AssistantChat";
import { IconX } from "./icons";

// The quick Assistant panel (see services/assistantWindow.ts). It is the same
// chat as the dashboard tab, in a frameless window: streaming, Stop, copy,
// regenerate and confirmation cards all work here. History, search and memory
// stay in the dashboard — "Open in dashboard" hands the chat over.
export default function AssistantQuickApp() {
  const chat = useAssistantChat();
  const [focusToken, setFocusToken] = useState(0);
  const { reset, conversationId } = chat;

  // The window is shown and hidden, never recreated, so React doesn't remount
  // between summons. Each one starts a fresh chat — a quick panel that
  // remembered yesterday's question would be a trap — except while a reply is
  // still in flight, which `reset` leaves alone (it refuses when busy).
  useEffect(() => {
    return window.api.onCommand((command) => {
      if (command.type !== "assistantPanelShown") return;
      reset();
      setFocusToken((t) => t + 1);
    });
  }, [reset]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        void window.api.assistant.hidePanel();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="assistant-quick">
      <div className="assistant-quick-head">
        <span className="assistant-quick-title">Assistant</span>
        <span className="assistant-quick-actions">
          {conversationId && (
            <button
              type="button"
              className="assistant-link"
              onClick={() => void window.api.assistant.openInDashboard(conversationId)}
            >
              Open in dashboard
            </button>
          )}
          <button
            type="button"
            className="assistant-link"
            onClick={() => void window.api.assistant.hidePanel()}
            aria-label="Close"
            title="Close (Esc)"
          >
            <IconX />
          </button>
        </span>
      </div>
      <AssistantChat
        chat={chat}
        focusToken={focusToken}
        onOpenSettings={() => void window.api.assistant.openInDashboard(null, true)}
        emptyState={<p className="muted">Ask about your tasks, schedule, notes, repos or Docker.</p>}
      />
    </div>
  );
}
