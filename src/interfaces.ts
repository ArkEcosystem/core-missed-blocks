export interface MissedBlockDelegate {
    username: string;
    publicKey: string;
    address: string;
}

export interface MissedBlockTimestamp {
    /** Seconds since the network epoch (the value used in block timestamps). */
    epoch: number;
    /** Unix timestamp in seconds. */
    unix: number;
    /** ISO 8601 string in UTC. */
    human: string;
}

export interface MissedBlockPayload {
    /** The delegate that was scheduled for the slot but did not produce a block. */
    delegate: MissedBlockDelegate;
    /** The round the missed slot belonged to. */
    round: number;
    /** The slot number that went empty. */
    slot: number;
    /** When the missed slot started. */
    timestamp: MissedBlockTimestamp;
    /** The height the delegate should have forged (the height that the next block ended up taking). */
    height: number;
    /** The last block before the gap. */
    previousBlock: { id: string; height: number };
    /** The first block after the gap, whose arrival revealed the miss. */
    nextBlock: { id: string; height: number; generatorPublicKey: string };
}
