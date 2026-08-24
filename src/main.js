import './style.css';
import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';

const app = document.querySelector('#app');

const scene = new THREE.Scene();
// scene.background stays null so the device camera passthrough shows through.

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.01,
  50,
);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
app.appendChild(renderer.domElement);

// --- Speech-to-text model ---------------------------------------------------
// Whisper (via Transformers.js) runs in a Web Worker so inference never
// blocks the render loop. The model must finish downloading before the
// microphone button below is enabled.

const WHISPER_SAMPLE_RATE = 16000;

const asrWorker = new Worker(new URL('./workers/asr-worker.js', import.meta.url), {
  type: 'module',
});

let asrReady = false;

const setupPrompt = document.createElement('div');
setupPrompt.id = 'setup-prompt';

const modelDownload = document.createElement('div');
modelDownload.id = 'model-download';
setupPrompt.appendChild(modelDownload);

const downloadButton = document.createElement('button');
downloadButton.id = 'download-button';
downloadButton.type = 'button';
downloadButton.className = 'setup-button';
downloadButton.textContent = 'Prepare Model';
modelDownload.appendChild(downloadButton);

const downloadProgress = document.createElement('progress');
downloadProgress.id = 'download-progress';
downloadProgress.max = 100;
downloadProgress.value = 0;
modelDownload.appendChild(downloadProgress);

downloadButton.addEventListener('click', () => {
  downloadButton.disabled = true;
  downloadButton.textContent = 'Preparing Model...';
  asrWorker.postMessage({ type: 'load' });
});

asrWorker.onmessage = (event) => {
  const { type } = event.data;

  if (type === 'progress') {
    downloadProgress.value = event.data.percent;
    downloadButton.textContent = `Preparing Model... ${event.data.percent}%`;
  }
  else if (type === 'ready') {
    asrReady = true;
    downloadProgress.value = 100;
    downloadButton.textContent = 'Model Ready';
    micButton.disabled = false;
  }
  else if (type === 'result') {
    setHudText(event.data.text || '(no speech detected)');
  }
  else if (type === 'error') {
    console.error('Speech-to-text error:', event.data.message);

    if (!asrReady) {
      downloadButton.disabled = false;
      downloadButton.textContent = 'Download Model';
      showOverlay(`Failed to download the speech-to-text model: ${event.data.message}`);
    }
    else {
      setHudText("Sorry, I didn't catch that.");
    }
  }
};

// --- Microphone input ------------------------------------------------------
// Requested from a plain button (getUserMedia needs a user gesture) before
// the user enters VR. Disabled until the speech-to-text model has finished
// downloading. Once granted, `micStream` stays live for recording later.

let micStream = null;

const micExplanation = document.createElement('p');
micExplanation.id = 'mic-explanation';
micExplanation.textContent = 'This XR experience requires microphone access to work properly.';
setupPrompt.appendChild(micExplanation);

const micTroubleshooting = document.createElement('p');
micTroubleshooting.id = 'mic-troubleshooting';
micTroubleshooting.textContent =
  'Make sure your browser is up to date and microphone permission is turned on for it. ' +
  'If the button below does not respond, fully close and reopen your browser app and try again.';
setupPrompt.appendChild(micTroubleshooting);

const micButton = document.createElement('button');
micButton.id = 'mic-button';
micButton.type = 'button';
micButton.className = 'setup-button';
micButton.textContent = 'Enable Microphone';
micButton.disabled = true;
setupPrompt.appendChild(micButton);

app.appendChild(setupPrompt);

micButton.addEventListener('click', async () => {
  micButton.disabled = true;
  micButton.textContent = 'Requesting microphone...';

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    setupPrompt.remove();
    // Entering VR is only offered once microphone access is granted.
    enableArEntry();
  }
  catch (err) {
    micButton.disabled = false;
    micButton.textContent = 'Enable Microphone';
    showOverlay(`Microphone access was denied or unavailable: ${err.message}`);
  }
});

// --- Floating text HUD ---------------------------------------------------
// A canvas-texture plane that trails the camera at a fixed offset (bottom
// center of view) and crossfades its content via setHudText().

const HUD_CANVAS_WIDTH = 1024;
const HUD_CANVAS_HEIGHT = 384;
const HUD_WORLD_WIDTH = 0.7;
const HUD_WORLD_HEIGHT = HUD_WORLD_WIDTH * (HUD_CANVAS_HEIGHT / HUD_CANVAS_WIDTH);
const HUD_OFFSET = new THREE.Vector3(0, -0.28, -0.8);
const HUD_FOLLOW_LAMBDA = 6;
const HUD_FADE_MS = 1500;
const HUD_PADDING = 40;
const HUD_MAX_FONT_SIZE = 40;
const HUD_MIN_FONT_SIZE = 16;
const HUD_LINE_HEIGHT_RATIO = 1.25;

const hudCanvas = document.createElement('canvas');
hudCanvas.width = HUD_CANVAS_WIDTH;
hudCanvas.height = HUD_CANVAS_HEIGHT;
const hudCtx = hudCanvas.getContext('2d');

const hudTexture = new THREE.CanvasTexture(hudCanvas);
hudTexture.colorSpace = THREE.SRGBColorSpace;

const hudMaterial = new THREE.MeshBasicMaterial({
  map: hudTexture,
  transparent: true,
  opacity: 0,
  depthTest: false,
  depthWrite: false,
});

const hudMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(HUD_WORLD_WIDTH, HUD_WORLD_HEIGHT),
  hudMaterial,
);
hudMesh.renderOrder = 999;
hudMesh.position.copy(camera.position).add(HUD_OFFSET);
scene.add(hudMesh);

const hudFade = {
  from: 0,
  to: 0,
  start: 0,
  pendingText: null,
};

// Splits a single paragraph into lines that each fit within maxWidth at the
// context's current font, breaking on word boundaries.
function wrapParagraph(ctx, paragraph, maxWidth) {
  if (paragraph.length === 0) {
    return [''];
  }

  const words = paragraph.split(' ');
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;

    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = word;
    }
    else {
      current = candidate;
    }
  }

  lines.push(current);

  return lines;
}

function layoutHudText(text, fontSize) {
  hudCtx.font = `600 ${fontSize}px system-ui, sans-serif`;
  const maxWidth = hudCanvas.width - HUD_PADDING * 2;
  return text.split('\n').flatMap((paragraph) => wrapParagraph(hudCtx, paragraph, maxWidth));
}

function drawHudText(text) {
  const w = hudCanvas.width;
  const h = hudCanvas.height;
  const maxHeight = h - HUD_PADDING * 2;

  // Word-wrap at the largest font size that still fits vertically, shrinking
  // down to a minimum size rather than letting long sentences overflow.
  let fontSize = HUD_MAX_FONT_SIZE;
  let lines = layoutHudText(text, fontSize);
  let lineHeight = fontSize * HUD_LINE_HEIGHT_RATIO;

  while (lines.length * lineHeight > maxHeight && fontSize > HUD_MIN_FONT_SIZE) {
    fontSize -= 2;
    lines = layoutHudText(text, fontSize);
    lineHeight = fontSize * HUD_LINE_HEIGHT_RATIO;
  }

  hudCtx.clearRect(0, 0, w, h);

  const blockHeight = lineHeight * lines.length;
  const startY = h / 2 - blockHeight / 2 + lineHeight / 2;

  hudCtx.font = `600 ${fontSize}px system-ui, sans-serif`;
  hudCtx.textAlign = 'center';
  hudCtx.textBaseline = 'middle';
  hudCtx.lineJoin = 'round';
  hudCtx.lineWidth = fontSize * 0.18;
  hudCtx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
  hudCtx.fillStyle = '#ffffff';

  lines.forEach((line, i) => {
    const y = startY + i * lineHeight;
    hudCtx.strokeText(line, w / 2, y);
    hudCtx.fillText(line, w / 2, y);
  });

  hudTexture.needsUpdate = true;
}

// Fades the HUD out, swaps in `text` (multi-line via \n), then fades back in.
function setHudText(text) {
  const now = performance.now();

  if (hudMaterial.opacity <= 0.01) {
    // Already invisible: skip the fade-out leg and go straight to fade-in.
    drawHudText(text);
    hudFade.pendingText = null;
    hudFade.from = hudMaterial.opacity;
    hudFade.to = 1;
    hudFade.start = now;
  }
  else {
    hudFade.pendingText = text;
    hudFade.from = hudMaterial.opacity;
    hudFade.to = 0;
    hudFade.start = now;
  }
}

function updateHud(delta) {
  const now = performance.now();
  const progress = Math.min((now - hudFade.start) / HUD_FADE_MS, 1);
  const eased = progress * progress * (3 - 2 * progress);
  hudMaterial.opacity = THREE.MathUtils.lerp(hudFade.from, hudFade.to, eased);

  if (progress >= 1 && hudFade.to === 0 && hudFade.pendingText !== null) {
    drawHudText(hudFade.pendingText);
    hudFade.pendingText = null;
    hudFade.from = 0;
    hudFade.to = 1;
    hudFade.start = now;
  }

  // Smoothly trail the camera so the panel stays pinned to the bottom
  // center of view without feeling rigidly locked to head motion.
  const followAlpha = 1 - Math.exp(-HUD_FOLLOW_LAMBDA * delta);
  const targetPosition = camera.position
    .clone()
    .add(HUD_OFFSET.clone().applyQuaternion(camera.quaternion));
  hudMesh.position.lerp(targetPosition, followAlpha);
  hudMesh.quaternion.slerp(camera.quaternion, followAlpha);
}

const HUD_INITIAL_DELAY_MS = 4000;
const HUD_SECONDARY_DELAY_MS = 10000;

renderer.xr.addEventListener('sessionstart', () => {
  setTimeout(() => {
    setHudText('Welcome to Orbis.');

    setTimeout(() => {
      setHudText('Describe where you want to be...');
    }, HUD_SECONDARY_DELAY_MS);
  }, HUD_INITIAL_DELAY_MS);
});

// --- Speech-to-text capture --------------------------------------------------
// Hold the trigger on either controller, or press and hold anywhere on a
// handheld AR screen, to record. WebXR's select events cover both input
// types identically, so a single pair of listeners handles both. Recorded
// audio is resampled to 16kHz before being handed to the ASR worker, since
// that is what Whisper expects.

let activeInputSource = null;
let mediaRecorder = null;
let recordedChunks = [];

function startRecording() {
  recordedChunks = [];

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : '';
  mediaRecorder = mimeType
    ? new MediaRecorder(micStream, { mimeType })
    : new MediaRecorder(micStream);

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };
  mediaRecorder.onstop = handleRecordingStop;
  mediaRecorder.start();

  setHudText('Listening...');
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

async function handleRecordingStop() {
  const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
  recordedChunks = [];

  try {
    const arrayBuffer = await blob.arrayBuffer();
    const decodeContext = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await decodeContext.decodeAudioData(arrayBuffer);
    decodeContext.close();

    const frameCount = Math.max(1, Math.ceil(decoded.duration * WHISPER_SAMPLE_RATE));
    const offlineContext = new OfflineAudioContext(1, frameCount, WHISPER_SAMPLE_RATE);
    const source = offlineContext.createBufferSource();
    source.buffer = decoded;
    source.connect(offlineContext.destination);
    source.start(0);
    const resampled = await offlineContext.startRendering();

    // Copy out of the rendered buffer so the Float32Array's backing
    // ArrayBuffer is safe to transfer (not shared with anything else).
    const samples = new Float32Array(resampled.getChannelData(0));

    setHudText('Transcribing...');
    asrWorker.postMessage({ type: 'transcribe', audio: samples }, [samples.buffer]);
  }
  catch (err) {
    console.error('Failed to process recording:', err);
    setHudText("Sorry, I didn't catch that.");
  }
}

function onSelectStart(event) {
  if (activeInputSource || !micStream || !asrReady) {
    return;
  }

  activeInputSource = event.inputSource;
  startRecording();
}

function onSelectEnd(event) {
  if (event.inputSource !== activeInputSource) {
    return;
  }

  activeInputSource = null;
  stopRecording();
}

renderer.xr.addEventListener('sessionstart', () => {
  const session = renderer.xr.getSession();
  session.addEventListener('selectstart', onSelectStart);
  session.addEventListener('selectend', onSelectEnd);
});

renderer.xr.addEventListener('sessionend', () => {
  activeInputSource = null;
  stopRecording();
});

const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();
  updateHud(delta);
  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function showOverlay(message) {
  const overlay = document.createElement('div');
  overlay.id = 'overlay';
  overlay.innerHTML = message;
  app.appendChild(overlay);
}

// Only called once microphone access has been granted, so there is no way
// to enter VR without it.
function enableArEntry() {
  if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
      if (supported) {
        // 'immersive-ar' is what triggers camera passthrough on Quest 3
        // and on ARCore-capable Android phones.
        document.body.appendChild(
          ARButton.createButton(renderer, {
            optionalFeatures: ['local-floor', 'bounded-floor', 'dom-overlay'],
            domOverlay: { root: app },
          }),
        );
      }
      else {
        showOverlay('This device supports WebXR but not passthrough AR sessions.');
      }
    });
  }
  else {
    showOverlay(
      'WebXR is not available in this browser.<br />Try Quest Browser on Quest 3, or Chrome on an ARCore-capable Android phone.',
    );
  }
}
