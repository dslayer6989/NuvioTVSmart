// Item type the player uses for live channels. Watch progress, Continue Watching and
// scrobbling all skip it, so live channels never show up as half-watched titles.
// (Kept in its own file so low-level modules can import it without pulling in the UI.)

export const LIVE_TV_ITEM_TYPE = "channel";

export function isLiveTvItemType(itemType) {
  return (
    String(itemType || "")
      .trim()
      .toLowerCase() === LIVE_TV_ITEM_TYPE
  );
}
