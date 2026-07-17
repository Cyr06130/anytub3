import { useApp } from "@/state/store";
import { EpgView } from "@/components/EpgPanel";
import { ScreenHeader } from "@/components/ScreenHeader";

type EpgGuideProps = {
  playlistId: string;
  channelId: string;
};

/** Full-screen programme guide for one channel (opened from the library). */
export function EpgGuide({ playlistId, channelId }: EpgGuideProps) {
  const { playlists } = useApp();
  const playlist = playlists.find((p) => p.id === playlistId);
  const channel = playlist?.entries.find((c) => c.id === channelId);

  if (!playlist || !channel) {
    return (
      <section className="flex flex-col gap-4">
        <ScreenHeader title="Programme guide" />
        <p className="text-fg-secondary">Channel not found.</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <ScreenHeader title={channel.name} description={channel.group} />
      <EpgView playlist={playlist} channel={channel} />
    </section>
  );
}
