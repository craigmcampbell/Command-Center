// The top-level tab strip: a plain row of buttons. Order, labels and which tabs
// are shown are managed in Settings → Tabs; this only renders what it is given.
// Tab *content* is still gated on the fixed TabId union in App.tsx.

import type { TabConfig } from "../../../shared/types";

interface TabBarProps {
  tabs: TabConfig[];
  activeId: string;
  onSelect: (id: string) => void;
}

export default function TabBar({ tabs, activeId, onSelect }: TabBarProps) {
  return (
    <nav className="tabs">
      {tabs.map((tab) => (
        <span key={tab.id} className={`tab ${tab.id === activeId ? "active" : ""}`}>
          <button type="button" className="tab-label" onClick={() => onSelect(tab.id)}>
            {tab.label}
          </button>
        </span>
      ))}
    </nav>
  );
}
