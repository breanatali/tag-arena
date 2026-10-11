// ============================================================
// TAG ARENA — first person + giant hilly forest
// You ARE the gorilla. Click the game to capture your mouse,
// look around, run with WASD, swing from the tall trees,
// launch off hills. Whoever is "it" is RED.
//
// Terrain trick: ONE function — groundHeight(x, z) — decides where
// the ground is. The visible mesh AND the physics both ask it,
// so what you see is exactly what you stand on. Hills are just
// gaussian bumps: height = strength * e^(-dist² / width).
// ============================================================
import * as THREE from 'three';
import './style.css';

// ---------------- Renderer / scene / camera ----------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 60, 170);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 300);
camera.rotation.order = 'YXZ'; // yaw then pitch: the standard FPS setup
scene.add(camera); // your arms hang off the camera, so it must be in the scene

// ---------------- Lights ----------------
scene.add(new THREE.HemisphereLight(0xffffff, 0x3d7a34, 0.8));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(25, 35, 15);
sun.castShadow = true;
sun.shadow.camera.left = -60;
sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60;
sun.shadow.camera.bottom = -60;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

// ---------------- Terrain ----------------
const ARENA = 80; // 160 x 160 world
const SPAWN_P = { x: -60, z: 0 };
const SPAWN_AI = { x: 60, z: 0 };

// The raw hills: five big bumps + gentle rolling everywhere.
function hillRaw(x, z) {
  let h = 0;
  h += 7 * Math.exp(-((x + 35) ** 2 + (z - 25) ** 2) / 900);
  h += 9 * Math.exp(-((x - 25) ** 2 + (z + 40) ** 2) / 1300);
  h += 6 * Math.exp(-((x - 5) ** 2 + (z - 50) ** 2) / 700);
  h += 8 * Math.exp(-((x - 50) ** 2 + (z + 15) ** 2) / 1000);
  h += 6 * Math.exp(-((x + 20) ** 2 + (z + 55) ** 2) / 800);
  h += 5 * Math.exp(-((x + 55) ** 2 + (z + 45) ** 2) / 700);
  h += 1.4 * Math.sin(x * 0.07) * Math.cos(z * 0.055); // rolling texture
  return h;
}

// The REAL ground height: hills, flattened near both spawns
// (smoothstep mask: 0 at spawn → 1 a short walk away).
function groundHeight(x, z) {
  const h = hillRaw(x, z);
  const d = Math.min(
    Math.hypot(x - SPAWN_P.x, z - SPAWN_P.z),
    Math.hypot(x - SPAWN_AI.x, z - SPAWN_AI.z)
  );
  const m = Math.min(1, d / 18);
  const smooth = m * m * (3 - 2 * m);
  return h * smooth;
}

// Build the visible ground from the SAME function: 110x110 segments,
// each vertex pushed up to groundHeight. More segments = smoother hills.
const groundGeo = new THREE.PlaneGeometry(ARENA * 2, ARENA * 2, 110, 110);
{
  const p = groundGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i);
    const py = p.getY(i);
    // plane local (x, y) becomes world (x, -y) after rotation.x = -PI/2
    p.setZ(i, groundHeight(px, -py));
  }
  groundGeo.computeVertexNormals(); // recalc lighting for the new shape
}
const ground = new THREE.Mesh(
  groundGeo,
  new THREE.MeshStandardMaterial({ color: 0x62a84e })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const wallMat = new THREE.MeshStandardMaterial({ color: 0x8a6f4d });
function addWall(x, z, w, d) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 5, d), wallMat);
  wall.position.set(x, 2.5, z);
  wall.castShadow = true;
  wall.receiveShadow = true;
  scene.add(wall);
}
addWall(0, -ARENA, ARENA * 2 + 2, 1);
addWall(0, ARENA, ARENA * 2 + 2, 1);
addWall(-ARENA, 0, 1, ARENA * 2 + 2);
addWall(ARENA, 0, 1, ARENA * 2 + 2);

// ---------------- Tall trees + crates (planted ON the terrain) ----------------
const colliders = [];
const grabbables = [];

const crateMat = new THREE.MeshStandardMaterial({ color: 0x9c6b3c });
function addCrate(x, z, size = 2) {
  const gy = groundHeight(x, z);
  const crate = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), crateMat);
  crate.position.set(x, gy + size / 2, z);
  crate.rotation.y = Math.random() * 0.6 - 0.3;
  crate.castShadow = true;
  crate.receiveShadow = true;
  scene.add(crate);
  colliders.push({ x, z, r: size * 0.72 });
}

const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6e4a2f });
const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f7d3a });
function addTree(x, z, h = 11) {
  const gy = groundHeight(x, z);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.75, h, 8), trunkMat);
  trunk.position.set(x, gy + h / 2, z);
  const leaves = new THREE.Mesh(new THREE.ConeGeometry(3.4, 6.5, 8), leafMat);
  leaves.position.set(x, gy + h + 2.6, z);
  trunk.castShadow = true;
  leaves.castShadow = true;
  scene.add(trunk, leaves);
  grabbables.push(trunk, leaves);
  colliders.push({ x, z, r: 1.1 });
}

let seed = 7;
function rand() {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}

for (let i = 0; i < 42; i++) {
  const x = (rand() * 2 - 1) * (ARENA - 8);
  const z = (rand() * 2 - 1) * (ARENA - 8);
  if (Math.hypot(x - SPAWN_P.x, z - SPAWN_P.z) < 10) continue;
  if (Math.hypot(x - SPAWN_AI.x, z - SPAWN_AI.z) < 10) continue;
  addTree(x, z, 9 + rand() * 7);
}
addCrate(-40, -20, 2.5);
addCrate(30, 25, 2);
addCrate(-10, 40, 3);
addCrate(45, -30, 2);
addCrate(-50, 30, 2);

// ---------------- Gorillas v2: better looking, still no legs ----------------
// Every gorilla is built from code parts, so ANYTHING is customizable.
// config = { fur, accessory: 'none'|'cap'|'shades'|'partyhat',
//            shorts: 0x…|null, name: null (names arrive with multiplayer) }
const RED = 0xe23b3b; // "it" signal — red arms + ground ring, never the fur itself

function makeGorilla(config) {
  const g = new THREE.Group();
  const furMat = new THREE.MeshStandardMaterial({ color: config.fur, roughness: 0.95 });
  const bellyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(config.fur).lerp(new THREE.Color(0xc9a876), 0.45),
    roughness: 0.95,
  });
  const armMat = new THREE.MeshStandardMaterial({ color: config.fur, roughness: 0.95 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 0.9 });
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });

  function part(geo, mat, x, y, z, parent) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    (parent || g).add(m);
    return m;
  }

  // Torso: big barrel, hunched forward like a real gorilla
  const torso = part(new THREE.SphereGeometry(0.75, 20, 16), furMat, 0, 1.05, 0);
  torso.scale.set(1.05, 1.25, 0.95);
  torso.rotation.x = 0.16;

  // Lighter belly patch
  const belly = part(new THREE.SphereGeometry(0.55, 16, 12), bellyMat, 0, 0.95, 0.4);
  belly.scale.set(0.92, 1.1, 0.55);

  // Head in its own group so accessories anchor to it
  const headG = new THREE.Group();
  headG.position.set(0, 2.02, 0.16);
  g.add(headG);
  const head = part(new THREE.SphereGeometry(0.44, 20, 16), furMat, 0, 0, 0, headG);
  head.scale.set(1, 0.92, 0.95);
  const brow = part(new THREE.SphereGeometry(0.3, 12, 8), furMat, 0, 0.14, 0.3, headG);
  brow.scale.set(1.3, 0.42, 0.7); // heavy brow ridge = instant gorilla
  const muzzle = part(new THREE.SphereGeometry(0.2, 12, 10), bellyMat, 0, -0.12, 0.34, headG);
  muzzle.scale.set(1.3, 0.75, 0.9);
  part(new THREE.SphereGeometry(0.07, 8, 6), dark, 0, -0.07, 0.5, headG); // nose
  for (const side of [-1, 1]) {
    part(new THREE.SphereGeometry(0.1, 10, 8), white, side * 0.16, 0.06, 0.35, headG);
    part(new THREE.SphereGeometry(0.045, 8, 6), dark, side * 0.16, 0.06, 0.43, headG);
    const ear = part(new THREE.SphereGeometry(0.11, 10, 8), furMat, side * 0.42, 0.03, 0, headG);
    ear.scale.set(0.5, 1, 0.8);
  }

  // Arms: long, angled slightly out, with knuckle fists that swing along
  const armGeo = new THREE.CapsuleGeometry(0.18, 1.5, 4, 10);
  armGeo.translate(0, -0.75, 0); // pivot at the shoulder
  const knuckleGeo = new THREE.SphereGeometry(0.23, 12, 10);
  knuckleGeo.scale(1, 0.75, 1.15);
  function makeArm(side) {
    const arm = new THREE.Mesh(armGeo, armMat);
    arm.position.set(side * 0.92, 1.55, 0.05);
    arm.rotation.z = side * -0.1;
    arm.castShadow = true;
    const fist = new THREE.Mesh(knuckleGeo, armMat);
    fist.position.set(0, -1.58, 0.06);
    fist.castShadow = true;
    arm.add(fist); // child of the arm → follows its swing
    g.add(arm);
    return arm;
  }
  const armL = makeArm(-1);
  const armR = makeArm(1);

  // Shorts, for the Megabonk look 😄
  if (config.shorts != null) {
    const shorts = part(
      new THREE.CylinderGeometry(0.62, 0.72, 0.5, 14),
      new THREE.MeshStandardMaterial({ color: config.shorts, roughness: 0.9 }),
      0, 0.42, 0
    );
    shorts.scale.set(1.08, 1, 0.95);
  }

  addAccessory(headG, config.accessory);

  scene.add(g);
  return { group: g, headG, armL, armR, armMat, furMat, config };
}

function addAccessory(headG, kind) {
  if (!kind || kind === 'none') return;
  function bit(geo, color, x, y, z, rough) {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: rough == null ? 0.8 : rough }));
    m.position.set(x, y, z);
    m.castShadow = true;
    headG.add(m);
    return m;
  }
  if (kind === 'cap') {
    bit(new THREE.SphereGeometry(0.3, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0xd23b3b, 0, 0.3, 0);
    const brim = bit(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 14), 0xd23b3b, 0, 0.3, 0.22);
    brim.scale.set(1, 1, 1.5);
    bit(new THREE.SphereGeometry(0.07, 8, 6), 0xd23b3b, 0, 0.62, 0);
  } else if (kind === 'shades') {
    for (const side of [-1, 1]) {
      bit(new THREE.BoxGeometry(0.17, 0.11, 0.06), 0x111111, side * 0.16, 0.06, 0.42, 0.3);
    }
    bit(new THREE.BoxGeometry(0.12, 0.04, 0.04), 0x111111, 0, 0.06, 0.42, 0.3); // bridge
  } else if (kind === 'partyhat') {
    const cone = bit(new THREE.ConeGeometry(0.18, 0.42, 12), 0x7a3fd1, 0.05, 0.55, 0);
    cone.rotation.z = -0.18;
    bit(new THREE.SphereGeometry(0.07, 8, 6), 0xffffff, 0.09, 0.76, 0, 0.6); // pompom
  }
}

// Your look, remembered between visits
const DEFAULT_LOOK = { fur: 0x4a3320, accessory: 'none', shorts: null, name: null };
let playerLook = { ...DEFAULT_LOOK };
try {
  const saved = JSON.parse(localStorage.getItem('tagArenaLook'));
  if (saved && typeof saved.fur === 'number') playerLook = { ...DEFAULT_LOOK, ...saved };
} catch (err) { /* private mode — just use defaults */ }
function saveLook() {
  try { localStorage.setItem('tagArenaLook', JSON.stringify(playerLook)); } catch (err) {}
}

const playerG = makeGorilla(playerLook);
playerG.group.visible = false; // first person: your body is hidden…
const aiG = makeGorilla({ fur: 0x2b2b2b, accessory: 'shades', shorts: 0x27408b, name: null }); // your rival's look

// …but your ARMS hang off the camera, FPS-style.
const fpFur = new THREE.MeshStandardMaterial({ color: playerLook.fur });
const fpArmGeo = new THREE.CapsuleGeometry(0.13, 0.85, 4, 10);
fpArmGeo.translate(0, -0.42, 0);
const fpArmL = new THREE.Mesh(fpArmGeo, fpFur);
fpArmL.position.set(-0.5, -0.55, -1.0);
const fpArmR = new THREE.Mesh(fpArmGeo, fpFur);
fpArmR.position.set(0.5, -0.55, -1.0);
camera.add(fpArmL, fpArmR);

// Live 3D preview of your gorilla, shown while the customize panel is open
let previewG = null;
function disposeGroup(gr) {
  gr.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
  });
}
function refreshPreview() {
  if (previewG) {
    scene.remove(previewG.group);
    disposeGroup(previewG.group); // free GPU memory — rebuilt on every tweak
  }
  previewG = makeGorilla(playerLook);
  previewG.group.visible = true;
  scene.add(previewG.group);
}
function updatePlayerArms() {
  fpFur.color.setHex(playerLook.fur);
}

const player = {
  pos: new THREE.Vector3(SPAWN_P.x, 0, SPAWN_P.z), // pos.y = feet height (world Y)
  vel: new THREE.Vector3(),
  speed: 14,
  radius: 0.7,
  swing: null,
  grounded: true,
};
const ai = {
  g: aiG,
  pos: new THREE.Vector3(SPAWN_AI.x, 0, SPAWN_AI.z),
  radius: 0.7,
  wanderT: Math.random() * 10,
};
const AI_TAGGER_SPEED = 11;
const AI_RUNNER_SPEED = 12;

const GRAVITY = 26;
const JUMP_V = 15;
const HEAD_H = 2.3;
const HAND_H = 2.9;

// ---------------- Rope (vine) visual ----------------
const ropeGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const rope = new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: 0x4a2f18 }));
rope.visible = false;
rope.frustumCulled = false;
scene.add(rope);

// Pulsing red ring on the ground under whoever is "it"
// (fur stays custom — the ring alone carries the signal)
const tagRing = new THREE.Mesh(
  new THREE.RingGeometry(0.9, 1.2, 40),
  new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
);
tagRing.rotation.x = -Math.PI / 2;
scene.add(tagRing);

function handWorldPos(out) {
  return out.set(player.pos.x, HAND_H + player.pos.y, player.pos.z);
}
const _hand = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();

function releaseSwing() {
  player.vel.copy(player.swing.handVel);
  player.swing = null;
  rope.visible = false;
}

// ---------------- Input ----------------
const keys = {};
const GAME_KEYS = [
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'ShiftLeft', 'ShiftRight', 'KeyC',
];
function doJump() {
  if (player.swing) releaseSwing();
  else if (player.grounded) {
    player.vel.y = JUMP_V;
    player.grounded = false;
  }
}
window.addEventListener('keydown', (e) => {
  if (GAME_KEYS.includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys[e.code] = true;
  if (e.code === 'Space') doJump();
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
});

let yaw = -Math.PI / 2;
let pitch = 0;
renderer.domElement.addEventListener('click', () => {
  if (controlMode !== 'pc') return; // touch mode needs no pointer lock
  if (document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock();
  }
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  yaw -= e.movementX * 0.0024;
  pitch -= e.movementY * 0.0024;
  pitch = Math.max(-1.25, Math.min(1.25, pitch));
});

const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();
// Grabbing a vine, shared by PC clicks and touch taps.
function tryGrab(clientX, clientY) {
  if (player.swing) {
    releaseSwing();
    return;
  }
  mouseNDC.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouseNDC, camera);
  const hits = raycaster.intersectObjects(grabbables, false);
  if (hits.length > 0 && hits[0].distance < 80) {
    const anchor = hits[0].point.clone();
    handWorldPos(_hand);
    player.swing = {
      anchor,
      length: _hand.distanceTo(anchor),
      handVel: player.vel.clone(),
    };
    rope.visible = true;
  }
}
window.addEventListener('pointerdown', (e) => {
  if (controlMode !== 'pc') return; // touch taps are handled by the touch code below
  if (document.pointerLockElement !== renderer.domElement) return;
  tryGrab(e.clientX, e.clientY);
});

// ---------------- Touch controls + PC/touch toggle ----------------
// Phones have no keyboard/mouse, so touch mode gives you:
//   left thumb  = virtual joystick (run)
//   right thumb = drag to look, quick tap to grab a tree
//   buttons     = JUMP, and climb ▲▼ while swinging
// The toggle remembers your choice in localStorage.
const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
let controlMode = null;
try {
  controlMode = localStorage.getItem('tagArenaControls');
} catch (err) { /* private mode etc. — fall through to default */ }
if (controlMode !== 'pc' && controlMode !== 'touch') {
  controlMode = isTouchDevice ? 'touch' : 'pc';
}

const touchUI = document.getElementById('touch-ui');
const joystickEl = document.getElementById('joystick');
const stickEl = document.getElementById('stick');
const jumpBtn = document.getElementById('btn-jump');
const climbUpBtn = document.getElementById('btn-up');
const climbDownBtn = document.getElementById('btn-down');
const toggleBtn = document.getElementById('controls-toggle');
const helpEl = document.getElementById('help');

const HELP_PC = 'Click the game to look around &bull; WASD to move &bull; Space to jump &bull; Click a tree to swing &bull; SHIFT / C to climb the vine! (ESC frees your mouse)';
const HELP_TOUCH = 'Left stick to run &bull; Drag to look &bull; Tap a tree to swing &bull; JUMP button to leap &bull; &#9650; &#9660; to climb the vine!';

function applyControlMode() {
  const touch = controlMode === 'touch';
  touchUI.classList.toggle('hidden', !touch);
  toggleBtn.textContent = touch ? '\uD83D\uDCB1' : '\uD83C\uDFAE'; // 🖱️ : 🎮
  toggleBtn.title = touch ? 'Switch to PC controls' : 'Switch to touch controls';
  helpEl.innerHTML = touch ? HELP_TOUCH : HELP_PC;
  if (!touch && document.pointerLockElement) document.exitPointerLock();
  try {
    localStorage.setItem('tagArenaControls', controlMode);
  } catch (err) {}
}
toggleBtn.addEventListener('click', () => {
  controlMode = controlMode === 'touch' ? 'pc' : 'touch';
  applyControlMode();
});

// One finger can be on the joystick while another drags to look,
// so every touch is tracked by its identifier.
const joy = { active: false, id: null, x: 0, y: 0 };
const look = { id: null, x: 0, y: 0, t: 0, moved: 0 };
let touchClimbUp = false;
let touchClimbDown = false;
const JOY_RADIUS = 45;

function moveStick(t) {
  const r = joystickEl.getBoundingClientRect();
  let dx = t.clientX - (r.left + r.width / 2);
  let dy = t.clientY - (r.top + r.height / 2);
  const len = Math.hypot(dx, dy);
  if (len > JOY_RADIUS) {
    dx = (dx / len) * JOY_RADIUS;
    dy = (dy / len) * JOY_RADIUS;
  }
  stickEl.style.transform = `translate(${dx}px, ${dy}px)`;
  joy.x = dx / JOY_RADIUS;
  joy.y = dy / JOY_RADIUS;
}
function resetStick() {
  joy.active = false;
  joy.id = null;
  joy.x = 0;
  joy.y = 0;
  stickEl.style.transform = 'translate(0px, 0px)';
}

joystickEl.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const t = e.changedTouches[0];
  joy.active = true;
  joy.id = t.identifier;
  moveStick(t);
}, { passive: false });

renderer.domElement.addEventListener('touchstart', (e) => {
  if (controlMode !== 'touch') return;
  e.preventDefault();
  const t = e.changedTouches[0];
  look.id = t.identifier;
  look.x = t.clientX;
  look.y = t.clientY;
  look.t = performance.now();
  look.moved = 0;
}, { passive: false });

window.addEventListener('touchmove', (e) => {
  if (controlMode !== 'touch') return;
  e.preventDefault(); // stop the page scrolling while playing
  for (const t of e.changedTouches) {
    if (joy.active && t.identifier === joy.id) {
      moveStick(t);
    } else if (t.identifier === look.id) {
      const dx = t.clientX - look.x;
      const dy = t.clientY - look.y;
      look.moved += Math.abs(dx) + Math.abs(dy);
      yaw -= dx * 0.0055;
      pitch -= dy * 0.0055;
      pitch = Math.max(-1.25, Math.min(1.25, pitch));
      look.x = t.clientX;
      look.y = t.clientY;
    }
  }
}, { passive: false });

function touchEnd(e) {
  for (const t of e.changedTouches) {
    if (joy.active && t.identifier === joy.id) resetStick();
    if (t.identifier === look.id) {
      // Quick tap (not a drag) = grab attempt, like clicking a tree on PC
      if (performance.now() - look.t < 300 && look.moved < 20) {
        tryGrab(t.clientX, t.clientY);
      }
      look.id = null;
    }
  }
}
window.addEventListener('touchend', touchEnd);
window.addEventListener('touchcancel', touchEnd);

jumpBtn.addEventListener('touchstart', (e) => { e.preventDefault(); doJump(); }, { passive: false });
climbUpBtn.addEventListener('touchstart', (e) => { e.preventDefault(); touchClimbUp = true; }, { passive: false });
climbDownBtn.addEventListener('touchstart', (e) => { e.preventDefault(); touchClimbDown = true; }, { passive: false });
for (const b of [climbUpBtn, climbDownBtn]) {
  b.addEventListener('touchend', () => { touchClimbUp = false; touchClimbDown = false; });
  b.addEventListener('touchcancel', () => { touchClimbUp = false; touchClimbDown = false; });
}
window.addEventListener('contextmenu', (e) => { if (controlMode === 'touch') e.preventDefault(); });

applyControlMode();

// ---------------- Character customization ----------------
// 🎨 button opens a panel; your gorilla appears in front of you as a live
// 3D preview. Every tweak rebuilds it and saves to localStorage.
const customizePanel = document.getElementById('customize-panel');
const customizeBtn = document.getElementById('customize-btn');
const furSwatches = document.getElementById('fur-swatches');
const shortsSwatches = document.getElementById('shorts-swatches');

const FUR_COLORS = [0x4a3320, 0x232323, 0x6e6e6e, 0xe8e0d0, 0x7a4a2b, 0x2f6df6, 0x2f7d3a, 0x6b4a8a];
const SHORTS_COLORS = [null, 0x27408b, 0xd23b3b, 0x2f7d3a, 0xe8e0d0, 0x232323];
const cssHex = (h) => '#' + h.toString(16).padStart(6, '0');

function buildSwatches(el, colors, isSelected, onPick) {
  el.innerHTML = '';
  for (const c of colors) {
    const b = document.createElement('button');
    b.className = 'swatch' + (isSelected(c) ? ' selected' : '');
    if (c == null) {
      b.textContent = '✕';
      b.title = 'None';
      b.classList.add('swatch-none');
    } else {
      b.style.background = cssHex(c);
      b.title = cssHex(c);
    }
    b.addEventListener('click', () => onPick(c));
    el.appendChild(b);
  }
}
function refreshSwatches() {
  buildSwatches(furSwatches, FUR_COLORS, (c) => c === playerLook.fur, (c) => {
    playerLook.fur = c;
    applyLookChange();
  });
  buildSwatches(shortsSwatches, SHORTS_COLORS, (c) => c === playerLook.shorts, (c) => {
    playerLook.shorts = c;
    applyLookChange();
  });
  document.querySelectorAll('#acc-buttons button').forEach((b) => {
    b.classList.toggle('selected', b.dataset.acc === playerLook.accessory);
  });
}
function applyLookChange() {
  saveLook();
  updatePlayerArms();
  refreshSwatches();
  refreshPreview();
}
document.querySelectorAll('#acc-buttons button').forEach((b) => {
  b.addEventListener('click', () => {
    playerLook.accessory = b.dataset.acc;
    applyLookChange();
  });
});

customizeBtn.addEventListener('click', () => {
  if (document.pointerLockElement) document.exitPointerLock(); // need the mouse for the panel
  refreshSwatches();
  refreshPreview();
  customizePanel.classList.remove('hidden');
});
document.getElementById('customize-close').addEventListener('click', () => {
  customizePanel.classList.add('hidden');
  if (previewG) previewG.group.visible = false;
});

// ---------------- Game state ----------------
let playerIsTagger = false;
let graceT = 0;
let playerTags = 0;
let timeAlive = 0;
let flashT = 0;

const timerEl = document.getElementById('timer');
const tagsEl = document.getElementById('tags');
const roleEl = document.getElementById('role');
const flashEl = document.getElementById('flash');

function flash(text) {
  flashEl.textContent = text;
  flashEl.classList.remove('hidden');
  flashT = 1.6;
}

function updateRoleUI() {
  if (playerIsTagger) {
    roleEl.textContent = "🦍 YOU'RE IT!";
    roleEl.className = 'tagger';
  } else {
    roleEl.textContent = '🏃 RUN!';
    roleEl.className = 'runner';
  }
  updatePlayerArms();
}

function onTag() {
  if (player.swing) releaseSwing();
  if (playerIsTagger) {
    playerTags++;
    tagsEl.textContent = 'Tags: ' + playerTags;
    flash('TAGGED THEM! Now run!');
  } else {
    flash("TAGGED! You're it!");
  }
  playerIsTagger = !playerIsTagger;
  graceT = 2;
  updateRoleUI();
}
updateRoleUI();

// ---------------- Collision ----------------
function collide(pos, radius) {
  for (const c of colliders) {
    const dx = pos.x - c.x;
    const dz = pos.z - c.z;
    const dist = Math.hypot(dx, dz);
    const minDist = radius + c.r;
    if (dist < minDist && dist > 0.0001) {
      const push = (minDist - dist) / dist;
      pos.x += dx * push;
      pos.z += dz * push;
    }
  }
  const lim = ARENA - 1;
  pos.x = Math.max(-lim, Math.min(lim, pos.x));
  pos.z = Math.max(-lim, Math.min(lim, pos.z));
}

function faceToward(group, dirX, dirZ, dt, turnSpeed = 12) {
  const targetAngle = Math.atan2(dirX, dirZ);
  let diff = targetAngle - group.rotation.y;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  group.rotation.y += diff * Math.min(1, dt * turnSpeed);
}

function animateArms(gorilla, t) {
  const s = Math.sin(t * 10) * 0.55;
  gorilla.armL.rotation.x = s;
  gorilla.armR.rotation.x = -s;
}

// ---------------- Per-frame update ----------------
let elapsed = 0;

function update(dt) {
  elapsed += dt;
  timeAlive += dt;
  timerEl.textContent = timeAlive.toFixed(1) + 's';
  if (graceT > 0) graceT -= dt;
  if (flashT > 0) {
    flashT -= dt;
    if (flashT <= 0) flashEl.classList.add('hidden');
  }

  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

  const move = new THREE.Vector3();
  if (keys['KeyW'] || keys['ArrowUp']) move.add(fwd);
  if (keys['KeyS'] || keys['ArrowDown']) move.sub(fwd);
  if (keys['KeyD'] || keys['ArrowRight']) move.add(right);
  if (keys['KeyA'] || keys['ArrowLeft']) move.sub(right);
  if (joy.active && (joy.x !== 0 || joy.y !== 0)) {
    move.addScaledVector(fwd, -joy.y); // push the stick up = run forward
    move.addScaledVector(right, joy.x);
  }
  const moving = move.lengthSq() > 0;
  if (moving) move.normalize();

  if (player.swing) {
    // --- Vine swinging ---
    const s = player.swing;
    const hv = s.handVel;
    hv.y -= GRAVITY * dt;
    if ((keys['KeyW'] || keys['ArrowUp']) && hv.length() < 30) {
      _tmp.copy(hv).normalize();
      hv.addScaledVector(_tmp, 18 * dt);
    }
    if (keys['ShiftLeft'] || keys['ShiftRight'] || touchClimbUp) {
      s.length = Math.max(3, s.length - 8 * dt); // climb up
    }
    if (keys['KeyC'] || touchClimbDown) {
      s.length = Math.min(60, s.length + 8 * dt); // slide down
    }
    handWorldPos(_hand);
    _hand.addScaledVector(hv, dt);
    _tmp.subVectors(_hand, s.anchor);
    _tmp.normalize();
    _hand.copy(s.anchor).addScaledVector(_tmp, s.length);
    const radial = hv.dot(_tmp);
    if (radial > 0) hv.addScaledVector(_tmp, -radial);
    player.pos.x = _hand.x;
    player.pos.z = _hand.z;
    player.pos.y = Math.max(0, _hand.y - HAND_H);
    // Landing now means reaching the TERRAIN, not y=0
    const gh = groundHeight(player.pos.x, player.pos.z);
    if (player.pos.y <= gh && hv.y < 0) {
      releaseSwing();
      player.pos.y = gh;
      player.vel.y = 0;
      player.grounded = true;
    }
    const pts = ropeGeo.attributes.position;
    pts.setXYZ(0, s.anchor.x, s.anchor.y, s.anchor.z);
    handWorldPos(_hand);
    pts.setXYZ(1, _hand.x, _hand.y, _hand.z);
    pts.needsUpdate = true;
  } else {
    // --- Running + jumping on the hills ---
    player.vel.x = move.x * player.speed;
    player.vel.z = move.z * player.speed;
    player.vel.y -= GRAVITY * dt;
    player.pos.addScaledVector(player.vel, dt);
    const gh = groundHeight(player.pos.x, player.pos.z);
    if (player.pos.y <= gh) {
      player.pos.y = gh; // snap feet to the terrain
      player.vel.y = 0;
      player.grounded = true;
    }
  }
  collide(player.pos, player.radius);

  // --- Your arms ---
  if (player.swing) {
    fpArmL.rotation.x = -2.4;
    fpArmR.rotation.x = -2.4;
  } else if (moving) {
    const s = Math.sin(elapsed * 10) * 0.5;
    fpArmL.rotation.x = s;
    fpArmR.rotation.x = -s;
  } else {
    fpArmL.rotation.x *= 0.9;
    fpArmR.rotation.x *= 0.9;
  }

  // Climb buttons only make sense while swinging
  const swinging = !!player.swing;
  climbUpBtn.classList.toggle('hidden', !swinging);
  climbDownBtn.classList.toggle('hidden', !swinging);

  // Your gorilla preview, standing in front of you while customizing
  if (previewG && previewG.group.visible) {
    const px = camera.position.x - Math.sin(yaw) * 5.5;
    const pz = camera.position.z - Math.cos(yaw) * 5.5;
    previewG.group.position.set(px, groundHeight(px, pz), pz);
    faceToward(previewG.group, Math.sin(yaw), Math.cos(yaw), dt, 6);
    animateArms(previewG, elapsed * 0.6);
  }

  // Pulsing ring under whoever is "it"
  const taggerPos = playerIsTagger ? player.pos : ai.pos;
  tagRing.position.set(taggerPos.x, groundHeight(taggerPos.x, taggerPos.z) + 0.15, taggerPos.z);
  const pulse = 1 + Math.sin(elapsed * 6) * 0.07;
  tagRing.scale.set(pulse, pulse, 1);

  // --- AI ---
  ai.wanderT += dt;
  if (!playerIsTagger) {
    _tmp.subVectors(player.pos, ai.pos);
    _tmp.y = 0;
    if (_tmp.lengthSq() > 0.001) {
      _tmp.normalize();
      ai.pos.addScaledVector(_tmp, AI_TAGGER_SPEED * dt);
      faceToward(aiG.group, _tmp.x, _tmp.z, dt, 8);
    }
  } else {
    _tmp.subVectors(ai.pos, player.pos);
    _tmp.y = 0;
    if (_tmp.lengthSq() > 0.001) {
      _tmp.normalize();
      const wobble = Math.sin(ai.wanderT * 2.3) * 0.5;
      _tmp2.set(-_tmp.z, 0, _tmp.x);
      _tmp.addScaledVector(_tmp2, wobble).normalize();
      ai.pos.addScaledVector(_tmp, AI_RUNNER_SPEED * dt);
      faceToward(aiG.group, _tmp.x, _tmp.z, dt, 8);
    }
  }
  collide(ai.pos, ai.radius);
  ai.pos.y = groundHeight(ai.pos.x, ai.pos.z); // the AI walks the hills too
  aiG.group.position.set(ai.pos.x, ai.pos.y, ai.pos.z);
  animateArms(aiG, elapsed);

  // --- First-person camera ---
  camera.position.set(player.pos.x, player.pos.y + HEAD_H, player.pos.z);
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;

  // --- Tag check: "air" now means above the TERRAIN, not above y=0 ---
  const hdist = Math.hypot(player.pos.x - ai.pos.x, player.pos.z - ai.pos.z);
  const aboveGround = player.pos.y - groundHeight(player.pos.x, player.pos.z);
  const customizing = !customizePanel.classList.contains('hidden');
  if (!customizing && graceT <= 0 && hdist < 1.5 && aboveGround < 2.5) {
    onTag();
  }
}

// ---------------- Main loop ----------------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
