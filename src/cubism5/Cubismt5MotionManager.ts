import { config } from "@/config";
import type { MotionManagerOptions } from "@/cubism-common/MotionManager";
import { MotionManager } from "@/cubism-common/MotionManager";
import { Cubism5ExpressionManager } from "@/cubism5/Cubism5ExpressionManager";
import type { Cubism5ModelSettings } from "@/cubism5/Cubism5ModelSettings";
import type { CubismSpec } from "@/cubism-common/CubismSpec";
import type { CubismModel } from "@cubism/model/cubismmodel";
import type { ACubismMotion } from "@cubism/motion/acubismmotion";
import { CubismMotion } from "@cubism/motion/cubismmotion";
import { CubismMotionJson } from "@cubism/motion/cubismmotionjson";
import { CubismMotionQueueManager } from "@cubism/motion/cubismmotionqueuemanager";
import { csmVector } from "@cubism/type/csmvector";
import type { Mutable } from "../types/helpers";
import { CubismId } from "@cubism/id/cubismid";

export class Cubism5MotionManager extends MotionManager<CubismMotion, CubismSpec.Motion> {
    readonly definitions: Partial<Record<string, CubismSpec.Motion[]>>;

    readonly groups = { idle: "Idle" } as const;

    readonly motionDataType = "json";

    readonly queueManager = new CubismMotionQueueManager();

    declare readonly settings: Cubism5ModelSettings;

    expressionManager?: Cubism5ExpressionManager;

    eyeBlinkIds: CubismId[];
    lipSyncIds: CubismId[];

    private _seconds: number = 0;

    constructor(settings: Cubism5ModelSettings, options?: MotionManagerOptions) {
        super(settings, options);

        this.definitions = settings.motions ?? {};
        this.eyeBlinkIds = settings.getEyeBlinkParameters() || [];
        this.lipSyncIds = settings.getLipSyncParameters() || [];

        this.init(options);
    }

    protected init(options?: MotionManagerOptions) {
        super.init(options);

        if (this.settings.expressions) {
            this.expressionManager = new Cubism5ExpressionManager(this.settings, options);
        }

        this.queueManager.setEventCallback((caller, eventValue, customData) => {
            this.emit("motion:" + eventValue);
        });
    }

    isFinished(): boolean {
        return this.queueManager.isFinished();
    }

    update(model: CubismModel, now: DOMHighResTimeStamp): boolean {
        this._seconds = now;
        return super.update(model, now);
    }

    protected _startMotion(
        motion: CubismMotion,
        onFinish?: (motion: CubismMotion) => void,
    ): number {
        motion.setFinishedMotionHandler(onFinish as (motion: ACubismMotion) => void);

        // Don't stop all motions - let the queue manager handle transitions
        // This allows loop motions to continue seamlessly

        return this.queueManager.startMotion(motion, false, this._seconds);
    }

    protected _stopAllMotions(): void {
        this.queueManager.stopAllMotions();
    }

    createMotion(data: object | string, group: string, definition: CubismSpec.Motion): CubismMotion {
        // Handle text data for Cubism 5 - convert to ArrayBuffer
        let arrayBuffer: ArrayBuffer;
        let byteLength: number;

        if (typeof data === "string") {
            const buffer = new TextEncoder().encode(data);
            arrayBuffer = buffer.buffer;
            byteLength = buffer.byteLength;
        } else {
            const jsonString = JSON.stringify(data);
            const buffer = new TextEncoder().encode(jsonString);
            arrayBuffer = buffer.buffer;
            byteLength = buffer.byteLength;
        }

        const motion = CubismMotion.create(arrayBuffer, byteLength);
        const json = new CubismMotionJson(arrayBuffer, byteLength);

        // Apply loop setting from motion JSON
        const isLoop = json.isMotionLoop();
        motion.setLoop(isLoop);

        const defaultFadingDuration =
            (group === this.groups.idle
                ? config.idleMotionFadingDuration
                : config.motionFadingDuration) / 1000;

        // fading duration priorities: model.json > motion.json > config (default)

        // overwrite the fading duration only when it's not defined in the motion JSON
        if (json.getMotionFadeInTime() === undefined) {
            motion.setFadeInTime(
                definition.FadeInTime !== undefined ? definition.FadeInTime : defaultFadingDuration,
            );
        }

        if (json.getMotionFadeOutTime() === undefined) {
            motion.setFadeOutTime(
                definition.FadeOutTime !== undefined ? definition.FadeOutTime : defaultFadingDuration,
            );
        }

        // Disable loop fade-in for seamless looping
        // When FadeInTime is 0, we don't want fade-in at each loop cycle
        if (isLoop && definition.FadeInTime === 0) {
            motion.setLoopFadeIn(false);
        }

        // Initialize with empty vectors to prevent null reference errors
        // The motion JSON already contains all necessary parameter information
        const emptyEyeBlinkVector = new csmVector<CubismId>();
        const emptyLipSyncVector = new csmVector<CubismId>();
        motion.setEffectIds(emptyEyeBlinkVector, emptyLipSyncVector);

        return motion;
    }

    getMotionFile(definition: CubismSpec.Motion): string {
        return definition.File;
    }

    protected getMotionName(definition: CubismSpec.Motion): string {
        return definition.File;
    }

    protected getSoundFile(definition: CubismSpec.Motion): string | undefined {
        return definition.Sound;
    }

    protected updateParameters(model: CubismModel, now: DOMHighResTimeStamp): boolean {
        return this.queueManager.doUpdateMotion(model, now);
    }

    destroy() {
        super.destroy();

        this.queueManager.release();
        (this as Partial<Mutable<this>>).queueManager = undefined;
    }
}
