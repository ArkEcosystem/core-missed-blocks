# core-missed-blocks

An ARK Core (v3) plugin that dispatches a `block.missed` event every time a delegate misses its forging slot.

## How it works

The plugin listens for Core's `block.applied` event. For every applied block it looks up the block before it and compares their slot numbers. Each slot in between went empty, and the plugin works out which delegate was scheduled for that slot using the same calculation Core uses to validate block generators (`forgingInfoCalculator.calculateForgingInfo` against the round's active delegates, via the `getActiveDelegates` trigger). For each of those delegates it dispatches `block.missed`.

Because detection relies on the next block arriving, the event fires when the block after the gap is applied, not at the exact moment the slot expires.

## Installation

```bash
ark plugin:install core-missed-blocks
# or, from a local checkout
yarn build && yarn link   # then `yarn link core-missed-blocks` inside your Core install
```

Register it in your network's `app.json` (for example `~/.config/ark-core/mainnet/app.json`), under `relay` and/or `core`, **after** `@arkecosystem/core-blockchain`:

```json
{
    "package": "core-missed-blocks",
    "options": {
        "enabled": true,
        "emitWhileSyncing": false
    }
}
```

## Options

| Option             | Default | Env variable                            | Description                                                                                                       |
| ------------------ | ------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `enabled`          | `true`  | `CORE_MISSED_BLOCKS_ENABLED=false`      | Turns the plugin off.                                                                                             |
| `emitWhileSyncing` | `false` | `CORE_MISSED_BLOCKS_EMIT_WHILE_SYNCING` | Also emit for historical gaps while the node is syncing or rebuilding. Off by default to avoid a flood on startup. |

## Payload

```ts
{
    delegate: { username: string; publicKey: string; address: string };
    round: number;          // round the missed slot belonged to
    slot: number;           // the empty slot number
    timestamp: { epoch: number; unix: number; human: string }; // start of the missed slot
    height: number;         // height the delegate should have forged
    previousBlock: { id: string; height: number };
    nextBlock: { id: string; height: number; generatorPublicKey: string };
}
```

## Listening for the event

From another plugin:

```ts
import { Container, Contracts } from "@arkecosystem/core-kernel";
import { MissedBlockEvent, MissedBlockPayload } from "core-missed-blocks";

app.get<Contracts.Kernel.EventDispatcher>(Container.Identifiers.EventDispatcherService).listen(
    MissedBlockEvent.Missed, // "block.missed"
    {
        handle: ({ data }: { data: MissedBlockPayload }) => {
            console.log(`${data.delegate.username} missed slot ${data.slot} in round ${data.round}`);
        },
    },
);
```

Through `@arkecosystem/core-webhooks`: the webhooks plugin listens to every event (`*`), so you can register a webhook with `"event": "block.missed"` and receive the payload above over HTTP with no extra code.

## Notes

- Like Core's own detection, a single gap reports at most one full rotation of delegates (one miss per active delegate).
- Reported slots are remembered (last 1000) so a fork or rollback that re-applies a block at the same height doesn't produce duplicate events. A miss reported for a block that is later reverted is not retracted.
- Core already dispatches `forger.missing` (with only `{ delegate }`) and `round.missed` (delegates who produced nothing in a whole round). This plugin adds a per-slot event with enough context to act on.
