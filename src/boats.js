import * as THREE from 'three';
import { MAINLAND, ISLAND } from './world.js';

// Scenery on the lagoon: dugout canoes with a paddling fisherman near the Mainland (Makoko side),
// white yachts out towards the Island. They circle slowly and bob on the swell.

const WATER_Y = -1.5;
const CANOES = 14;
const YACHTS = 5;
const SHIRTS = [0xc62828, 0x1565c0, 0xf9a825, 0x2e7d32, 0xffffff, 0x6a1b9a];
const rand = THREE.MathUtils.randFloat;

// Somewhere on open water: between the shores, clear of the bridge and its pillars
function waterSpot(x0, x1) {
    return { x: rand(x0, x1), z: (Math.random() < 0.5 ? -1 : 1) * rand(45, 380) };
}

function makeYacht() {
    const yacht = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.4 });
    // Hull: pointed-bow outline, extruded upwards
    const outline = new THREE.Shape();
    outline.moveTo(-1.8, -6);
    outline.lineTo(1.8, -6);
    outline.lineTo(2, 2);
    outline.quadraticCurveTo(1.6, 5, 0, 6.5);
    outline.quadraticCurveTo(-1.6, 5, -2, 2);
    outline.lineTo(-1.8, -6);
    const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(outline, { depth: 1.6, bevelEnabled: false }), white);
    hull.rotation.x = Math.PI / 2; // shape lies flat, bow towards +z; extrusion goes downwards
    hull.position.y = 1.0; // deck height
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(4.05, 0.25, 9), new THREE.MeshStandardMaterial({ color: 0x1a237e }));
    stripe.position.set(0, 0.5, -1.5);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.3, 4), white);
    cabin.position.set(0, 1.6, -1.2);
    const windows = new THREE.Mesh(new THREE.BoxGeometry(2.65, 0.45, 3.2), new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.1, metalness: 0.6 }));
    windows.position.set(0, 1.8, -1.2);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 11, 6), white);
    mast.position.set(0, 6.5, 1);
    const sailShape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0, 9.5), new THREE.Vector2(-4.5, 0)]);
    const sail = new THREE.Mesh(new THREE.ShapeGeometry(sailShape), new THREE.MeshStandardMaterial({ color: 0xfafafa, side: THREE.DoubleSide, roughness: 0.9 }));
    sail.rotation.y = Math.PI / 2;
    sail.position.set(0, 1.6, 1.1);
    yacht.add(hull, stripe, cabin, windows, mast, sail);
    return yacht;
}

export function createBoats(scene) {
    // Canoes: every part is one instanced batch for all of them
    const hullGeo = new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(0.55, 0.4, 3.2); // lower half of a long ellipsoid
    const parts = {
        hull: new THREE.InstancedMesh(hullGeo, new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.9, side: THREE.DoubleSide }), CANOES),
        body: new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.2, 0.45, 3, 8), new THREE.MeshStandardMaterial(), CANOES),
        head: new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshStandardMaterial({ color: 0x4a2c1d }), CANOES),
        paddle: new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 1.8, 0.05).translate(0, -0.6, 0), new THREE.MeshStandardMaterial({ color: 0x8d6e43 }), CANOES),
        blade: new THREE.InstancedMesh(new THREE.BoxGeometry(0.03, 0.45, 0.2).translate(0, -1.35, 0), new THREE.MeshStandardMaterial({ color: 0x8d6e43 }), CANOES),
    };
    for (const mesh of Object.values(parts)) {
        mesh.frustumCulled = false; // spread across the lagoon
        scene.add(mesh);
    }

    const boats = [];
    for (let i = 0; i < CANOES; i++) {
        const c = waterSpot(MAINLAND.x1 + 10, MAINLAND.x1 + 220); // Mainland side, Makoko way
        boats.push({ canoe: i, ...c, r: rand(15, 40), speed: rand(0.6, 1.2), angle: rand(0, 6.3), phase: rand(0, 6.3), dir: Math.random() < 0.5 ? 1 : -1 });
        parts.body.setColorAt(i, new THREE.Color(SHIRTS[i % SHIRTS.length]));
    }
    for (let i = 0; i < YACHTS; i++) {
        const c = waterSpot(MAINLAND.x1 + 260, ISLAND.x0 - 40); // out towards the Island
        const object = makeYacht();
        scene.add(object);
        boats.push({ object, ...c, r: rand(40, 90), speed: rand(1.5, 2.5), angle: rand(0, 6.3), phase: rand(0, 6.3), dir: Math.random() < 0.5 ? 1 : -1 });
    }

    const boat = new THREE.Object3D();
    const local = new THREE.Object3D();
    const m = new THREE.Matrix4();
    let t = 0;

    return {
        update(dt) {
            t += dt;
            for (const b of boats) {
                // Circle slowly around an anchor point, bow first, bobbing and rolling on the swell
                b.angle += (b.dir * b.speed * dt) / b.r;
                const x = b.x + Math.cos(b.angle) * b.r;
                const z = b.z + Math.sin(b.angle) * b.r;
                const yaw = Math.atan2(-Math.sin(b.angle) * b.dir, Math.cos(b.angle) * b.dir);
                const target = b.object ?? boat;
                target.position.set(x, WATER_Y + Math.sin(t * 1.3 + b.phase) * 0.08 + (b.object ? 0.2 : 0.05), z);
                target.rotation.set(Math.sin(t * 0.9 + b.phase) * 0.03, yaw, Math.sin(t * 1.1 + b.phase) * 0.05);
                if (b.object) continue;
                boat.updateMatrix();
                const put = (mesh, px, py, pz, rx = 0) => {
                    local.position.set(px, py, pz);
                    local.rotation.set(rx, 0, 0);
                    local.updateMatrix();
                    mesh.setMatrixAt(b.canoe, m.multiplyMatrices(boat.matrix, local.matrix));
                };
                put(parts.hull, 0, 0.3, 0);
                put(parts.body, 0, 0.75, -0.4);
                put(parts.head, 0, 1.2, -0.4);
                const stroke = Math.sin(t * 2.2 + b.phase) * 0.7; // paddling
                put(parts.paddle, 0.35, 1.0, -0.2, stroke);
                put(parts.blade, 0.35, 1.0, -0.2, stroke);
            }
            for (const mesh of Object.values(parts)) mesh.instanceMatrix.needsUpdate = true;
        },
    };
}
