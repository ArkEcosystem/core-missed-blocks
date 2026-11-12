import { DatabaseService } from "@arkecosystem/core-database";
import { Container, Contracts, Services, Utils as AppUtils } from "@arkecosystem/core-kernel";
import { Crypto, Interfaces } from "@arkecosystem/crypto";

import { MissedBlockEvent } from "./events";
import { Identifiers } from "./identifiers";
import { MissedBlockPayload } from "./interfaces";

export interface DetectorOptions {
    emitWhileSyncing: boolean;
}

/**
 * Listens for `block.applied` and compares the slot of the new block with the slot
 * of the block before it. Every slot in between went empty, and the delegate that
 * was scheduled for it gets a `block.missed` event.
 *
 * The slot -> delegate mapping is the same one Core uses to validate block
 * generators (core-blockchain's BlockProcessor), so the delegate we report is
 * exactly the one Core expected to forge in that slot.
 */
@Container.injectable()
export class MissedBlockDetector implements Contracts.Kernel.EventListener {
    @Container.inject(Container.Identifiers.Application)
    private readonly app!: Contracts.Kernel.Application;

    @Container.inject(Container.Identifiers.EventDispatcherService)
    private readonly events!: Contracts.Kernel.EventDispatcher;

    @Container.inject(Container.Identifiers.LogService)
    private readonly logger!: Contracts.Kernel.Logger;

    @Container.inject(Container.Identifiers.StateStore)
    private readonly stateStore!: Contracts.State.StateStore;

    @Container.inject(Container.Identifiers.DatabaseService)
    private readonly databaseService!: DatabaseService;

    @Container.inject(Container.Identifiers.TriggerService)
    private readonly triggers!: Services.Triggers.Triggers;

    @Container.inject(Container.Identifiers.BlockchainService)
    private readonly blockchain!: Contracts.Blockchain.Blockchain;

    @Container.inject(Identifiers.Options)
    private readonly options!: DetectorOptions;

    // Slots we already reported. Guards against duplicates when a block is reverted
    // and another one is applied at the same height (forks / rollbacks).
    private readonly reportedSlots: Set<number> = new Set();
    private static readonly maxReportedSlots = 1000;

    public handle({ data }: { name: Contracts.Kernel.EventName; data: Interfaces.IBlockData }): void {
        // EventListener.handle is typed as sync; run the async work and make sure
        // a failure here never bubbles up into Core.
        this.detect(data).catch((error) =>
            this.logger.error(`[missed-blocks] Failed to check block ${data?.height}: ${error.stack ?? error}`),
        );
    }

    private async detect(block: Interfaces.IBlockData): Promise<void> {
        // Same guard as Core: there is nothing to compare against before height 2,
        // and the genesis block's timestamp isn't a real forging slot.
        if (!block || block.height <= 2) {
            return;
        }

        if (!this.options.emitWhileSyncing && !this.blockchain.isSynced(block)) {
            return;
        }

        const previousBlock = await this.findBlockByHeight(block.height - 1);

        if (!previousBlock) {
            this.logger.debug(`[missed-blocks] Could not find block ${block.height - 1}, skipping check.`);
            return;
        }

        const blockTimeLookup = await AppUtils.forgingInfoCalculator.getBlockTimeLookup(this.app, block.height);

        const previousSlot: number = Crypto.Slots.getSlotNumber(
            blockTimeLookup,
            previousBlock.timestamp,
            previousBlock.height,
        );
        const currentSlot: number = Crypto.Slots.getSlotNumber(blockTimeLookup, block.timestamp, block.height);

        if (currentSlot - previousSlot <= 1) {
            return;
        }

        // The empty slots were competing for this block's height, so they belong to
        // this height's round. This is also what Core does when it validates the generator.
        const roundInfo: Contracts.Shared.RoundInfo = AppUtils.roundCalculator.calculateRound(block.height);
        const delegates = (await this.triggers.call("getActiveDelegates", {
            roundInfo,
        })) as Contracts.State.Wallet[];

        if (!delegates || !delegates.length) {
            this.logger.debug(`[missed-blocks] No active delegates for round ${roundInfo.round}, skipping check.`);
            return;
        }

        // Like Core, cap at one full rotation: past that every delegate has missed at
        // least once and we would start reporting the same delegates again.
        const missedSlots: number = Math.min(currentSlot - previousSlot - 1, delegates.length);

        for (let i = 1; i <= missedSlots; i++) {
            const slot: number = previousSlot + i;

            if (this.reportedSlots.has(slot)) {
                continue;
            }

            const slotTime: number = Crypto.Slots.getSlotTime(blockTimeLookup, slot, block.height);
            const forgingInfo: Contracts.Shared.ForgingInfo = AppUtils.forgingInfoCalculator.calculateForgingInfo(
                slotTime,
                block.height,
                blockTimeLookup,
            );
            const delegate: Contracts.State.Wallet | undefined = delegates[forgingInfo.currentForger];

            if (!delegate) {
                continue;
            }

            const payload: MissedBlockPayload = {
                delegate: {
                    username: delegate.getAttribute<string>("delegate.username"),
                    publicKey: delegate.getPublicKey()!,
                    address: delegate.getAddress(),
                },
                round: roundInfo.round,
                slot,
                timestamp: AppUtils.formatTimestamp(slotTime),
                height: block.height,
                previousBlock: { id: previousBlock.id!, height: previousBlock.height },
                nextBlock: {
                    id: block.id!,
                    height: block.height,
                    generatorPublicKey: block.generatorPublicKey,
                },
            };

            this.remember(slot);

            this.logger.debug(
                `[missed-blocks] Delegate ${payload.delegate.username} (${payload.delegate.publicKey}) missed slot ${slot} in round ${roundInfo.round}.`,
            );

            await this.events.dispatch(MissedBlockEvent.Missed, payload);
        }
    }

    private async findBlockByHeight(height: number): Promise<Interfaces.IBlockData | undefined> {
        // Recent blocks are kept in memory; fall back to the database when the
        // handler runs late (e.g. while Core is processing a large batch).
        const [cached] = this.stateStore.getLastBlocksByHeight(height, height, true);

        if (cached) {
            return cached;
        }

        const [stored] = await this.databaseService.findBlockByHeights([height]);

        return stored;
    }

    private remember(slot: number): void {
        this.reportedSlots.add(slot);

        if (this.reportedSlots.size > MissedBlockDetector.maxReportedSlots) {
            // Sets iterate in insertion order, so this drops the oldest slot.
            const oldest = this.reportedSlots.values().next().value;
            this.reportedSlots.delete(oldest);
        }
    }
}
