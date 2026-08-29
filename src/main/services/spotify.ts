// Reads the currently-playing track from the local Spotify.app via
// AppleScript — no Spotify Web API, no OAuth. Same "shell out to a local
// macOS app" convention as services/forklift.ts.

import { execFile } from "node:child_process";
import type { SpotifyNowPlayingResult } from "../../shared/types";

// Delimiter is the ASCII unit separator (0x1F), not a comma — track/artist/
// album text could plausibly contain a comma. The outer try/on error
// collapses any transient failure (e.g. Spotify quits between the "is
// running" check and the tell block) into NOT_RUNNING rather than an
// execFile error. artwork url gets its own inner try since it can throw or
// return empty for local files not synced to Spotify's CDN.
const SCRIPT = `
try
  if application "Spotify" is running then
    tell application "Spotify"
      if player state is playing then
        set trackName to name of current track
        set trackArtist to artist of current track
        set trackAlbum to album of current track
        try
          set trackArtwork to artwork url of current track
        on error
          set trackArtwork to ""
        end try
        return "PLAYING" & (ASCII character 31) & trackName & (ASCII character 31) & trackArtist & (ASCII character 31) & trackAlbum & (ASCII character 31) & trackArtwork
      else
        return "PAUSED"
      end if
    end tell
  else
    return "NOT_RUNNING"
  end if
on error
  return "NOT_RUNNING"
end try
`;

export function getNowPlaying(): Promise<SpotifyNowPlayingResult> {
  return new Promise((resolve) => {
    if (process.platform !== "darwin") {
      resolve({ ok: false, reason: "macOS only", playing: false });
      return;
    }

    execFile("osascript", ["-e", SCRIPT], { timeout: 5000 }, (err, stdout) => {
      if (err) {
        resolve({ ok: false, reason: err.message, playing: false });
        return;
      }

      const [state, track, artist, album, artworkUrl] = stdout.trim().split("");

      if (state === "NOT_RUNNING" || state === "PAUSED") {
        resolve({ ok: true, playing: false });
        return;
      }

      if (state === "PLAYING") {
        resolve({ ok: true, playing: true, track, artist, album, artworkUrl: artworkUrl || undefined });
        return;
      }

      resolve({ ok: false, reason: "Unexpected Spotify response", playing: false });
    });
  });
}
