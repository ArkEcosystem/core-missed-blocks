/**
 * Events dispatched by this plugin.
 *
 * Core's own `Enums.BlockEvent` has no "missed" member, so we define it here.
 * Anything with access to the event dispatcher (other plugins, core-webhooks)
 * can listen for "block.missed" just like any built-in event.
 */
export enum MissedBlockEvent {
    Missed = "block.missed",
}
