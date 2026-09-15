// Thin CRUD wrappers over
// window.api.settings.{vaults,githubRepos,processes,youtubeChannels,subreddits},
// same shape as useLinkList.ts: each mutator calls the IPC method and hands
// the freshly-returned full list back to the caller's setter. Used only by
// SettingsPage, which owns the array state locally.

import { useCallback } from "react";
import type {
  GitHubRepoConfig,
  GitHubRepoInput,
  ProcessConfig,
  SubredditConfig,
  VaultConfig,
  YouTubeChannelConfig,
} from "../../../shared/types";

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
    async (input: GitHubRepoInput) => {
      onChange(await window.api.settings.githubRepos.add(input));
    },
    [onChange]
  );
  const update = useCallback(
    async (id: number, input: GitHubRepoInput) => {
      onChange(await window.api.settings.githubRepos.update(id, input));
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

export function useYouTubeChannelSettingsList(
  onChange: (items: YouTubeChannelConfig[]) => void
) {
  const add = useCallback(
    async (label: string, channelId: string) => {
      onChange(await window.api.settings.youtubeChannels.add(label, channelId));
    },
    [onChange]
  );
  const update = useCallback(
    async (id: number, label: string, channelId: string) => {
      onChange(await window.api.settings.youtubeChannels.update(id, label, channelId));
    },
    [onChange]
  );
  const remove = useCallback(
    async (id: number) => {
      onChange(await window.api.settings.youtubeChannels.remove(id));
    },
    [onChange]
  );
  const reorder = useCallback(
    async (reorderedItems: YouTubeChannelConfig[]) => {
      onChange(reorderedItems);
      onChange(
        await window.api.settings.youtubeChannels.reorder(reorderedItems.map((i) => i.id))
      );
    },
    [onChange]
  );
  return { add, update, remove, reorder };
}

export function useSubredditSettingsList(onChange: (items: SubredditConfig[]) => void) {
  const add = useCallback(
    async (subreddit: string) => {
      onChange(await window.api.settings.subreddits.add(subreddit));
    },
    [onChange]
  );
  const update = useCallback(
    async (id: number, subreddit: string) => {
      onChange(await window.api.settings.subreddits.update(id, subreddit));
    },
    [onChange]
  );
  const remove = useCallback(
    async (id: number) => {
      onChange(await window.api.settings.subreddits.remove(id));
    },
    [onChange]
  );
  const reorder = useCallback(
    async (reorderedItems: SubredditConfig[]) => {
      onChange(reorderedItems);
      onChange(await window.api.settings.subreddits.reorder(reorderedItems.map((i) => i.id)));
    },
    [onChange]
  );
  return { add, update, remove, reorder };
}
