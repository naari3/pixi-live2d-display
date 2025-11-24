import type { InternalModel, ModelSettings, MotionPriority } from "@/cubism-common";
import type { MotionManagerOptions } from "@/cubism-common/MotionManager";
import type { Live2DFactoryOptions } from "@/factory/Live2DFactory";
import { Live2DFactory } from "@/factory/Live2DFactory";
import type { Renderer, Texture, Ticker, WebGLRenderer } from "pixi.js";
import { Matrix, ObservablePoint, Point, Container, Rectangle } from "pixi.js";
import { Automator, type AutomatorOptions } from "./Automator";
import { Live2DTransform } from "./Live2DTransform";
import type { JSONObject } from "./types/helpers";
import { logger, AudioAnalyzer } from "./utils";

export interface Live2DModelOptions extends MotionManagerOptions, AutomatorOptions { }

/**
 * Interface for WebGL context with PixiJS UID extension
 */
interface WebGLContextWithUID extends WebGL2RenderingContext {
    _pixiContextUID?: number;
}

const tempPoint = new Point();
const tempMatrix = new Matrix();

export type Live2DConstructor = { new(options?: Live2DModelOptions): Live2DModel };

/**
 * A wrapper that allows the Live2D model to be used as a DisplayObject in PixiJS.
 *
 * ```js
 * const model = await Live2DModel.from('shizuku.model.json');
 * container.add(model);
 * ```
 * @emits {@link Live2DModelEvents}
 */
export class Live2DModel<IM extends InternalModel = InternalModel> extends Container {
    /**
     * Creates a Live2DModel from given source.
     * @param source - Can be one of: settings file URL, settings JSON object, ModelSettings instance.
     * @param options - Options for the creation.
     * @return Promise that resolves with the Live2DModel.
     */
    static from<M extends Live2DConstructor = typeof Live2DModel>(
        this: M,
        source: string | JSONObject | ModelSettings,
        options?: Live2DFactoryOptions,
    ): Promise<InstanceType<M>> {
        const model = new this(options) as InstanceType<M>;

        return Live2DFactory.setupLive2DModel(model, source, options).then(() => model);
    }

    /**
     * Synchronous version of `Live2DModel.from()`. This method immediately returns a Live2DModel instance,
     * whose resources have not been loaded. Therefore this model can't be manipulated or rendered
     * until the "load" event has been emitted.
     *
     * ```js
     * // no `await` here as it's not a Promise
     * const model = Live2DModel.fromSync('shizuku.model.json');
     *
     * // these will cause errors!
     * // app.stage.addChild(model);
     * // model.motion('tap_body');
     *
     * model.once('load', () => {
     *     // now it's safe
     *     app.stage.addChild(model);
     *     model.motion('tap_body');
     * });
     * ```
     */
    static fromSync<M extends Live2DConstructor = typeof Live2DModel>(
        this: M,
        source: string | JSONObject | ModelSettings,
        options?: Live2DFactoryOptions,
    ): InstanceType<M> {
        const model = new this(options) as InstanceType<M>;

        Live2DFactory.setupLive2DModel(model, source, options)
            .then(options?.onLoad)
            .catch(options?.onError);

        return model;
    }

    /**
     * Registers the class of `PIXI.Ticker` for auto updating.
     * @deprecated Use {@link Live2DModelOptions.ticker} instead.
     */
    static registerTicker(tickerClass: typeof Ticker): void {
        Automator["defaultTicker"] = tickerClass.shared;
    }

    /**
     * Tag for logging.
     */
    tag = "Live2DModel(uninitialized)";

    /**
     * The internal model. Will be undefined until the "ready" event is emitted.
     */
    internalModel?: IM;

    /**
     * Pixi textures.
     */
    textures: Texture[] = [];

    /** @override */
    transform = new Live2DTransform();

    /**
     * The anchor behaves like the one in `PIXI.Sprite`, where `(0, 0)` means the top left
     * and `(1, 1)` means the bottom right.
     */
    anchor = new ObservablePoint({ _onUpdate: this.onAnchorChange.bind(this) }, 0, 0); // cast the type because it breaks the casting of Live2DModel

    /**
     * An ID of Gl context that syncs with `renderer.CONTEXT_UID`. Used to check if the GL context has changed.
     */
    protected glContextID = -1;

    /**
     * Cached renderer reference for type safety
     */
    protected renderer?: WebGLRenderer;

    /**
     * Elapsed time in milliseconds since created.
     */
    elapsedTime: DOMHighResTimeStamp = 0;

    /**
     * Elapsed time in milliseconds from last frame to this frame.
     */
    deltaTime: DOMHighResTimeStamp = 0;

    automator: Automator;

    /**
     * Audio analyzer for speech recognition and lip sync.
     */
    private audioAnalyzer: AudioAnalyzer | null = null;

    /**
     * Current speaking state.
     */
    private isSpeaking = false;

    constructor(options?: Live2DModelOptions) {
        super();

        this.automator = new Automator(this, options);

        // In Pixi.js v8, use onRender callback instead of _render override
        this.onRender = this._onRenderCallback.bind(this);

        this.once("modelLoaded", () => this.init(options));
    }

    /**
     * Sets the renderer reference for type safety
     */
    setRenderer(renderer: Renderer): void {
        if (this.isWebGLRenderer(renderer)) {
            this.renderer = renderer;
        }
    }

    /**
     * Type guard to check if renderer is WebGLRenderer
     */
    private isWebGLRenderer(renderer: Renderer): renderer is WebGLRenderer {
        return 'gl' in renderer && renderer.gl instanceof WebGL2RenderingContext;
    }

    // TODO: rename
    /**
     * A handler of the "modelLoaded" event, invoked when the internal model has been loaded.
     */
    protected init(_options?: Live2DModelOptions) {
        if (!this.isReady()) {
            return;
        }

        this.tag = `Live2DModel(${this.internalModel.settings.name})`;

        // Update bounds area now that the internal model is loaded
        this.updateBoundsArea();
    }

    /**
     * Checks if the model is ready (internal model is loaded).
     */
    isReady(): this is Live2DModel<IM> & { internalModel: IM } {
        return this.internalModel !== undefined;
    }

    /**
     * Checks if the model can render (ready and has textures).
     */
    canRender(): boolean {
        return this.isReady() && this.textures.length > 0;
    }

    /**
     * Checks if the renderer is available and valid.
     */
    hasValidRenderer(): boolean {
        return this.renderer !== undefined && this.renderer.gl instanceof WebGL2RenderingContext;
    }

    /**
     * Type guard for WebGLTexture
     */
    private isWebGLTexture(texture: unknown): texture is WebGLTexture {
        return texture instanceof WebGLTexture;
    }

    /**
     * Extracts WebGLTexture from PixiJS texture with proper type safety
     */
    private extractWebGLTexture(renderer: WebGLRenderer, texture: Texture): WebGLTexture | null {
        if (!renderer.texture || !texture.source) {
            return null;
        }

        try {
            // Get the WebGL source wrapper first
            const glSource = renderer.texture.getGlSource(texture.source);

            if (glSource && (glSource as any).texture) {
                // Extract the actual WebGL texture from the wrapper
                return (glSource as any).texture;
            }

            // Fallback: try the internal _glTextures approach
            const textureSourceWithGL = texture.source as any;
            if (textureSourceWithGL?._glTextures) {
                const contextTextures = textureSourceWithGL._glTextures[this.glContextID];
                return contextTextures?.texture || contextTextures;
            }
        } catch (error) {
            console.warn('Failed to extract WebGL texture:', error);
        }

        return null;
    }

    /**
     * A callback that observes {@link anchor}, invoked when the anchor's values have been changed.
     */
    protected onAnchorChange(): void {
        if (this.isReady()) {
            this.pivot.set(
                this.anchor.x * this.internalModel.width,
                this.anchor.y * this.internalModel.height,
            );
        }
    }

    /**
     * Shorthand to start a motion.
     * @param group - The motion group.
     * @param index - The index in this group. If not presented, a random motion will be started.
     * @param priority - The motion priority. Defaults to `MotionPriority.NORMAL`.
     * @return Promise that resolves with true if the motion is successfully started, with false otherwise.
     */
    motion(group: string, index?: number, priority?: MotionPriority): Promise<boolean> {
        if (!this.isReady()) {
            return Promise.resolve(false);
        }
        return index === undefined
            ? this.internalModel.motionManager.startRandomMotion(group, priority)
            : this.internalModel.motionManager.startMotion(group, index, priority);
    }

    /**
     * Shorthand to set an expression.
     * @param id - Either the index, or the name of the expression. If not presented, a random expression will be set.
     * @return Promise that resolves with true if succeeded, with false otherwise.
     */
    expression(id?: number | string): Promise<boolean> {
        if (!this.isReady() || !this.internalModel.motionManager.expressionManager) {
            return Promise.resolve(false);
        }
        return id === undefined
            ? this.internalModel.motionManager.expressionManager.setRandomExpression()
            : this.internalModel.motionManager.expressionManager.setExpression(id);
    }

    /**
     * Updates the focus position. This will not cause the model to immediately look at the position,
     * instead the movement will be interpolated.
     * @param x - Position in world space.
     * @param y - Position in world space.
     * @param instant - Should the focus position be instantly applied.
     */
    focus(x: number, y: number, instant: boolean = false): void {
        if (!this.isReady()) {
            return;
        }

        tempPoint.x = x;
        tempPoint.y = y;

        // we can pass `true` as the third argument to skip the update transform
        // because focus won't take effect until the model is rendered,
        // and a model being rendered will always get transform updated
        this.toModelPosition(tempPoint, tempPoint, true);

        const tx = (tempPoint.x / this.internalModel.originalWidth) * 2 - 1;
        const ty = (tempPoint.y / this.internalModel.originalHeight) * 2 - 1;
        const radian = Math.atan2(ty, tx);
        this.internalModel.focusController.focus(Math.cos(radian), -Math.sin(radian), instant);
    }

    /**
     * Tap on the model. This will perform a hit-testing, and emit a "hit" event
     * if at least one of the hit areas is hit.
     * @param x - Position in world space.
     * @param y - Position in world space.
     * @emits {@link Live2DModelEvents.hit}
     */
    tap(x: number, y: number): void {
        const hitAreaNames = this.hitTest(x, y);

        if (hitAreaNames.length) {
            logger.log(this.tag, `Hit`, hitAreaNames);

            this.emit("hit", hitAreaNames);
        }
    }

    /**
     * Hit-test on the model.
     * @param x - Position in world space.
     * @param y - Position in world space.
     * @return The names of the *hit* hit areas. Can be empty if none is hit.
     */
    hitTest(x: number, y: number): string[] {
        if (!this.isReady()) {
            return [];
        }

        tempPoint.x = x;
        tempPoint.y = y;
        this.toModelPosition(tempPoint, tempPoint);

        return this.internalModel.hitTest(tempPoint.x, tempPoint.y);
    }

    /**
     * Calculates the position in the canvas of original, unscaled Live2D model.
     * @param position - A Point in world space.
     * @param result - A Point to store the new value. Defaults to a new Point.
     * @param skipUpdate - True to skip the update transform.
     * @return The Point in model canvas space.
     */
    toModelPosition(
        position: Point,
        result: Point = position.clone(),
        _skipUpdate?: boolean,
    ): Point {
        // In Pixi.js v8, use toLocal method instead of manual worldTransform.applyInverse
        // First convert to local coordinates of this Live2DModel
        const localPosition = this.toLocal(position, undefined, result);

        // Then apply the internal model's local transform if model is ready
        if (this.isReady()) {
            this.internalModel.localTransform.applyInverse(localPosition, localPosition);
        }

        return localPosition;
    }

    /**
     * A method required by `PIXI.InteractionManager` to perform hit-testing.
     * @param point - A Point in world space.
     * @return True if the point is inside this model.
     */
    containsPoint(point: Point): boolean {
        // In Pixi.js v8, getBounds() returns a Bounds object, access Rectangle via .rectangle
        return this.getBounds(true).rectangle.contains(point.x, point.y);
    }

    /**
     * Updates the boundsArea based on the internal model dimensions
     */
    private updateBoundsArea(): void {
        if (this.isReady() && this.internalModel.width && this.internalModel.height) {
            // Set boundsArea with actual model dimensions
            this.boundsArea = new Rectangle(0, 0, this.internalModel.width, this.internalModel.height);
        } else if (!this.boundsArea) {
            // Fallback to default size if internal model isn't ready and no boundsArea is set
            this.boundsArea = new Rectangle(0, 0, 512, 512);
        }
    }


    /**
     * Gets a unique ID for the WebGL context
     */
    private _getContextUID(gl: WebGL2RenderingContext): number {
        const contextWithUID = gl as WebGLContextWithUID;

        // Create a simple UID for the context if it doesn't have one
        if (!contextWithUID._pixiContextUID) {
            contextWithUID._pixiContextUID = Date.now() + Math.random();
        }
        return contextWithUID._pixiContextUID;
    }

    /**
     * Updates the model. Note this method just updates the timer,
     * and the actual update will be done right before rendering the model.
     * @param dt - The elapsed time in milliseconds since last frame.
     */
    update(dt: DOMHighResTimeStamp): void {
        this.deltaTime += dt;
        this.elapsedTime += dt;

        // don't call `this.internalModel.update()` here, because it requires WebGL context
    }

    // In Pixi.js v8, onRender callback doesn't receive renderer parameter
    // We need to access the renderer differently
    private _onRenderCallback(): void {
        // Try to use cached renderer first, otherwise fall back to global access
        let webglRenderer = this.renderer;

        if (!webglRenderer) {
            // Fallback to global application access
            const app = (globalThis as any).app || (window as any).app;
            if (!app?.renderer) {
                return;
            }

            const renderer = app.renderer as Renderer;
            if (!this.isWebGLRenderer(renderer)) {
                return;
            }

            webglRenderer = renderer;
            this.renderer = webglRenderer; // Cache for next time
        }

        // Early exit if model cannot render
        if (!this.canRender()) {
            return;
        }

        try {
            // In PixiJS v8, the batch/geometry/shader/state reset methods have been removed
            // These were used to reset renderer state, but v8's architecture no longer needs this

            let shouldUpdateTexture = false;

            // when the WebGL context has changed
            // In PixiJS v8, use a simple hash of the GL context as UID
            const contextUID = this._getContextUID(webglRenderer.gl);
            if (this.glContextID !== contextUID) {
                this.glContextID = contextUID;

                if (this.isReady()) {
                    this.internalModel.updateWebGLContext(webglRenderer.gl, this.glContextID);
                }

                shouldUpdateTexture = true;
            }

            for (let i = 0; i < this.textures.length; i++) {
                const texture = this.textures[i]!;

                // In v8, texture.valid doesn't exist, check if texture has a valid source
                if (!texture.source) {
                    continue;
                }

                // In v8, texture handling is different - no more baseTexture
                const textureSourceWithGL = texture.source as any;
                const shouldUpdate = shouldUpdateTexture ||
                    !textureSourceWithGL?._glTextures?.[this.glContextID];

                // bind the WebGLTexture into Live2D core.
                // In v8, get the actual WebGL texture object
                const glTexture = this.extractWebGLTexture(webglRenderer, texture);

                if (this.isWebGLTexture(glTexture) && this.internalModel) {
                    // Set texture flip state right before binding each texture
                    if (shouldUpdate) {
                        webglRenderer.gl.pixelStorei(
                            WebGLRenderingContext.UNPACK_FLIP_Y_WEBGL,
                            this.internalModel.textureFlipY,
                        );
                    }

                    this.internalModel.bindTexture(i, glTexture);
                }

                // manually update the GC counter in v8
                if (webglRenderer.textureGC?.count && texture.source) {
                    (texture.source as any).touched = webglRenderer.textureGC.count;
                }
            }

            // Reset GL state after texture binding to avoid affecting other textures
            if (shouldUpdateTexture && this.internalModel) {
                webglRenderer.gl.pixelStorei(
                    WebGLRenderingContext.UNPACK_FLIP_Y_WEBGL,
                    false,
                );
            }

            // In Pixi.js v8, framebuffer structure has changed
            // Use renderer dimensions directly
            const viewport = {
                x: 0,
                y: 0,
                width: webglRenderer.width || webglRenderer.screen?.width || 800,
                height: webglRenderer.height || webglRenderer.screen?.height || 600
            };

            if (this.internalModel) {
                this.internalModel.viewport = [viewport.x, viewport.y, viewport.width, viewport.height];

                // update only if the time has changed, as the model will possibly be updated once but rendered multiple times
                if (this.deltaTime) {
                    this.internalModel.update(this.deltaTime, this.elapsedTime);
                    this.deltaTime = 0;
                }
            }

            // In v8, ensure worldTransform is properly calculated
            const worldTransform = this.worldTransform || this.groupTransform || this.localTransform;

            // In PixiJS v8, we need to use the renderer's globalUniforms
            let projectionMatrix;
            if (webglRenderer.globalUniforms && 'projectionMatrix' in webglRenderer.globalUniforms) {
                projectionMatrix = (webglRenderer.globalUniforms as any).projectionMatrix;
            } else {
                // Fallback: create a basic projection matrix using renderer screen dimensions
                projectionMatrix = new Matrix();
                const { width, height } = webglRenderer.screen;
                projectionMatrix.set(2 / width, 0, 0, -2 / height, -1, 1);
            }

            const internalTransform = tempMatrix
                .copyFrom(projectionMatrix)
                .append(worldTransform);

            if (this.internalModel) {
                this.internalModel.updateTransform(internalTransform);
                this.internalModel.draw(webglRenderer.gl);
            }

        } catch (error) {
            console.error("Error in Live2D render callback:", error);
        }
    }

    /**
     * Starts lip sync animation.
     */
    startLipSync(): void {
        if (this.isReady()) {
            this.internalModel.setLipSyncEnabled(true);
        }
    }

    /**
     * Stops lip sync animation.
     */
    stopLipSync(): void {
        if (this.isReady()) {
            this.internalModel.setLipSyncEnabled(false);
            this.internalModel.setLipSyncValue(0);
        }
    }

    /**
     * Sets the lip sync value manually.
     * @param value - Lip sync value (0-1), where 0 is closed mouth and 1 is fully open.
     */
    setLipSyncValue(value: number): void {
        if (this.isReady()) {
            this.internalModel.setLipSyncValue(value);
        }
    }

    /**
     * Gets current lip sync enabled state.
     * @return Whether lip sync is enabled.
     */
    isLipSyncEnabled(): boolean {
        return this.isReady() ? this.internalModel.lipSyncEnabled : false;
    }

    /**
     * Gets current lip sync value.
     * @return Current lip sync value (0-1).
     */
    getLipSyncValue(): number {
        return this.isReady() ? this.internalModel.lipSyncValue : 0;
    }

    /**
     * Sets whether eyes should always look at camera regardless of head movement.
     * @param enabled - Whether to lock eyes to camera.
     */
    setEyesAlwaysLookAtCamera(enabled: boolean): void {
        if (this.isReady()) {
            this.internalModel.eyesAlwaysLookAtCamera = enabled;
        }
    }

    /**
     * Gets whether eyes are locked to camera.
     * @return Whether eyes are locked to camera.
     */
    isEyesAlwaysLookAtCamera(): boolean {
        return this.isReady() ? this.internalModel.eyesAlwaysLookAtCamera : false;
    }

    /**
     * Sets whether auto eye blinking is enabled.
     * @param enabled - Whether to enable auto eye blinking.
     */
    setEyeBlinkEnabled(enabled: boolean): void {
        if (this.isReady()) {
            this.internalModel.setEyeBlinkEnabled(enabled);
        }
    }

    /**
     * Gets whether auto eye blinking is enabled.
     * @return Whether auto eye blinking is enabled.
     */
    isEyeBlinkEnabled(): boolean {
        return this.isReady() ? this.internalModel.isEyeBlinkEnabled() : true;
    }

    /**
     * Start speaking with base64 audio data or audio URL.
     * @param audioData - Base64 audio data or audio URL
     * @param options - Speaking options
     */
    async speak(
        audioData: string,
        options: {
            volume?: number;
            expression?: string;
            resetExpression?: boolean;
            onFinish?: () => void;
            onError?: (error: Error) => void;
        } = {}
    ): Promise<void> {
        if (!this.isReady()) {
            throw new Error('Model is not ready');
        }

        if (this.isSpeaking) {
            this.stopSpeaking();
        }

        try {
            this.isSpeaking = true;

            // Initialize audio analyzer if needed
            if (!this.audioAnalyzer) {
                this.audioAnalyzer = new AudioAnalyzer();
            }

            // Start lip sync
            this.startLipSync();

            // Play and analyze audio
            await this.audioAnalyzer.playAndAnalyze(audioData, (volume) => {
                // Apply volume-based lip sync
                const lipSyncValue = Math.min(1, volume * (options.volume || 1));
                this.setLipSyncValue(lipSyncValue);
            });

            // Speaking finished
            this.isSpeaking = false;
            this.setLipSyncValue(0);

            if (options.onFinish) {
                options.onFinish();
            }
        } catch (error) {
            this.isSpeaking = false;
            this.setLipSyncValue(0);

            const errorObj = error instanceof Error ? error : new Error(String(error));
            if (options.onError) {
                options.onError(errorObj);
            } else {
                console.error('Speaking error:', errorObj);
            }
        }
    }

    /**
     * Stop current speaking.
     */
    stopSpeaking(): void {
        if (this.audioAnalyzer) {
            this.audioAnalyzer.destroy();
            this.audioAnalyzer = null;
        }

        this.isSpeaking = false;
        this.setLipSyncValue(0);
    }

    /**
     * Check if currently speaking.
     * @return Whether the model is currently speaking.
     */
    isSpeakingNow(): boolean {
        return this.isSpeaking;
    }

    /**
     * Start microphone input for real-time lip sync.
     * @param onError - Error callback
     */
    async startMicrophoneLipSync(onError?: (error: Error) => void): Promise<void> {
        if (!this.isReady()) {
            throw new Error('Model is not ready');
        }

        try {
            // Initialize audio analyzer if needed
            if (!this.audioAnalyzer) {
                this.audioAnalyzer = new AudioAnalyzer();
            }

            // Start lip sync
            this.startLipSync();

            // Start microphone capture
            await this.audioAnalyzer.startMicrophone((volume) => {
                // Apply volume-based lip sync
                this.setLipSyncValue(volume);
            });
        } catch (error) {
            const errorObj = error instanceof Error ? error : new Error(String(error));
            if (onError) {
                onError(errorObj);
            } else {
                console.error('Microphone error:', errorObj);
            }
        }
    }

    /**
     * Stop microphone input.
     */
    stopMicrophoneLipSync(): void {
        if (this.audioAnalyzer) {
            this.audioAnalyzer.stopMicrophone();
        }
        this.setLipSyncValue(0);
    }

    /**
     * Destroys the model and all related resources. This takes the same options and also
     * behaves the same as `PIXI.Container#destroy`.
     * @param options - Options parameter. A boolean will act as if all options
     *  have been set to that value
     * @param [options.children=false] - if set to true, all the children will have their destroy
     *  method called as well. 'options' will be passed on to those calls.
     * @param [options.texture=false] - Only used for child Sprites if options.children is set to true
     *  Should it destroy the texture of the child sprite
     * @param [options.baseTexture=false] - Only used for child Sprites if options.children is set to true
     *  Should it destroy the base texture of the child sprite
     */
    destroy(options?: { children?: boolean; texture?: boolean; baseTexture?: boolean }): void {
        this.emit("destroy");

        if (options?.texture) {
            this.textures.forEach((texture) => texture.destroy(options.baseTexture));
        }

        this.automator.destroy();

        // Clean up audio resources
        if (this.audioAnalyzer) {
            this.audioAnalyzer.destroy();
            this.audioAnalyzer = null;
        }

        if (this.isReady()) {
            this.internalModel.destroy();
        }

        super.destroy(options);
    }
}
