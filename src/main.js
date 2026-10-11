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

// ---------------- Gorillas (no legs — all arms, like the real thing) ----------------
function makeGorilla(color) {
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color });
  const dark = new THREE.MeshStandardMaterial({ color: 0x201510 });
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.7, 18, 14), fur);
  body.position.y = 1.0;
  body.scale.set(1, 1.15, 0.9);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.45, 18, 14), fur);
  head.position.y = 1.9;

  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), dark);
  snout.position.set(0, 1.8, 0.36);
  snout.scale.set(1.2, 0.8, 0.8);

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), white);
    eye.position.set(side * 0.18, 1.97, 0.38);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), dark);
    pupil.position.set(side * 0.18, 1.97, 0.47);
    g.add(eye, pupil);
  }

  const armGeo = new THREE.CapsuleGeometry(0.17, 1.4, 4, 10);
  armGeo.translate(0, -0.7, 0);
  const armL = new THREE.Mesh(armGeo, fur);
  armL.position.set(-0.85, 1.45, 0);
  const armR = new THREE.Mesh(armGeo, fur);
  armR.position.set(0.85, 1.45, 0);

  for (const m of [body, head, snout, armL, armR]) {
    m.castShadow = true;
    g.add(m);
  }
  scene.add(g);
  return { group: g, armL, armR, furMats: [fur] };
}

function paintGorilla(gorilla, hex) {
  for (const m of gorilla.furMats) m.color.setHex(hex);
}

const BLUE = 0x2f6df6;
const RED = 0xe23b3b;

const playerG = makeGorilla(BLUE);
playerG.group.visible = false; // first person: your body is hidden…
const aiG = makeGorilla(RED);

// …but your ARMS hang off the camera, FPS-style.
const fpFur = new THREE.MeshStandardMaterial({ color: BLUE });
const fpArmGeo = new THREE.CapsuleGeometry(0.13, 0.85, 4, 10);
fpArmGeo.translate(0, -0.42, 0);
const fpArmL = new THREE.Mesh(fpArmGeo, fpFur);
fpArmL.position.set(-0.5, -0.55, -1.0);
const fpArmR = new THREE.Mesh(fpArmGeo, fpFur);
fpArmR.position.set(0.5, -0.55, -1.0);
camera.add(fpArmL, fpArmR);

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
window.addEventListener('keydown', (e) => {
  if (GAME_KEYS.includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys[e.code] = true;
  if (e.code === 'Space') {
    if (player.swing) releaseSwing();
    else if (player.grounded) {
      player.vel.y = JUMP_V;
      player.grounded = false;
    }
  }
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
});

let yaw = -Math.PI / 2;
let pitch = 0;
renderer.domElement.addEventListener('click', () => {
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
window.addEventListener('pointerdown', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  if (player.swing) {
    releaseSwing();
    return;
  }
  mouseNDC.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
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
    paintGorilla(aiG, BLUE);
    fpFur.color.setHex(RED);
  } else {
    roleEl.textContent = '🏃 RUN!';
    roleEl.className = 'runner';
    paintGorilla(aiG, RED);
    fpFur.color.setHex(BLUE);
  }
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
    if (keys['ShiftLeft'] || keys['ShiftRight']) {
      s.length = Math.max(3, s.length - 8 * dt); // climb up
    }
    if (keys['KeyC']) {
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
  if (graceT <= 0 && hdist < 1.5 && aboveGround < 2.5) {
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
