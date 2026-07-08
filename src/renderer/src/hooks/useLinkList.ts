// Wraps window.api.links CRUD calls for one list (Local Apps, Learning, or
// Claude Code). State itself still lives in App.tsx per the project's
// convention — this hook just calls the IPC and hands the resulting list
// back to the caller's setter, so widgets don't each re-implement the same
// add/update/remove/reorder plumbing.

import { useCallback } from "react";
import type { LinkItem, LinkListKind } from "../../../shared/types";

export function useLinkList(kind: LinkListKind, onChange: (items: LinkItem[]) => void) {
  const add = useCallback(
    async (label: string, link: string) => {
      onChange(await window.api.links.add(kind, label, link));
    },
    [kind, onChange]
  );

  const update = useCallback(
    async (id: number, label: string, link: string) => {
      onChange(await window.api.links.update(kind, id, label, link));
    },
    [kind, onChange]
  );

  const remove = useCallback(
    async (id: number) => {
      onChange(await window.api.links.remove(kind, id));
    },
    [kind, onChange]
  );

  // `reorderedItems` is the already drag-reordered array (dnd-kit computes
  // this locally via arrayMove). Apply it immediately for instant visual
  // feedback, then persist and reconcile with the canonical, saved order.
  const reorder = useCallback(
    async (reorderedItems: LinkItem[]) => {
      onChange(reorderedItems);
      onChange(await window.api.links.reorder(kind, reorderedItems.map((i) => i.id)));
    },
    [kind, onChange]
  );

  return { add, update, remove, reorder };
}
