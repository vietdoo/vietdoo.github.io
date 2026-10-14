import { createSignal, onMount, onCleanup, For, Show } from "solid-js";
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

// Helper to create canvas texture for a dice face - realistic glossy plastic dice look
type PipPalette = { light: string; base: string; dark: string };

function createDiceFaceTexture(
  number: number,
  pipColor: PipPalette,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;

  // Ivory-white plastic base with a very subtle radial sheen
  const bg = ctx.createRadialGradient(96, 90, 20, 128, 128, 190);
  bg.addColorStop(0, "#ffffff");
  bg.addColorStop(1, "#e9e8e4");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 256);

  // Pips drawing - drilled-in dot with soft inner shadow + glossy highlight
  const drawPip = (x: number, y: number) => {
    const r = 24;

    // Recessed shadow ring around the pip (simulates a drilled hole)
    const ringGrad = ctx.createRadialGradient(x, y, r * 0.7, x, y, r * 1.25);
    ringGrad.addColorStop(0, "rgba(0,0,0,0.25)");
    ringGrad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.arc(x, y, r * 1.25, 0, Math.PI * 2);
    ctx.fillStyle = ringGrad;
    ctx.fill();

    // Main pip body with subtle top-lit shading
    const pipGrad = ctx.createRadialGradient(
      x - r * 0.3,
      y - r * 0.3,
      1,
      x,
      y,
      r,
    );
    pipGrad.addColorStop(0, pipColor.light);
    pipGrad.addColorStop(0.6, pipColor.base);
    pipGrad.addColorStop(1, pipColor.dark);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = pipGrad;
    ctx.fill();

    // Small glossy highlight
    ctx.beginPath();
    ctx.arc(x - r * 0.32, y - r * 0.32, r * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fill();
  };

  const center = 128;
  const left = 68;
  const right = 188;
  const top = 68;
  const bottom = 188;

  switch (number) {
    case 1:
      drawPip(center, center);
      break;
    case 2:
      drawPip(left, top);
      drawPip(right, bottom);
      break;
    case 3:
      drawPip(left, top);
      drawPip(center, center);
      drawPip(right, bottom);
      break;
    case 4:
      drawPip(left, top);
      drawPip(right, top);
      drawPip(left, bottom);
      drawPip(right, bottom);
      break;
    case 5:
      drawPip(left, top);
      drawPip(right, top);
      drawPip(center, center);
      drawPip(left, bottom);
      drawPip(right, bottom);
      break;
    case 6:
      drawPip(left, top);
      drawPip(right, top);
      drawPip(left, center);
      drawPip(right, center);
      drawPip(left, bottom);
      drawPip(right, bottom);
      break;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Pip color palettes used across the dice set (classic black-pip & red-pip dice)
const PIP_BLACK = { light: "#3a3a3a", base: "#161616", dark: "#000000" };
const PIP_RED = { light: "#e05a4e", base: "#c0392b", dark: "#7a1f16" };

// Local face normals mapped to dice values
// BoxGeometry materials order: [+X (0), -X (1), +Y (2), -Y (3), +Z (4), -Z (5)]
const FACE_DEFINITIONS = [
  { faceVal: 1, normal: new THREE.Vector3(1, 0, 0) },
  { faceVal: 2, normal: new THREE.Vector3(-1, 0, 0) },
  { faceVal: 3, normal: new THREE.Vector3(0, 1, 0) },
  { faceVal: 4, normal: new THREE.Vector3(0, -1, 0) },
  { faceVal: 5, normal: new THREE.Vector3(0, 0, 1) },
  { faceVal: 6, normal: new THREE.Vector3(0, 0, -1) },
];

export default function DiceRollerPlayground() {
  let containerRef!: HTMLDivElement;

  const [isRolling, setIsRolling] = createSignal(false);
  const [totalSum, setTotalSum] = createSignal<number>(10);
  const [history, setHistory] = createSignal<
    { values: number[]; total: number }[]
  >([]);

  // Simulation variables
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  let renderer: THREE.WebGLRenderer;
  let world: CANNON.World;
  let animId: number;

  const diceMeshes: THREE.Mesh[] = [];
  const diceBodies: CANNON.Body[] = [];

  const initSimulation = () => {
    if (!containerRef) return;
    const width = containerRef.clientWidth;
    const height = containerRef.clientHeight;

    // Three.js Scene - neutral grey studio backdrop for a realistic photo look
    scene = new THREE.Scene();
    scene.background = new THREE.Color("#8f8f8f");

    // Camera - pulled back further and adapted per aspect so the wider free-roam arena stays visible
    camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
    updateCameraForAspect(width / height);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    containerRef.appendChild(renderer.domElement);

    // Soft studio environment map for realistic glossy plastic reflections
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04,
    ).texture;
    pmremGenerator.dispose();

    // Lighting - soft studio setup similar to a product photo
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(6, 14, 8);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 30;
    keyLight.shadow.camera.left = -8;
    keyLight.shadow.camera.right = 8;
    keyLight.shadow.camera.top = 8;
    keyLight.shadow.camera.bottom = -8;
    keyLight.shadow.radius = 4;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
    fillLight.position.set(-8, 6, -6);
    scene.add(fillLight);

    // Ground Plane Mesh - large neutral grey studio backdrop, big enough for a free, unwalled roll
    const floorGeo = new THREE.PlaneGeometry(80, 80);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x9a9a9a,
      roughness: 0.9,
      metalness: 0,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    // Cannon-es Physics World
    world = new CANNON.World();
    world.gravity.set(0, -28, 0);

    const physicsMat = new CANNON.Material("diceMat");
    const contactMat = new CANNON.ContactMaterial(physicsMat, physicsMat, {
      friction: 0.35,
      restitution: 0.45,
    });
    world.addContactMaterial(contactMat);

    // Physics Ground - no side walls, dice are free to roam the whole floor
    const groundBody = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Plane(),
      material: physicsMat,
    });
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(groundBody);

    // Dice geometry - rounded corners like real injection-molded dice, sized up for a bolder look
    const diceSize = 1.9;
    const halfSize = diceSize / 2;
    const diceGeo = new RoundedBoxGeometry(
      diceSize,
      diceSize,
      diceSize,
      6,
      diceSize * 0.12,
    );
    const diceShape = new CANNON.Box(
      new CANNON.Vec3(halfSize, halfSize, halfSize),
    );

    // One die uses red pips, the others classic black - matching a real dice set
    const dicePipColors = [PIP_BLACK, PIP_BLACK, PIP_RED];

    const initialPositions = [
      { x: -3.2, y: 1.5, z: 0 },
      { x: 0, y: 1.5, z: 0 },
      { x: 3.2, y: 1.5, z: 0 },
    ];

    for (let i = 0; i < 3; i++) {
      const materials = FACE_DEFINITIONS.map((def) => {
        const tex = createDiceFaceTexture(def.faceVal, dicePipColors[i]);
        return new THREE.MeshPhysicalMaterial({
          map: tex,
          roughness: 0.25,
          metalness: 0,
          clearcoat: 1,
          clearcoatRoughness: 0.15,
        });
      });

      const mesh = new THREE.Mesh(diceGeo, materials);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      diceMeshes.push(mesh);

      const body = new CANNON.Body({
        mass: 1.2,
        shape: diceShape,
        material: physicsMat,
        linearDamping: 0.35,
        angularDamping: 0.35,
        position: new CANNON.Vec3(
          initialPositions[i].x,
          initialPositions[i].y,
          initialPositions[i].z,
        ),
      });
      world.addBody(body);
      diceBodies.push(body);
    }

    // Animation Render Loop
    let settleCounter = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);

      world.step(1 / 60);

      // Sync Three.js Meshes with Cannon Bodies
      for (let i = 0; i < 3; i++) {
        diceMeshes[i].position.copy(
          diceBodies[i].position as unknown as THREE.Vector3,
        );
        diceMeshes[i].quaternion.copy(
          diceBodies[i].quaternion as unknown as THREE.Quaternion,
        );
      }

      renderer.render(scene, camera);

      // Check if rolling settles
      if (isRolling()) {
        let allStopped = true;
        for (let i = 0; i < 3; i++) {
          const v = diceBodies[i].velocity.length();
          const w = diceBodies[i].angularVelocity.length();
          if (v > 0.08 || w > 0.08) {
            allStopped = false;
            break;
          }
        }

        if (allStopped) {
          settleCounter++;
          if (settleCounter > 15) {
            // Settle verified
            finishRoll();
            settleCounter = 0;
          }
        } else {
          settleCounter = 0;
        }
      }
    };

    animate();

    // Resize Handler - re-adapts the camera distance for the new aspect (e.g. phone rotation)
    const handleResize = () => {
      if (!containerRef) return;
      const w = containerRef.clientWidth;
      const h = containerRef.clientHeight;
      camera.aspect = w / h;
      updateCameraForAspect(w / h);
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);
  };

  // Keeps the whole free-roam floor comfortably in frame on both wide desktop and narrow mobile views
  const updateCameraForAspect = (aspect: number) => {
    if (!camera) return;
    const distance = aspect < 0.8 ? 24 : aspect < 1.2 ? 19 : 16;
    camera.position.set(0, distance * 0.82, distance * 0.68);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  };

  const finishRoll = () => {
    const upVector = new THREE.Vector3(0, 1, 0);
    const results: number[] = [];

    for (let i = 0; i < 3; i++) {
      const mesh = diceMeshes[i];
      let maxDot = -Infinity;
      let topVal = 1;

      for (const def of FACE_DEFINITIONS) {
        const worldNormal = def.normal.clone().applyQuaternion(mesh.quaternion);
        const dot = worldNormal.dot(upVector);
        if (dot > maxDot) {
          maxDot = dot;
          topVal = def.faceVal;
        }
      }
      results.push(topVal);
    }

    const sum = results.reduce((a, b) => a + b, 0);
    setTotalSum(sum);
    setHistory((prev) => [
      { values: results, total: sum },
      ...prev.slice(0, 4),
    ]);
    setIsRolling(false);
  };

  const rollDice = () => {
    if (isRolling()) return;
    setIsRolling(true);

    const startX = [-3.2, 0, 3.2];

    for (let i = 0; i < 3; i++) {
      const body = diceBodies[i];

      // Lift dice into air, spread wide across the free-roam floor
      body.position.set(
        startX[i] + (Math.random() - 0.5) * 1.4,
        6 + Math.random() * 1.5,
        (Math.random() - 0.5) * 2,
      );
      body.quaternion.setFromEuler(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
      );

      // Apply downward & sideways impulse - energetic, tumbling toss
      body.velocity.set(
        (Math.random() - 0.5) * 12,
        -10 - Math.random() * 6,
        (Math.random() - 0.5) * 12,
      );

      // Apply strong random angular rotation torque
      body.angularVelocity.set(
        (Math.random() - 0.5) * 35,
        (Math.random() - 0.5) * 35,
        (Math.random() - 0.5) * 35,
      );
    }
  };

  onMount(() => {
    initSimulation();

    onCleanup(() => {
      if (animId) cancelAnimationFrame(animId);
      if (renderer) {
        renderer.dispose();
        renderer.domElement.remove();
      }
    });
  });

  return (
    <div class="w-full max-w-5xl mx-auto flex flex-col gap-6 text-darkslate-100 p-2 md:p-4 font-sans select-none">
      {/* Title & Actions */}
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Dice roller
          </h1>
          <p class="text-xs sm:text-sm text-darkslate-300 mt-1">
            Real 3D dice simulation with Three.js WebGL & Cannon.es physics
            engine.
          </p>
        </div>

        <button
          onClick={rollDice}
          disabled={isRolling()}
          type="button"
          class="px-4 py-2 sm:px-5 sm:py-2.5 rounded-lg bg-primary-600 hover:bg-primary-500 text-white font-semibold text-xs sm:text-sm transition shadow-lg disabled:opacity-50 self-start sm:self-auto cursor-pointer touch-manipulation"
        >
          {isRolling() ? "Rolling..." : "Roll dice"}
        </button>
      </div>

      {/* 3D WebGL Canvas Arena */}
      <div class="relative bg-darkslate-800/90 border border-darkslate-500 rounded-2xl sm:rounded-3xl overflow-hidden shadow-2xl">
        <div
          ref={containerRef}
          onClick={rollDice}
          class="w-full h-[340px] sm:h-[440px] md:h-[560px] cursor-pointer touch-manipulation"
        />

        {/* Total Score Overlay Badge */}
        <div class="absolute bottom-3 sm:bottom-4 md:bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2.5 sm:gap-3 bg-darkslate-900/80 border border-darkslate-500/80 rounded-xl sm:rounded-2xl px-4 py-2 sm:px-6 sm:py-3 md:px-8 md:py-4 shadow-xl backdrop-blur-md">
          <span class="dice-total-label text-[11px] sm:text-xs md:text-sm text-darkslate-300 font-medium uppercase tracking-wider">
            Total Sum
          </span>
          <span class="text-3xl sm:text-4xl md:text-5xl font-extrabold text-primary-400 font-mono tabular-nums">
            {totalSum()}
          </span>
        </div>
      </div>

      {/* Roll History */}
      <Show when={history().length > 0}>
        <div class="flex flex-col gap-2 bg-darkslate-600/30 border border-darkslate-500 rounded-xl p-4 text-sm">
          <span class="font-medium text-darkslate-300">Roll History</span>
          <div class="flex flex-wrap gap-2">
            <For each={history()}>
              {(item) => (
                <div class="px-3 py-2 rounded-lg bg-darkslate-700/60 border border-darkslate-500 flex items-center gap-2">
                  <span class="text-darkslate-300 font-mono">
                    [{item.values.join(", ")}]
                  </span>
                  <span class="text-primary-300 font-bold font-mono">
                    = {item.total}
                  </span>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}
