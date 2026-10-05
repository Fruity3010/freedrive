import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DYNAMIC_LAYER, isDrivable, groundHeight } from './world.js';
import { loadProp } from './props.js';

// Free-range chickens and goats: pecking round the markets and picking through the rubbish dumps.
// Built from a few primitives and drawn instanced (one batch per material), animated by moving the
// whole body: chickens bob, peck and scatter flapping when you ride at them; goats amble and graze.

const SHOW_WITHIN = 100;
const SCARE = 6; // metres: closer than this and they run
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const part = (geometry, x, y, z, rx = 0) => geometry.rotateX(rx).translate(x, y, z);

// Chicken, facing +z, standing on y = 0. Parts by material: feathers (tinted per bird), red, yellow
function chickenParts() {
    const feathers = [
        part(new THREE.SphereGeometry(0.15, 8, 6).scale(0.8, 0.75, 1), 0, 0.27, 0), // body
        part(new THREE.SphereGeometry(0.065, 8, 6), 0, 0.42, 0.13), // head
        part(new THREE.BoxGeometry(0.03, 0.16, 0.12), 0, 0.36, -0.14, -0.5), // tail
        part(new THREE.SphereGeometry(0.1, 6, 4).scale(0.25, 0.6, 1), 0.11, 0.28, 0), // wings
        part(new THREE.SphereGeometry(0.1, 6, 4).scale(0.25, 0.6, 1), -0.11, 0.28, 0),
    ];
    const red = [
        part(new THREE.BoxGeometry(0.02, 0.05, 0.08), 0, 0.49, 0.13), // comb
        part(new THREE.BoxGeometry(0.02, 0.04, 0.02), 0, 0.37, 0.18), // wattle
    ];
    const yellow = [
        part(new THREE.ConeGeometry(0.02, 0.06, 4), 0, 0.42, 0.2, Math.PI / 2), // beak
        part(new THREE.CylinderGeometry(0.01, 0.01, 0.16, 4), 0.04, 0.08, 0), // legs
        part(new THREE.CylinderGeometry(0.01, 0.01, 0.16, 4), -0.04, 0.08, 0),
    ];
    return [
        { geometry: mergeGeometries(feathers), color: 0xffffff, tint: true },
        { geometry: mergeGeometries(red), color: 0xc62828 },
        { geometry: mergeGeometries(yellow), color: 0xf9a825 },
    ];
}

// Goat: the downloaded Boer goat (static mesh, so it's moved whole like the chickens)
const goatParts = () => loadProp('models/props/goat.glb', 1.15).then((parts) => {
    for (const { material } of parts) {
        material.emissiveMap = null; // the export sets full-strength emissive, which makes it glow
        material.emissive.set(0);
    }
    return parts;
});

const SPECIES = {
    chicken: { parts: chickenParts, colors: [0xf5f5f0, 0x8d5524, 0xb5651d, 0x222222, 0xd7a86e], walk: 0.6, run: 4, roam: 10 },
    goat: { parts: goatParts, colors: [0xf2efe6, 0x6d4c33, 0x2b2420, 0xa47551, 0xd9cbb3], walk: 0.5, run: 3, roam: 14 },
};

// homes: [{ x, z, chickens, goats }]
export function createAnimals(scene, homes) {
    const herds = {};
    for (const [name, sp] of Object.entries(SPECIES)) {
        const list = [];
        for (const h of homes) {
            for (let i = 0; i < h[name === 'chicken' ? 'chickens' : 'goats']; i++) {
                const x = h.x + THREE.MathUtils.randFloatSpread(sp.roam);
                const z = h.z + THREE.MathUtils.randFloatSpread(sp.roam);
                if (!isDrivable(x, z, 0.3)) continue;
                list.push({ home: h, x, z, yaw: Math.random() * 6.3, tx: x, tz: z, wait: Math.random() * 3, t: Math.random() * 10, color: new THREE.Color(pick(sp.colors)) });
            }
        }
        const herd = { sp, list, meshes: [] }; // meshes arrive once the parts are built (or downloaded)
        herds[name] = herd;
        Promise.resolve(sp.parts()).then((parts) => {
            herd.meshes = parts.map(({ geometry, material, color, tint }) => {
                const mesh = new THREE.InstancedMesh(geometry, material ?? new THREE.MeshStandardMaterial({ color, roughness: 0.9 }), Math.max(1, list.length));
                mesh.layers.set(DYNAMIC_LAYER);
                mesh.frustumCulled = false; // we cull by distance ourselves
                mesh.count = 0;
                mesh.tint = tint;
                scene.add(mesh);
                return mesh;
            });
        });
    }

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler(0, 0, 0, 'YXZ');
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);

    return {
        update(dt, player, playerSpeed) {
            for (const [name, { sp, list, meshes }] of Object.entries(herds)) {
                if (!meshes.length) continue; // still loading
                let n = 0;
                for (const a of list) {
                    const px = a.x - player.x;
                    const pz = a.z - player.z;
                    const d = Math.hypot(px, pz);
                    if (d > SHOW_WITHIN) continue;
                    a.t += dt;
                    let speed = 0;
                    if (d < SCARE && Math.abs(playerSpeed) > 1) {
                        // Bike coming: run straight away from it
                        a.tx = a.x + (px / d) * 4;
                        a.tz = a.z + (pz / d) * 4;
                        a.wait = 0;
                        a.scared = 1;
                    }
                    if ((a.scared -= dt) > 0) speed = sp.run;
                    else if (a.wait > 0) a.wait -= dt;
                    else speed = sp.walk;
                    const dx = a.tx - a.x;
                    const dz = a.tz - a.z;
                    const togo = Math.hypot(dx, dz);
                    if (speed && togo > 0.2) {
                        a.yaw = Math.atan2(dx, dz);
                        const step = Math.min(togo, speed * dt);
                        const nx = a.x + (dx / togo) * step;
                        const nz = a.z + (dz / togo) * step;
                        if (isDrivable(nx, nz, 0.2)) [a.x, a.z] = [nx, nz];
                        else a.wait = 0.5, a.tx = a.x, a.tz = a.z; // walked into a stall or wall: stop and rethink
                    } else if (a.wait <= 0) {
                        // Arrived: pause (peck / graze), then pick somewhere new near home
                        a.wait = THREE.MathUtils.randFloat(1, 5);
                        a.tx = a.home.x + THREE.MathUtils.randFloatSpread(sp.roam);
                        a.tz = a.home.z + THREE.MathUtils.randFloatSpread(sp.roam);
                        speed = 0;
                    }
                    const moving = speed > 0 && togo > 0.2;
                    let y = groundHeight(a.x, a.z);
                    let pitch = 0;
                    let roll = 0;
                    if (name === 'chicken') {
                        if (a.scared > 0) y += Math.abs(Math.sin(a.t * 18)) * 0.12; // flapping hops
                        else if (moving) y += Math.abs(Math.sin(a.t * 12)) * 0.025;
                        else pitch = Math.max(0, Math.sin(a.t * 5)) ** 4 * 0.7; // peck, peck
                    } else {
                        if (moving) roll = Math.sin(a.t * 6) * 0.04; // amble
                        else pitch = 0.25 + Math.sin(a.t * 0.8) * 0.05; // head down, grazing
                    }
                    e.set(pitch, a.yaw, roll);
                    m.compose(pos.set(a.x, y, a.z), q.setFromEuler(e), one);
                    for (const mesh of meshes) {
                        mesh.setMatrixAt(n, m);
                        if (mesh.tint) mesh.setColorAt(n, a.color);
                    }
                    n++;
                }
                for (const mesh of meshes) {
                    mesh.count = n;
                    mesh.instanceMatrix.needsUpdate = true;
                    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
                }
            }
        },
    };
}
