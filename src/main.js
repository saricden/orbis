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

function drawHudText(text) {
  const w = hudCanvas.width;
  const h = hudCanvas.height;
  hudCtx.clearRect(0, 0, w, h);

  const lines = text.split('\n');
  const fontSize = Math.max(18, Math.min(40, (h - 64) / lines.length / 1.25));
  const lineHeight = fontSize * 1.25;
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

renderer.xr.addEventListener('sessionstart', () => {
  setTimeout(() => {
    setHudText('Welcome to Orbis.');
  }, HUD_INITIAL_DELAY_MS);
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
