// Thin CRUD wrappers over window.api.settings.{vaults,githubRepos,processes},
// same shape as useLinkList.ts: each mutator calls the IPC method and hands
// the freshly-returned full list back to the caller's setter. Used only by
// SettingsPage, which owns the array state locally.

import { useCallback } from "react";
import type { GitHubRepoConfig, ProcessConfig, VaultConfig } from "../../../shared/types";

export function useVaultSettingsList(onChange: (items: VaultConfig[]) => void) {
  const add = useCallback(
    async (label: string, path: string) => {
      onChange(await window.api.settings.vaults.add(label, path));
    },
    [onChange]
  );
  const update = useCallback(
    async (id: number, label: string, path: string) => {
      onChange(await window.api.settings.vaults.update(id, label, path));
    },
    [onChange]
  );
  const remove = useCallback(
    async (id: number) => {
      onChange(await window.api.settings.vaults.remove(id));
    },
    [onChange]
  );
  const reorder = useCallback(
    async (reorderedItems: VaultConfig[]) => {
      onChange(reorderedItems);
      onChange(await window.api.settings.vaults.reorder(reorderedItems.map((i) => i.id)));
    },
    [onChange]
  );
  return { add, update, remove, reorder };
}

export function useGithubRepoSettingsList(onChange: (items: GitHubRepoConfig[]) => void) {
  const add = useCallback(
    async (label: string, owner: string, repo: string, branch: string) => {
      onChange(await window.api.settings.githubRepos.add(label, owner, repo, branch));
    },
    [onChange]
  );
  const update = useCallback(
    async (id: number, label: string, owner: string, repo: string, branch: string) => {
      onChange(await window.api.settings.githubRepos.update(id, label, owner, repo, branch));
    },
    [onChange]
  );
  const remove = useCallback(
    async (id: number) => {
      onChange(await window.api.settings.githubRepos.remove(id));
    },
    [onChange]
  );
  const reorder = useCallback(
    async (reorderedItems: GitHubRepoConfig[]) => {
      onChange(reorderedItems);
      onChange(await window.api.settings.githubRepos.reorder(reorderedItems.map((i) => i.id)));
    },
    [onChange]
  );
  return { add, update, remove, reorder };
}

export function useProcessSettingsList(onChange: (items: ProcessConfig[]) => void) {
  const add = useCallback(
    async (proc: Omit<ProcessConfig, "sortOrder">) => {
      onChange(await window.api.settings.processes.add(proc));
    },
    [onChange]
  );
  const update = useCallback(
    async (id: string, proc: Omit<ProcessConfig, "id" | "sortOrder">) => {
      onChange(await window.api.settings.processes.update(id, proc));
    },
    [onChange]
  );
  const remove = useCallback(
    async (id: string) => {
      onChange(await window.api.settings.processes.remove(id));
    },
    [onChange]
  );
  const reorder = useCallback(
    async (reorderedItems: ProcessConfig[]) => {
      onChange(reorderedItems);
      onChange(await window.api.settings.processes.reorder(reorderedItems.map((i) => i.id)));
    },
    [onChange]
  );
  return { add, update, remove, reorder };
}
