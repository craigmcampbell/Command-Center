import type { SpotifyNowPlayingResult } from "../../../shared/types";

interface NowPlayingBannerProps {
  data: SpotifyNowPlayingResult | null;
}

export default function NowPlayingBanner({ data }: NowPlayingBannerProps) {
  if (!data?.ok || !data.playing) return null;

  return (
    <div className="now-playing-banner">
      {data.artworkUrl && <img className="now-playing-art" src={data.artworkUrl} alt="" />}
      <div className="now-playing-meta">
        <span className="now-playing-title">{data.track}</span>
        <span className="now-playing-sub">
          {data.artist}
          {data.album ? ` — ${data.album}` : ""}
        </span>
      </div>
    </div>
  );
}
