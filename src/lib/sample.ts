// A built-in demo playlist of public, CORS-enabled HLS test streams
// (the same ones hls.js uses in its own demo). Lets AnyTub3 play real video
// end-to-end without hunting for a CORS-friendly IPTV provider (design R4).
export const SAMPLE_M3U = `#EXTM3U
#EXTINF:-1 tvg-id="mux.test" tvg-name="Mux Test" group-title="Demo",Mux — Test Stream
https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8
#EXTINF:-1 tvg-id="bbb" tvg-name="Big Buck Bunny" group-title="Demo",Big Buck Bunny
https://test-streams.mux.dev/pts_shift/master.m3u8
#EXTINF:-1 tvg-id="tos" tvg-name="Tears of Steel" group-title="Demo",Tears of Steel
https://test-streams.mux.dev/tos_ismc/main.m3u8
#EXTINF:-1 tvg-id="apple.bipbop" tvg-name="Apple BipBop" group-title="Demo",Apple — BipBop Advanced
https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8
`;
