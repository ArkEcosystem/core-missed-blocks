import { Container, Contracts, Enums, Providers } from "@arkecosystem/core-kernel";
import Joi from "joi";

import { DetectorOptions, MissedBlockDetector } from "./detector";
import { Identifiers } from "./identifiers";

export class ServiceProvider extends Providers.ServiceProvider {
    private unlisten?: () => void;

    public async register(): Promise<void> {
        this.app.bind<DetectorOptions>(Identifiers.Options).toConstantValue({
            emitWhileSyncing: this.config().get<boolean>("emitWhileSyncing") === true,
        });

        this.app.bind<MissedBlockDetector>(Identifiers.Detector).to(MissedBlockDetector).inSingletonScope();
    }

    public async boot(): Promise<void> {
        this.unlisten = this.app
            .get<Contracts.Kernel.EventDispatcher>(Container.Identifiers.EventDispatcherService)
            .listen(Enums.BlockEvent.Applied, this.app.get<MissedBlockDetector>(Identifiers.Detector));

        this.app
            .get<Contracts.Kernel.Logger>(Container.Identifiers.LogService)
            .info("[missed-blocks] Listening for missed blocks");
    }

    public async dispose(): Promise<void> {
        if (this.unlisten) {
            this.unlisten();
            this.unlisten = undefined;
        }
    }

    public async bootWhen(): Promise<boolean> {
        return this.config().get("enabled") === true;
    }

    public configSchema(): object {
        return Joi.object({
            enabled: Joi.boolean().required(),
            emitWhileSyncing: Joi.boolean().required(),
        }).unknown(true);
    }
}
