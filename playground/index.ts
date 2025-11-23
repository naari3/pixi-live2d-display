import { Application, Ticker } from "pixi.js";
import { Live2DModel } from "../src";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;

// Available models configuration
const availableModels = [
    {
        name: "Local Mao (Cubism 5)",
        url: "models/Mao/Mao.model3.json",
        type: "local"
    }
];

let currentModelIndex = 0;
let currentModel: Live2DModel | null = null;
let app: Application;
let isLoadingModel = false;

async function loadModel(modelIndex: number) {
    if (isLoadingModel) {
        console.log('Model loading already in progress, skipping...');
        return;
    }

    const modelConfig = availableModels[modelIndex];
    if (!modelConfig) {
        throw new Error(`Invalid model index: ${modelIndex}`);
    }
    console.log(`Loading model: ${modelConfig.name}`);

    isLoadingModel = true;

    try {
        // Remove existing model safely
        if (currentModel) {
            try {
                // Remove from stage first
                if (app.stage.children.includes(currentModel)) {
                    app.stage.removeChild(currentModel);
                }

                // Only destroy if model is fully initialized
                if (currentModel.internalModel && typeof currentModel.destroy === 'function') {
                    currentModel.destroy();
                }
            } catch (destroyError) {
                console.warn('Error destroying previous model:', destroyError);
            }
            currentModel = null;
        }

        // Load new model
        const model = await Live2DModel.from(modelConfig.url, {
            ticker: Ticker.shared,
        });
        model.setRenderer(app.renderer);

        // Scale and position model
        const scale = Math.min(window.innerWidth / model.width,
            window.innerHeight / model.height) * 0.8;
        model.scale.set(scale);

        // Center the model by setting anchor to center
        model.anchor.set(0.5, 0.5);
        model.x = window.innerWidth / 2;
        model.y = window.innerHeight / 2;

        // Add to stage
        app.stage.addChild(model);

        // Update controls for new model if they exist
        updateControlsForModel(model);

        currentModel = model;
        currentModelIndex = modelIndex;

        console.log(`Model loaded successfully: ${modelConfig.name}`);
        return model;

    } catch (error) {
        console.error(`Failed to load model ${modelConfig.name}:`, error);
        throw error;
    } finally {
        isLoadingModel = false;
    }
}

async function main() {
    // Create and initialize PixiJS application
    app = new Application();
    await app.init({
        resizeTo: window,
        canvas: canvas,
        antialias: true, // Enable antialiasing
        resolution: window.devicePixelRatio || 1, // Use device pixel ratio for crisp rendering
        autoDensity: true, // Automatically adjust canvas density
        backgroundAlpha: 0, // Transparent background
        powerPreference: 'high-performance', // Use high-performance GPU if available
        premultipliedAlpha: false, // Better for Live2D rendering
    });

    // Setup model selector
    setupModelSelector();

    // Setup render quality controls
    setupRenderQualityControls();

    try {
        // Wait a bit for the app to fully initialize
        await new Promise(resolve => setTimeout(resolve, 100));

        // Load initial model
        await loadModel(currentModelIndex);

    } catch (error) {
        console.error("Failed to load initial model:", error);

        // Try to load the first model as fallback
        if (currentModelIndex !== 0) {
            console.log("Attempting to load fallback model...");
            try {
                await loadModel(0);
            } catch (fallbackError) {
                console.error("Failed to load fallback model:", fallbackError);
            }
        }
    }
}

function setupLipSyncControls(model: Live2DModel) {
    const modelWithLipSync = model as any;
    // Create control panel
    const controlPanel = document.createElement('div');
    controlPanel.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 20px;
        border-radius: 10px;
        font-family: Arial, sans-serif;
        z-index: 1000;
    `;

    // Start/Stop button
    const toggleButton = document.createElement('button');
    toggleButton.textContent = 'Start Lip Sync';
    toggleButton.style.cssText = `
        display: block;
        margin: 10px 0;
        padding: 10px 20px;
        font-size: 16px;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        background: #007bff;
        color: white;
    `;
    toggleButton.onclick = () => {
        if (modelWithLipSync.isLipSyncEnabled()) {
            modelWithLipSync.stopLipSync();
            toggleButton.textContent = 'Start Lip Sync';
            toggleButton.style.background = '#007bff';
        } else {
            modelWithLipSync.startLipSync();
            toggleButton.textContent = 'Stop Lip Sync';
            toggleButton.style.background = '#dc3545';
        }
    };

    // Lip sync value slider
    const sliderContainer = document.createElement('div');
    sliderContainer.innerHTML = `
        <label>Lip Sync Value: <span id="lipSyncValue">0</span></label>
    `;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.01';
    slider.value = '0';
    slider.style.cssText = `
        width: 200px;
        display: block;
        margin: 10px 0;
    `;

    const valueDisplay = sliderContainer.querySelector('#lipSyncValue') as HTMLSpanElement;

    slider.oninput = () => {
        const value = parseFloat(slider.value);
        modelWithLipSync.setLipSyncValue(value);
        valueDisplay.textContent = value.toFixed(2);
    };

    // Microphone button
    const micButton = document.createElement('button');
    micButton.textContent = 'Start Microphone';
    micButton.style.cssText = `
        display: block;
        margin: 10px 0;
        padding: 10px 20px;
        font-size: 16px;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        background: #6f42c1;
        color: white;
    `;

    let micActive = false;
    micButton.onclick = async () => {
        if (micActive) {
            modelWithLipSync.stopMicrophoneLipSync();
            micButton.textContent = 'Start Microphone';
            micButton.style.background = '#6f42c1';
            micActive = false;
        } else {
            try {
                await modelWithLipSync.startMicrophoneLipSync((error: Error) => {
                    console.error('Microphone error:', error);
                    alert('Microphone error: ' + error.message);
                    micButton.textContent = 'Start Microphone';
                    micButton.style.background = '#6f42c1';
                    micActive = false;
                });
                micButton.textContent = 'Stop Microphone';
                micButton.style.background = '#dc3545';
                micActive = true;
            } catch (error) {
                console.error('Failed to start microphone:', error);
                alert('Failed to start microphone. Please allow microphone access.');
            }
        }
    };

    // Auto animation button
    let autoAnimation: number | null = null;
    const autoButton = document.createElement('button');
    autoButton.textContent = 'Start Auto Animation';
    autoButton.style.cssText = `
        display: block;
        margin: 10px 0;
        padding: 10px 20px;
        font-size: 16px;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        background: #28a745;
        color: white;
    `;

    autoButton.onclick = () => {
        if (autoAnimation) {
            clearInterval(autoAnimation);
            autoAnimation = null;
            autoButton.textContent = 'Start Auto Animation';
            autoButton.style.background = '#28a745';
        } else {
            modelWithLipSync.startLipSync();
            toggleButton.textContent = 'Stop Lip Sync';
            toggleButton.style.background = '#dc3545';

            // More realistic talking animation
            let talkingState = 'speaking'; // 'speaking', 'pause', 'breath'
            let stateTimer = 0;
            let speechDuration = Math.random() * 2 + 1; // 1-3 seconds
            let pauseDuration = Math.random() * 0.8 + 0.2; // 0.2-1 second
            let breathDuration = 0.3; // 0.3 seconds
            let syllableTimer = 0;
            let targetValue = 0;
            let currentValue = 0;

            autoAnimation = setInterval(() => {
                const deltaTime = 0.05; // 50ms
                stateTimer += deltaTime;

                if (talkingState === 'speaking') {
                    // High-frequency mouth movement for realistic speech
                    syllableTimer += deltaTime;
                    const intensity = 0.7 + Math.random() * 0.3; // Variable intensity

                    // Generate rapid mouth movements every 0.05-0.12s (much faster)
                    if (syllableTimer > (0.05 + Math.random() * 0.07)) {
                        targetValue = Math.random() < 0.85 ? intensity * (0.3 + Math.random() * 0.7) : 0.05; // More frequent opening
                        syllableTimer = 0;
                    }

                    // Faster transition for quick speech movements
                    currentValue += (targetValue - currentValue) * 0.6;

                    if (stateTimer > speechDuration) {
                        talkingState = Math.random() < 0.7 ? 'pause' : 'breath';
                        stateTimer = 0;
                        speechDuration = Math.random() * 2.5 + 1; // 1-3.5 seconds
                        pauseDuration = Math.random() * 0.8 + 0.2; // 0.2-1 second
                        targetValue = 0;
                    }
                } else if (talkingState === 'pause') {
                    // Mouth gradually closes during pause
                    currentValue *= 0.95;

                    if (stateTimer > pauseDuration) {
                        talkingState = 'speaking';
                        stateTimer = 0;
                        syllableTimer = 0;
                    }
                } else if (talkingState === 'breath') {
                    // Slight mouth opening for breathing
                    const breathPattern = Math.sin(stateTimer * 6) * 0.1 + 0.15;
                    currentValue += (breathPattern - currentValue) * 0.1;

                    if (stateTimer > breathDuration) {
                        talkingState = 'speaking';
                        stateTimer = 0;
                        syllableTimer = 0;
                    }
                }

                const finalValue = Math.max(0, Math.min(1, currentValue));
                modelWithLipSync.setLipSyncValue(finalValue);
                slider.value = finalValue.toString();
                valueDisplay.textContent = finalValue.toFixed(2);
            }, 50) as any;

            autoButton.textContent = 'Stop Auto Animation';
            autoButton.style.background = '#dc3545';
        }
    };

    // Base64 audio test button
    const speakButton = document.createElement('button');
    speakButton.textContent = 'Test Speak (Base64)';
    speakButton.style.cssText = `
        display: block;
        margin: 10px 0;
        padding: 10px 20px;
        font-size: 16px;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        background: #fd7e14;
        color: white;
    `;

    speakButton.onclick = async () => {
        // Create a simple test audio (1 second beep tone)
        const audioContext = new AudioContext();
        const sampleRate = audioContext.sampleRate;
        const duration = 2; // 2 seconds
        const numChannels = 1;
        const numSamples = sampleRate * duration;

        const audioBuffer = audioContext.createBuffer(numChannels, numSamples, sampleRate);
        const channelData = audioBuffer.getChannelData(0);

        // Generate a simple test pattern (talking-like rhythm)
        for (let i = 0; i < numSamples; i++) {
            const t = i / sampleRate;
            const talkingPattern = Math.sin(t * 8 * Math.PI) * Math.sin(t * 2 * Math.PI) * 0.3;
            channelData[i] = talkingPattern * Math.exp(-t); // Fade out
        }

        // Convert to base64 (simplified - in real use, you'd have proper audio encoding)
        try {
            await modelWithLipSync.speak('data:audio/wav;base64,fake', {
                volume: 1.0,
                onFinish: () => {
                    console.log('Speaking finished');
                },
                onError: (_error: Error) => {
                    console.log('Note: This is a demo button. In real use, provide valid base64 audio data.');
                    // Start a simple demo animation instead
                    modelWithLipSync.startLipSync();
                    let time = 0;
                    const demoAnimation = setInterval(() => {
                        time += 0.1;
                        const value = Math.max(0, Math.sin(time * 8) * 0.5 + 0.3 + Math.random() * 0.2);
                        modelWithLipSync.setLipSyncValue(value);

                        if (time > 3) { // 3 second demo
                            clearInterval(demoAnimation);
                            modelWithLipSync.setLipSyncValue(0);
                        }
                    }, 50);
                }
            });
        } catch (error) {
            console.log('Demo speak function - showing animation pattern');
        }
    };

    // Instructions
    const instructions = document.createElement('div');
    instructions.innerHTML = `
        <h3 style="margin: 0 0 10px 0; color: #fff;">Lip Sync Controls</h3>
        <p style="margin: 0 0 10px 0; font-size: 12px;">Use the controls below to test lip sync animation:</p>
        <ul style="margin: 0; padding-left: 20px; font-size: 12px;">
            <li>Toggle: Enable/disable lip sync</li>
            <li>Slider: Manual control (0 = closed, 1 = open)</li>
            <li>Microphone: Real-time voice input</li>
            <li>Speak: Test base64 audio method</li>
            <li>Auto: Automatic talking animation</li>
        </ul>
    `;

    // Assemble control panel
    controlPanel.appendChild(instructions);
    controlPanel.appendChild(toggleButton);
    controlPanel.appendChild(sliderContainer);
    controlPanel.appendChild(slider);
    controlPanel.appendChild(micButton);
    controlPanel.appendChild(speakButton);
    controlPanel.appendChild(autoButton);

    document.body.appendChild(controlPanel);
    lipSyncControlsPanel = controlPanel;
}

function setupFocusControls(model: Live2DModel) {
    // Create focus control panel
    const focusPanel = document.createElement('div');
    focusPanel.style.cssText = `
        position: fixed;
        top: 20px;
        left: 20px;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 20px;
        border-radius: 10px;
        font-family: Arial, sans-serif;
        z-index: 1000;
    `;

    // Title
    const title = document.createElement('h3');
    title.textContent = 'Focus Controls';
    title.style.cssText = 'margin: 0 0 15px 0; color: #fff;';

    // Force look at camera button
    const lookAtCameraButton = document.createElement('button');
    lookAtCameraButton.textContent = 'Look at Camera';
    lookAtCameraButton.style.cssText = `
        display: block;
        margin: 10px 0;
        padding: 10px 20px;
        font-size: 16px;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        background: #17a2b8;
        color: white;
    `;

    // Eyes only lock button  
    const eyesOnlyButton = document.createElement('button');
    eyesOnlyButton.textContent = 'Eyes Only Look at Camera';
    eyesOnlyButton.style.cssText = `
        display: block;
        margin: 10px 0;
        padding: 10px 20px;
        font-size: 16px;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        background: #28a745;
        color: white;
    `;

    let forceLookAtCamera = false;
    let focusInterval: number | null = null;

    lookAtCameraButton.onclick = () => {
        if (forceLookAtCamera) {
            // Stop forcing look at camera
            forceLookAtCamera = false;
            if (focusInterval) {
                clearInterval(focusInterval);
                focusInterval = null;
            }
            lookAtCameraButton.textContent = 'Look at Camera';
            lookAtCameraButton.style.background = '#17a2b8';
        } else {
            // Start forcing look at camera
            forceLookAtCamera = true;

            // Immediately set focus to center
            if (model.internalModel && model.internalModel.focusController) {
                model.internalModel.focusController.focus(0, 0, true);
            }

            // Keep focusing at center every frame
            focusInterval = setInterval(() => {
                if (model.internalModel && model.internalModel.focusController) {
                    model.internalModel.focusController.focus(0, 0, false);
                }
            }, 16) as any; // ~60fps

            lookAtCameraButton.textContent = 'Stop Looking';
            lookAtCameraButton.style.background = '#dc3545';
        }
    };

    // Eyes only lock functionality
    eyesOnlyButton.onclick = () => {
        const modelWithEyesLock = model as any;
        if (modelWithEyesLock.isEyesAlwaysLookAtCamera && modelWithEyesLock.isEyesAlwaysLookAtCamera()) {
            // Disable eyes lock
            modelWithEyesLock.setEyesAlwaysLookAtCamera(false);
            eyesOnlyButton.textContent = 'Eyes Only Look at Camera';
            eyesOnlyButton.style.background = '#28a745';
        } else {
            // Enable eyes lock and set focus to camera
            modelWithEyesLock.setEyesAlwaysLookAtCamera(true);
            if (model.internalModel && model.internalModel.focusController) {
                model.internalModel.focusController.focus(0, 0, true);
            }
            eyesOnlyButton.textContent = 'Unlock Eyes';
            eyesOnlyButton.style.background = '#dc3545';
        }
    };

    // Auto Eye Blink button
    const eyeBlinkButton = document.createElement('button');
    eyeBlinkButton.textContent = 'Disable Auto Blink';
    eyeBlinkButton.style.cssText = `
        display: block;
        margin: 10px 0;
        padding: 10px 20px;
        font-size: 16px;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        background: #dc3545;
        color: white;
    `;

    eyeBlinkButton.onclick = () => {
        const modelWithBlink = model as any;
        if (modelWithBlink.isEyeBlinkEnabled && modelWithBlink.isEyeBlinkEnabled()) {
            // Disable auto blink
            modelWithBlink.setEyeBlinkEnabled(false);
            eyeBlinkButton.textContent = 'Enable Auto Blink';
            eyeBlinkButton.style.background = '#28a745';
        } else {
            // Enable auto blink
            modelWithBlink.setEyeBlinkEnabled(true);
            eyeBlinkButton.textContent = 'Disable Auto Blink';
            eyeBlinkButton.style.background = '#dc3545';
        }
    };

    // Manual focus controls
    const manualControls = document.createElement('div');
    manualControls.innerHTML = `
        <p style="margin: 15px 0 5px 0; font-size: 14px;">Manual Focus:</p>
    `;

    // X axis slider
    const xContainer = document.createElement('div');
    xContainer.innerHTML = `
        <label style="font-size: 12px;">X: <span id="focusX">0</span></label>
    `;

    const xSlider = document.createElement('input');
    xSlider.type = 'range';
    xSlider.min = '-1';
    xSlider.max = '1';
    xSlider.step = '0.1';
    xSlider.value = '0';
    xSlider.style.cssText = `
        width: 180px;
        display: block;
        margin: 5px 0;
    `;

    // Y axis slider
    const yContainer = document.createElement('div');
    yContainer.innerHTML = `
        <label style="font-size: 12px;">Y: <span id="focusY">0</span></label>
    `;

    const ySlider = document.createElement('input');
    ySlider.type = 'range';
    ySlider.min = '-1';
    ySlider.max = '1';
    ySlider.step = '0.1';
    ySlider.value = '0';
    ySlider.style.cssText = `
        width: 180px;
        display: block;
        margin: 5px 0;
    `;

    const xDisplay = xContainer.querySelector('#focusX') as HTMLSpanElement;
    const yDisplay = yContainer.querySelector('#focusY') as HTMLSpanElement;

    xSlider.oninput = () => {
        if (!forceLookAtCamera) {
            const x = parseFloat(xSlider.value);
            const y = parseFloat(ySlider.value);
            if (model.internalModel && model.internalModel.focusController) {
                model.internalModel.focusController.focus(x, y);
            }
            xDisplay.textContent = x.toFixed(1);
        }
    };

    ySlider.oninput = () => {
        if (!forceLookAtCamera) {
            const x = parseFloat(xSlider.value);
            const y = parseFloat(ySlider.value);
            if (model.internalModel && model.internalModel.focusController) {
                model.internalModel.focusController.focus(x, y);
            }
            yDisplay.textContent = y.toFixed(1);
        }
    };

    // Reset button
    const resetButton = document.createElement('button');
    resetButton.textContent = 'Reset to Center';
    resetButton.style.cssText = `
        display: block;
        margin: 10px 0;
        padding: 8px 15px;
        font-size: 14px;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        background: #6c757d;
        color: white;
    `;

    resetButton.onclick = () => {
        xSlider.value = '0';
        ySlider.value = '0';
        xDisplay.textContent = '0';
        yDisplay.textContent = '0';
        if (model.internalModel && model.internalModel.focusController) {
            model.internalModel.focusController.focus(0, 0);
        }
    };

    // Assemble focus panel
    focusPanel.appendChild(title);
    focusPanel.appendChild(lookAtCameraButton);
    focusPanel.appendChild(eyesOnlyButton);
    focusPanel.appendChild(eyeBlinkButton);
    focusPanel.appendChild(manualControls);
    focusPanel.appendChild(xContainer);
    focusPanel.appendChild(xSlider);
    focusPanel.appendChild(yContainer);
    focusPanel.appendChild(ySlider);
    focusPanel.appendChild(resetButton);

    document.body.appendChild(focusPanel);
    focusControlsPanel = focusPanel;
}

function setupModelSelector() {
    // Create model selector panel
    const selectorPanel = document.createElement('div');
    selectorPanel.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 20px;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 20px;
        border-radius: 10px;
        font-family: Arial, sans-serif;
        z-index: 1000;
        min-width: 250px;
    `;

    // Title
    const title = document.createElement('h3');
    title.textContent = 'Model Selector';
    title.style.cssText = 'margin: 0 0 15px 0; color: #fff;';

    // Model dropdown
    const modelSelect = document.createElement('select');
    modelSelect.style.cssText = `
        width: 100%;
        padding: 8px;
        margin: 10px 0;
        border: none;
        border-radius: 5px;
        background: #333;
        color: white;
        font-size: 14px;
    `;

    availableModels.forEach((model, index) => {
        const option = document.createElement('option');
        option.value = index.toString();
        option.textContent = model.name;
        if (index === currentModelIndex) {
            option.selected = true;
        }
        modelSelect.appendChild(option);
    });

    // Loading indicator
    const loadingIndicator = document.createElement('div');
    loadingIndicator.style.cssText = `
        display: none;
        color: #17a2b8;
        font-size: 12px;
        margin: 10px 0;
    `;
    loadingIndicator.textContent = 'Loading model...';

    // Load button
    const loadButton = document.createElement('button');
    loadButton.textContent = 'Load Model';
    loadButton.style.cssText = `
        width: 100%;
        padding: 10px;
        margin: 10px 0;
        border: none;
        border-radius: 5px;
        background: #007bff;
        color: white;
        font-size: 14px;
        cursor: pointer;
    `;

    loadButton.onclick = async () => {
        const selectedIndex = parseInt(modelSelect.value);
        if (selectedIndex === currentModelIndex || isLoadingModel) {
            console.log('Model already loaded or loading in progress');
            return;
        }

        loadButton.disabled = true;
        modelSelect.disabled = true;
        loadButton.textContent = 'Loading...';
        loadingIndicator.style.display = 'block';
        loadingIndicator.textContent = 'Loading model...';
        loadingIndicator.style.color = '#17a2b8';

        try {
            await loadModel(selectedIndex);
            loadButton.textContent = 'Load Model';
            loadingIndicator.style.display = 'none';
        } catch (error) {
            loadButton.textContent = 'Load Failed - Retry';
            loadingIndicator.textContent = `Failed: ${error instanceof Error ? error.message : String(error)}`;
            loadingIndicator.style.color = '#dc3545';
            console.error('Model load error:', error);

            // Reset loading indicator after 3 seconds
            setTimeout(() => {
                loadingIndicator.textContent = 'Loading model...';
                loadingIndicator.style.color = '#17a2b8';
                loadingIndicator.style.display = 'none';
                loadButton.textContent = 'Load Model';
            }, 3000);
        } finally {
            loadButton.disabled = false;
            modelSelect.disabled = false;
        }
    };

    // Current model info
    const modelInfo = document.createElement('div');
    modelInfo.style.cssText = `
        font-size: 12px;
        color: #aaa;
        margin: 10px 0 0 0;
        padding: 10px;
        background: rgba(255,255,255,0.1);
        border-radius: 5px;
    `;
    updateModelInfo(modelInfo);

    // Assemble selector panel
    selectorPanel.appendChild(title);
    selectorPanel.appendChild(modelSelect);
    selectorPanel.appendChild(loadButton);
    selectorPanel.appendChild(loadingIndicator);
    selectorPanel.appendChild(modelInfo);

    document.body.appendChild(selectorPanel);

    // Store reference for updates
    (window as any).modelSelectorPanel = {
        select: modelSelect,
        info: modelInfo
    };
}

function updateModelInfo(infoElement: HTMLElement) {
    const currentConfig = availableModels[currentModelIndex];
    if (!currentConfig) {
        infoElement.innerHTML = '<strong>No model selected</strong>';
        return;
    }
    infoElement.innerHTML = `
        <strong>Current Model:</strong><br>
        ${currentConfig.name}<br>
        <small>Type: ${currentConfig.type}</small>
    `;
}

let lipSyncControlsPanel: HTMLElement | null = null;
let focusControlsPanel: HTMLElement | null = null;

function updateControlsForModel(model: Live2DModel) {
    // Remove existing control panels
    if (lipSyncControlsPanel) {
        document.body.removeChild(lipSyncControlsPanel);
        lipSyncControlsPanel = null;
    }
    if (focusControlsPanel) {
        document.body.removeChild(focusControlsPanel);
        focusControlsPanel = null;
    }

    // Create new control panels for the model
    setupLipSyncControls(model);
    setupFocusControls(model);

    // Update model selector info
    const selectorPanel = (window as any).modelSelectorPanel;
    if (selectorPanel) {
        selectorPanel.select.value = currentModelIndex.toString();
        updateModelInfo(selectorPanel.info);
    }
}

function setupRenderQualityControls() {
    // Create render quality control panel
    const qualityPanel = document.createElement('div');
    qualityPanel.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 20px;
        border-radius: 10px;
        font-family: Arial, sans-serif;
        z-index: 1000;
        min-width: 200px;
    `;

    // Title
    const title = document.createElement('h3');
    title.textContent = 'Render Quality';
    title.style.cssText = 'margin: 0 0 15px 0; color: #fff; font-size: 14px;';

    // Resolution scale control
    const resolutionContainer = document.createElement('div');
    resolutionContainer.innerHTML = `
        <label style="font-size: 12px;">Resolution Scale: <span id="resolutionValue">1.0</span>x</label>
    `;

    const resolutionSlider = document.createElement('input');
    resolutionSlider.type = 'range';
    resolutionSlider.min = '0.5';
    resolutionSlider.max = '2.0';
    resolutionSlider.step = '0.1';
    resolutionSlider.value = (window.devicePixelRatio || 1).toString();
    resolutionSlider.style.cssText = `
        width: 100%;
        margin: 5px 0 15px 0;
    `;

    const resolutionDisplay = resolutionContainer.querySelector('#resolutionValue') as HTMLSpanElement;
    resolutionDisplay.textContent = parseFloat(resolutionSlider.value).toFixed(1);

    resolutionSlider.oninput = () => {
        const value = parseFloat(resolutionSlider.value);
        resolutionDisplay.textContent = value.toFixed(1);

        // Update renderer resolution
        if (app && app.renderer) {
            app.renderer.resolution = value;
            app.renderer.resize(app.screen.width, app.screen.height);
        }
    };

    // MSAA samples control
    const msaaContainer = document.createElement('div');
    msaaContainer.innerHTML = `
        <label style="font-size: 12px;">MSAA Samples: <span id="msaaValue">4</span>x</label>
    `;

    const msaaSelect = document.createElement('select');
    msaaSelect.style.cssText = `
        width: 100%;
        padding: 5px;
        margin: 5px 0 15px 0;
        border: none;
        border-radius: 3px;
        background: #333;
        color: white;
        font-size: 12px;
    `;

    const msaaOptions = [
        { value: '1', label: '1x (Off)' },
        { value: '2', label: '2x' },
        { value: '4', label: '4x' },
        { value: '8', label: '8x' },
        { value: '16', label: '16x (High-end only)' }
    ];

    msaaOptions.forEach(option => {
        const optionElement = document.createElement('option');
        optionElement.value = option.value;
        optionElement.textContent = option.label;
        if (option.value === '4') optionElement.selected = true;
        msaaSelect.appendChild(optionElement);
    });

    const msaaDisplay = msaaContainer.querySelector('#msaaValue') as HTMLSpanElement;

    msaaSelect.onchange = () => {
        const value = msaaSelect.value;
        msaaDisplay.textContent = value;
        console.log(`MSAA changed to ${value}x (requires page refresh to take effect)`);
    };

    // Performance info
    const performanceInfo = document.createElement('div');
    performanceInfo.style.cssText = `
        font-size: 10px;
        color: #aaa;
        margin-top: 10px;
        padding: 8px;
        background: rgba(255,255,255,0.05);
        border-radius: 3px;
    `;

    // FPS counter
    let fps = 0;
    let fpsCounter = 0;
    let lastTime = performance.now();

    function updateFPS() {
        const currentTime = performance.now();
        const deltaTime = currentTime - lastTime;
        fpsCounter++;

        if (deltaTime >= 1000) {
            fps = Math.round((fpsCounter * 1000) / deltaTime);
            fpsCounter = 0;
            lastTime = currentTime;

            performanceInfo.innerHTML = `
                <strong>Performance:</strong><br>
                FPS: ${fps}<br>
                Resolution: ${app?.renderer?.resolution?.toFixed(1) || 'N/A'}x<br>
                Canvas Size: ${app?.screen?.width || 'N/A'}×${app?.screen?.height || 'N/A'}
            `;
        }

        requestAnimationFrame(updateFPS);
    }

    updateFPS();

    // Quality presets
    const presetsContainer = document.createElement('div');
    presetsContainer.innerHTML = `
        <label style="font-size: 12px; margin-bottom: 5px; display: block;">Quality Presets:</label>
    `;

    const presetButtons = [
        { name: 'Low', resolution: 0.5 },
        { name: 'Medium', resolution: 1.0 },
        { name: 'High', resolution: 1.5 },
        { name: 'Ultra', resolution: 2.0 }
    ];

    presetButtons.forEach(preset => {
        const button = document.createElement('button');
        button.textContent = preset.name;
        button.style.cssText = `
            padding: 4px 8px;
            margin: 2px;
            border: none;
            border-radius: 3px;
            background: #555;
            color: white;
            font-size: 10px;
            cursor: pointer;
        `;

        button.onclick = () => {
            resolutionSlider.value = preset.resolution.toString();
            resolutionDisplay.textContent = preset.resolution.toFixed(1);

            if (app && app.renderer) {
                app.renderer.resolution = preset.resolution;
                app.renderer.resize(app.screen.width, app.screen.height);
            }
        };

        presetsContainer.appendChild(button);
    });

    // Assemble quality panel
    qualityPanel.appendChild(title);
    qualityPanel.appendChild(resolutionContainer);
    qualityPanel.appendChild(resolutionSlider);
    qualityPanel.appendChild(msaaContainer);
    qualityPanel.appendChild(msaaSelect);
    qualityPanel.appendChild(presetsContainer);
    qualityPanel.appendChild(performanceInfo);

    document.body.appendChild(qualityPanel);
}

main();
