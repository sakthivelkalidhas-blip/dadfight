import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Elements
const csLoneWolfBtn = document.getElementById('cs-lonewolf-btn');
const brModeBtn = document.getElementById('br-mode-btn');
const playerNameInput = document.getElementById('player-name-input');
const lobbyStatusEl = document.getElementById('lobby-status');

const introScreen = document.getElementById('intro-screen');
const lobbyCard = document.getElementById('lobby-card');
const gameOverModal = document.getElementById('game-over-modal');

const hpEl = document.getElementById('hp');
const hpBarInner = document.getElementById('hp-bar-inner');
const glooEl = document.getElementById('gloo-count');
const ammoCountEl = document.getElementById('ammo-count');
const localScoreEl = document.getElementById('local-score');
const remoteScoreEl = document.getElementById('remote-score');

const shopOverlay = document.getElementById('shop-overlay');
const shopStatusEl = document.getElementById('shop-status');
const shopConfirmBtn = document.getElementById('shop-confirm-btn');
const weaponButtons = document.querySelectorAll('.weapon-btn');

// Safe Initialization via Global Colyseus Object
if (!window.Colyseus) {
  lobbyStatusEl.innerText = 'Failed to load multiplayer library. Refresh the page.';
  throw new Error('window.Colyseus is undefined — check that the Colyseus CDN <script> tag loaded before app.js');
}

const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const host = window.location.host;
const client = new window.Colyseus.Client(`${protocol}://${host}`);
let room = null;

// Audio Synthesizer
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playGunshot() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(300, now);
  osc.frequency.exponentialRampToValueAtTime(0.01, now + 0.15);
  gain.gain.setValueAtTime(0.5, now);
  gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.15);
}

// Scene Setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0f12);
scene.fog = new THREE.Fog(0x0d0f12, 34, 110);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1.6, 34);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('canvas-container').appendChild(renderer.domElement);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.4, 0.82));
composer.addPass(new OutputPass());

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// Arena Floor & Light
scene.add(new THREE.HemisphereLight(0x9fb7c9, 0x2b2416, 0.6));
const sunLight = new THREE.DirectionalLight(0xffe3b8, 1.0);
sunLight.position.set(-24, 34, -18);
sunLight.castShadow = true;
scene.add(sunLight);

const ROOM_HALF = 46;
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(ROOM_HALF * 2, ROOM_HALF * 2),
  new THREE.MeshStandardMaterial({ color: 0x222426, roughness: 0.85 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// Loadouts Configuration
// NOTE: keep this in sync with WEAPON_DAMAGE in server.js — the server is
// the source of truth for damage; this copy only drives client-side fire
// rate pacing and the ammo/reload HUD.
const MAG_SIZE = 20;
const WEAPONS = {
  mp40:   { name: 'MP40', damage: 16, fireRate: 0.11 },
  ump:    { name: 'UMP', damage: 18, fireRate: 0.14 },
  m1911:  { name: 'M1911', damage: 26, fireRate: 0.28 },
  deagle: { name: 'Desert Eagle', damage: 38, fireRate: 0.38 },
  g18:    { name: 'G18', damage: 20, fireRate: 0.10 },
  awm:    { name: 'AWM', damage: 95, fireRate: 1.30 },
  kar98k: { name: 'Kar98k', damage: 85, fireRate: 1.20 },
  m24:    { name: 'M24', damage: 80, fireRate: 1.15 }
};

let selectedWeaponKey = 'mp40';
let currentAmmo = MAG_SIZE;
let lastShotTime = 0;

const MAX_HP = 200;
let health = MAX_HP;
let glooWallsLeft = 3;
let gameStarted = false;
let lastRoundStatus = null;

const controls = new PointerLockControls(camera, renderer.domElement);

// Player Meshes
const remotePlayers = {};

function buildCharacterMesh() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x00e5ff });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1.2, 4, 8), mat);
  body.position.y = 1.0;
  body.castShadow = true;
  group.add(body);
  return group;
}

function resetLoadoutHud() {
  currentAmmo = MAG_SIZE;
  glooWallsLeft = 3;
  ammoCountEl.innerText = currentAmmo;
  glooEl.innerText = glooWallsLeft;
}

// Room Logic
async function joinGameRoom(roomName) {
  try {
    ensureAudio();
    const inputVal = playerNameInput.value ? playerNameInput.value.trim() : "";
    const name = inputVal !== "" ? inputVal : "Player";

    lobbyStatusEl.innerText = "Connecting to Game Server...";

    room = await client.joinOrCreate(roomName, { name: name });
    lobbyStatusEl.innerText = "Connected! Entering arena...";

    setupRoomListeners();
    introScreen.classList.add('hidden');
    gameStarted = true;
    if (!('ontouchstart' in window)) controls.lock();

  } catch (err) {
    console.error("Colyseus Join Error:", err);
    lobbyStatusEl.innerText = `Connection Error: ${err.message || 'see console'}`;
  }
}

csLoneWolfBtn.addEventListener('click', () => joinGameRoom('lone_wolf'));
brModeBtn.addEventListener('click', () => joinGameRoom('battle_royale'));

function setupRoomListeners() {
  if (!room || !room.state) return;

  room.onLeave(() => {
    lobbyStatusEl.innerText = 'Disconnected from server.';
  });
  room.onError((code, message) => {
    console.error('Colyseus room error:', code, message);
  });

  if (room.state.players) {
    room.state.players.onAdd((player, sessionId) => {
      if (sessionId === room.sessionId) {
        health = player.hp;
        hpEl.innerText = health;
        hpBarInner.style.width = (Math.max(health, 0) / MAX_HP) * 100 + '%';

        player.onChange(() => {
          health = player.hp;
          hpEl.innerText = health;
          hpBarInner.style.width = (Math.max(health, 0) / MAX_HP) * 100 + '%';
        });
      } else {
        const mesh = buildCharacterMesh();
        scene.add(mesh);
        remotePlayers[sessionId] = mesh;
        mesh.position.set(player.position.x, player.position.y, player.position.z);

        player.position.onChange(() => {
          mesh.position.set(player.position.x, player.position.y, player.position.z);
          mesh.rotation.y = player.rotationY;
        });
      }
    });

    room.state.players.onRemove((player, sessionId) => {
      if (remotePlayers[sessionId]) {
        scene.remove(remotePlayers[sessionId]);
        delete remotePlayers[sessionId];
      }
    });
  }

  if (room.state.glooWalls) {
    room.state.glooWalls.onAdd((wall) => {
      const wallMesh = new THREE.Mesh(
        new THREE.BoxGeometry(5, 4, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.75 })
      );
      wallMesh.position.set(wall.position.x, wall.position.y, wall.position.z);
      wallMesh.rotation.y = wall.rotationY;
      scene.add(wallMesh);
    });
  }

  room.state.onChange(() => {
    if (room.state.status === "SHOP") {
      shopOverlay.classList.remove('hidden');
      shopStatusEl.innerText = "Pick your weapon, then lock in.";
      if (controls.isLocked) controls.unlock();
    } else if (room.state.status === "IN_ROUND") {
      shopOverlay.classList.add('hidden');
      // Round just started — refill ammo & gloo walls for the new round.
      if (lastRoundStatus !== "IN_ROUND") resetLoadoutHud();
      if (!('ontouchstart' in window)) controls.lock();
    } else if (room.state.status === "GAME_OVER") {
      if (controls.isLocked) controls.unlock();
      introScreen.classList.remove('hidden');
      lobbyCard.classList.add('hidden');
      gameOverModal.classList.remove('hidden');
    }
    lastRoundStatus = room.state.status;
    localScoreEl.innerText = room.state.team1Score || 0;
    remoteScoreEl.innerText = room.state.team2Score || 0;
  });
}

// Controls & Firing Loop
weaponButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    weaponButtons.forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedWeaponKey = btn.dataset.weapon;
  });
});

shopConfirmBtn.addEventListener('click', () => {
  if (room) {
    room.send("shop_lock", { weapon: selectedWeaponKey });
    shopOverlay.classList.add('hidden');
    shopStatusEl.innerText = "Locked in! Waiting for others...";
  }
});

const moveState = { forward: false, backward: false, left: false, right: false };
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyW') moveState.forward = true;
  if (e.code === 'KeyS') moveState.backward = true;
  if (e.code === 'KeyA') moveState.left = true;
  if (e.code === 'KeyD') moveState.right = true;
  if (e.code === 'KeyE') deployGlooWall();
  if (e.code === 'KeyR') {
    currentAmmo = MAG_SIZE;
    ammoCountEl.innerText = currentAmmo;
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'KeyW') moveState.forward = false;
  if (e.code === 'KeyS') moveState.backward = false;
  if (e.code === 'KeyA') moveState.left = false;
  if (e.code === 'KeyD') moveState.right = false;
});

window.addEventListener('mousedown', (e) => {
  if (controls.isLocked && e.button === 0) shoot();
});

// Re-lock pointer if it was dropped (e.g. via Escape) and the player clicks back in.
renderer.domElement.addEventListener('click', () => {
  if (gameStarted && !controls.isLocked && !('ontouchstart' in window) &&
      room && room.state && room.state.status === 'IN_ROUND') {
    controls.lock();
  }
});

function shoot() {
  if (!room || room.state.status !== "IN_ROUND") return;
  if (currentAmmo <= 0) return;

  const weapon = WEAPONS[selectedWeaponKey];
  const now = performance.now() / 1000;
  if (now - lastShotTime < weapon.fireRate) return;

  lastShotTime = now;
  currentAmmo--;
  ammoCountEl.innerText = currentAmmo;
  playGunshot();

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

  let targetId = null;
  for (let sid in remotePlayers) {
    if (raycaster.intersectObject(remotePlayers[sid], true).length > 0) {
      targetId = sid;
      break;
    }
  }

  if (targetId) {
    room.send("shoot", { targetId, damage: weapon.damage });
  }
}

function deployGlooWall() {
  if (!room || room.state.status !== "IN_ROUND" || glooWallsLeft <= 0) return;
  glooWallsLeft--;
  glooEl.innerText = glooWallsLeft;

  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  room.send("deploy_gloo", {
    x: camera.position.x + dir.x * 4,
    y: 2,
    z: camera.position.z + dir.z * 4,
    ry: Math.atan2(dir.x, dir.z)
  });
}

// Game Loop
let prevTime = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const time = performance.now();
  const delta = Math.min((time - prevTime) / 1000, 0.1);
  prevTime = time;

  if (gameStarted && room && room.state && room.state.status === "IN_ROUND") {
    const moveZ = (moveState.forward ? 1 : 0) - (moveState.backward ? 1 : 0);
    const moveX = (moveState.right ? 1 : 0) - (moveState.left ? 1 : 0);

    if (moveZ !== 0 || moveX !== 0) {
      const moveVector = new THREE.Vector3(moveX, 0, -moveZ).normalize();
      moveVector.applyQuaternion(camera.quaternion);
      moveVector.y = 0;
      if (moveVector.lengthSq() > 0) moveVector.normalize();
      camera.position.addScaledVector(moveVector, 12 * delta);
    }

    room.send("move", {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
      ry: camera.rotation.y
    });
  }

  composer.render();
}

animate();
