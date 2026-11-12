export const defaults = {
    enabled: process.env.CORE_MISSED_BLOCKS_ENABLED !== "false",
    // When false, gaps are ignored while the node is catching up (syncing / rebuilding),
    // so you don't get a flood of historical "block.missed" events on startup.
    emitWhileSyncing: process.env.CORE_MISSED_BLOCKS_EMIT_WHILE_SYNCING === "true",
};
