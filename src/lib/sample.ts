// EPG source advertised in the m3u header (url-tvg). Off-host the mock bridge
// serves a generated guide for this sentinel URL (see buildSampleXmltv); it is
// never hit over the network in demo mode.
export const SAMPLE_EPG_URL = "https://anytub3.demo/sample-epg.xml";

// A built-in demo playlist of public, CORS-enabled HLS test streams
// (the same ones hls.js uses in its own demo). Lets AnyTub3 play real video
// end-to-end without hunting for a CORS-friendly IPTV provider (design R4).
export const SAMPLE_M3U = `#EXTM3U url-tvg="${SAMPLE_EPG_URL}"
#EXTINF:-1 tvg-id="mux.test" tvg-name="Mux Test" group-title="Demo",Mux — Test Stream
https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8
#EXTINF:-1 tvg-id="bbb" tvg-name="Big Buck Bunny" group-title="Demo",Big Buck Bunny
https://test-streams.mux.dev/pts_shift/master.m3u8
#EXTINF:-1 tvg-id="tos" tvg-name="Tears of Steel" group-title="Demo",Tears of Steel
https://test-streams.mux.dev/tos_ismc/main.m3u8
#EXTINF:-1 tvg-id="apple.bipbop" tvg-name="Apple BipBop" group-title="Demo",Apple — BipBop Advanced
https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8
`;

/** XMLTV timestamp: `YYYYMMDDHHMMSS +0000` (UTC). */
function xmltvTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())} +0000`
  );
}

/**
 * Build a small XMLTV guide for the demo channels, anchored on `now` so there is
 * always a current programme and a few upcoming ones. Generated at runtime (not
 * a static constant) so the demo guide never drifts into the past.
 */
export function buildSampleXmltv(now = Date.now()): string {
  const channels = [
    { id: "mux.test", name: "Mux Test", titles: ["Morning Mix", "Tech Today", "Deep Dive", "Night Owl"] },
    { id: "bbb", name: "Big Buck Bunny", titles: ["Shorts Block", "Feature Film", "Animator's Cut", "Late Loop"] },
    { id: "tos", name: "Tears of Steel", titles: ["Sci-Fi Hour", "The Main Event", "Behind the Scenes", "Encore"] },
    { id: "apple.bipbop", name: "Apple BipBop", titles: ["Stream Check", "Demo Reel", "Bitrate Ladder", "Standby"] },
  ];
  const HOUR = 3_600_000;
  // First programme started 20 min ago, then one per hour.
  const base = now - 20 * 60_000;
  let body = "";
  for (const ch of channels) {
    body += `  <channel id="${ch.id}"><display-name>${ch.name}</display-name></channel>\n`;
  }
  for (const ch of channels) {
    ch.titles.forEach((title, i) => {
      const start = base + i * HOUR;
      const stop = start + HOUR;
      body +=
        `  <programme start="${xmltvTime(start)}" stop="${xmltvTime(stop)}" channel="${ch.id}">\n` +
        `    <title>${title}</title>\n` +
        `    <desc>${ch.name} — ${title} (demo programme).</desc>\n` +
        `    <category>Demo</category>\n` +
        `  </programme>\n`;
    });
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n${body}</tv>\n`;
}
