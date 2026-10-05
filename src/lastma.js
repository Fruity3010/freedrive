import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DYNAMIC_LAYER, isDrivable, roadHeight, roadSlope } from './world.js';

// LASTMA patrol pickups: spawn behind you and chase. Faster than a moped, but they have to steer
// round buildings and traffic, so the side streets are your friend.

const MAX = 2;
const LENGTH = 5;
const RADIUS = 1.4;
const TOP_SPEED = 21; // ~75 km/h
const ACCEL = 9;
const TURN = 2.2; // rad/s
const CATCH = 3.4; // this close and you're caught
const HEADINGS = [0, 0.4, -0.4, 0.8, -0.8, 1.3, -1.3, 1.9, -1.9]; // tried in order when the direct way is blocked

function livery() {
    // Roof sign reading LASTMA, both sides
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const g = canvas.getContext('2d');
    g.fillStyle = '#6d1b1b';
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#fff176';
    g.font = 'bold 44px Arial';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('LASTMA', 128, 34);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map, side: THREE.DoubleSide });
}

export function createLastma(scene) {
    const units = [];
    const lightMaterials = [];
    let t = 0;

    new GLTFLoader().load('models/hilux/hilux.glb', (gltf) => {
        const model = gltf.scene;
        const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
        model.rotation.y = Math.PI + (size.x > size.z ? Math.PI / 2 : 0); // this model's nose points down -z
        model.scale.setScalar(LENGTH / Math.max(size.x, size.z));
        const box = new THREE.Box3().setFromObject(model);
        const centre = box.getCenter(new THREE.Vector3());
        model.position.set(-centre.x, -box.min.y, -centre.z);
        const height = box.max.y - box.min.y;
        model.traverse((o) => {
            if (o.isMesh && o.material.name === 'M_0042_Sienna') o.material = new THREE.MeshStandardMaterial({ color: 0xf2d33a, roughness: 0.5 }); // LASTMA yellow
        });
        const sign = livery();
        for (let i = 0; i < MAX; i++) {
            const root = new THREE.Group();
            root.rotation.order = 'YXZ';
            root.add(model.clone());
            // Amber light bar and LASTMA board on the cab roof
            const light = new THREE.MeshStandardMaterial({ color: 0xffa000, emissive: 0xff8f00, emissiveIntensity: 1 });
            lightMaterials.push(light);
            const bar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.2, 0.35), light);
            bar.position.set(0, height + 0.1, 0.4);
            const board = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.35), sign);
            board.position.set(0, height + 0.42, 0.4);
            board.rotation.y = Math.PI / 2;
            root.add(bar, board);
            root.traverse((o) => o.layers.set(DYNAMIC_LAYER));
            root.visible = false;
            scene.add(root);
            units.push({ root, active: false, x: 0, z: 0, yaw: 0, speed: 0 });
        }
    });

    function spawn(u, player, facing) {
        for (let i = 0; i < 16; i++) {
            const angle = facing + Math.PI + THREE.MathUtils.randFloatSpread(1.6);
            const dist = THREE.MathUtils.randFloat(70, 100);
            const x = player.x + Math.sin(angle) * dist;
            const z = player.z + Math.cos(angle) * dist;
            if (!isDrivable(x, z, RADIUS)) continue;
            Object.assign(u, { active: true, x, z, yaw: Math.atan2(player.x - x, player.z - z), speed: 8 });
            u.root.visible = true;
            return;
        }
    }

    return {
        // wanted: how many pickups should be chasing. blocked(x, z, r): other things in the way (traffic).
        // Returns true if one of them has caught the player.
        update(dt, player, facing, wanted, blocked) {
            t += dt;
            for (const m of lightMaterials) m.emissiveIntensity = Math.sin(t * 12) > 0 ? 2 : 0.2; // flashing
            const live = units.filter((u) => u.active);
            if (wanted > live.length) {
                const free = units.find((u) => !u.active);
                if (free) spawn(free, player, facing);
            }
            let caught = false;
            for (const u of live) {
                if (!wanted) {
                    // Called off: drive away and vanish out of sight
                    u.yaw = Math.atan2(u.x - player.x, u.z - player.z);
                    if (Math.hypot(u.x - player.x, u.z - player.z) > 150) {
                        u.active = false;
                        u.root.visible = false;
                        continue;
                    }
                }
                const dist = Math.hypot(player.x - u.x, player.z - u.z);
                if (wanted && dist < CATCH) caught = true;
                // Steer: straight at the player if clear, otherwise the nearest heading that is
                const want = wanted ? Math.atan2(player.x - u.x, player.z - u.z) : u.yaw;
                const tangled = blocked(u.x, u.z, RADIUS); // already touching traffic: allowed to shove its way out
                const clear = (px, pz) => isDrivable(px, pz, RADIUS) && (tangled || !blocked(px, pz, RADIUS));
                const look = Math.max(4, u.speed * 0.6);
                let heading = null;
                for (const h of HEADINGS) {
                    const a = want + h;
                    const lx = u.x + Math.sin(a) * look;
                    const lz = u.z + Math.cos(a) * look;
                    if (clear(lx, lz)) {
                        heading = a;
                        break;
                    }
                }
                if (heading === null) {
                    u.speed = Math.max(0, u.speed - 20 * dt); // boxed in: brake and wait
                } else {
                    const turn = THREE.MathUtils.euclideanModulo(heading - u.yaw + Math.PI, Math.PI * 2) - Math.PI;
                    u.yaw += THREE.MathUtils.clamp(turn, -TURN * dt, TURN * dt);
                    const target = Math.abs(turn) > 1 ? TOP_SPEED * 0.4 : dist < 15 ? Math.max(6, dist) : TOP_SPEED; // slow for sharp turns and the final grab
                    u.speed += THREE.MathUtils.clamp(target - u.speed, -20 * dt, ACCEL * dt);
                }
                const nx = u.x + Math.sin(u.yaw) * u.speed * dt;
                const nz = u.z + Math.cos(u.yaw) * u.speed * dt;
                if (clear(nx, nz)) [u.x, u.z] = [nx, nz];
                else u.speed *= 0.3;
                u.root.position.set(u.x, roadHeight(u.x), u.z);
                u.root.rotation.y = u.yaw;
                u.root.rotation.x = -Math.atan(roadSlope(u.x) * Math.sin(u.yaw));
            }
            return caught;
        },
        // Pickup a circle at (x, z) touches, if any
        hit(x, z, r) {
            return units.some((u) => u.active && Math.hypot(u.x - x, u.z - z) < r + RADIUS);
        },
        clear() {
            for (const u of units) {
                u.active = false;
                u.root.visible = false;
            }
        },
    };
}
