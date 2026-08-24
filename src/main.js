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

scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.5));
const directional = new THREE.DirectionalLight(0xffffff, 1.5);
directional.position.set(1, 2, 1);
scene.add(directional);

// A small cluster of objects placed a couple of meters in front of the
// origin (which becomes the headset/device's starting position on session
// start) so there is something to see against the passthrough feed.
const group = new THREE.Group();
group.position.set(0, 0, -1.5);
scene.add(group);

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(0.2, 0.2, 0.2),
  new THREE.MeshStandardMaterial({ color: 0x2196f3 }),
);
cube.position.set(-0.3, 0, 0);
group.add(cube);

const sphere = new THREE.Mesh(
  new THREE.SphereGeometry(0.12, 32, 16),
  new THREE.MeshStandardMaterial({ color: 0xff5722 }),
);
sphere.position.set(0.3, 0, 0);
group.add(sphere);

const ring = new THREE.Mesh(
  new THREE.TorusGeometry(0.15, 0.03, 16, 48),
  new THREE.MeshStandardMaterial({ color: 0x4caf50 }),
);
group.add(ring);

renderer.setAnimationLoop((time) => {
  const t = time * 0.001;
  cube.rotation.set(t * 0.6, t * 0.8, 0);
  sphere.position.y = Math.sin(t) * 0.1;
  ring.rotation.x = t * 0.4;

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
    } else {
      showOverlay('This device supports WebXR but not passthrough AR sessions.');
    }
  });
} else {
  showOverlay(
    'WebXR is not available in this browser.<br />Try Quest Browser on Quest 3, or Chrome on an ARCore-capable Android phone.',
  );
}
