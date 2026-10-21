import { MediaServerScrobbleService } from "../mediaserver/mediaServerScrobbleService.js";
import { TraktScrobbleService } from "./traktScrobbleService.js";
import { SimklScrobbleService } from "./simklScrobbleService.js";

const providers = [MediaServerScrobbleService, TraktScrobbleService, SimklScrobbleService];

function enabledProviders() {
  return providers.filter((provider) => provider.isEnabled());
}

// Live TV channels are never scrobbled to Trakt, Simkl or a media server.
function isTrackable(context) {
  return !context?.liveTv;
}

export const TrackingScrobbleService = {
  isEnabled() {
    return enabledProviders().length > 0;
  },

  start(context) {
    if (!isTrackable(context)) return;
    enabledProviders().forEach((provider) => provider.start(context));
  },

  pause(context) {
    if (!isTrackable(context)) return;
    enabledProviders().forEach((provider) => provider.pause(context));
  },

  stop(context) {
    if (!isTrackable(context)) return;
    enabledProviders().forEach((provider) => provider.stop(context));
  },

  cancel() {
    providers.forEach((provider) => provider.cancel());
  }
};
