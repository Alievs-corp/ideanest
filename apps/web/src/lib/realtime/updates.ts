/*
 * §12.1's wire format — the channels, the socket address, the frame parser, the Decimal running
 * total and the reconnect policy — lives in `@ideanest/campaign/realtime` since #155, so the
 * app's live counter reads frames exactly as this page does. Re-exported under the same names;
 * the connection itself is `useCampaignUpdates`, which stays here.
 */
export {
  REALTIME_ORIGIN_VARIABLE,
  addToTotal,
  commentsChannel,
  counterChannel,
  parseUpdate,
  realtimeUrl,
  type CampaignUpdate,
} from '@ideanest/campaign/realtime';
