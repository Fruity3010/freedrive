import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { DYNAMIC_LAYER, isDrivable, roadHeight } from './world.js';

// Egbon Adugbo's mob: a mix of area boys (our own characters, fists up) and zombies. They spawn out of
// sight, rally (scream / wave), run you down and beat on the bike.
// States: scream -> run -> attack, knocked 'down' when rammed, 'leave' when the mob calms down.

const ZOMBIES = 6;
const AREA_BOYS = 8;
const AREA_BOY_SHARE = 0.65; // how much of the mob is area boys rather than zombies
// Touts (agberos): gritty tops, dark trousers, a face cap or bandana, and something to swing
const TOUT_TOPS = [0x111111, 0xe8e4da, 0x6d1b1b, 0x1b4d2e, 0x3e2723, 0x37474f];
const TOUT_TROUSERS = [0x1c2331, 0x263238, 0x5d4a2e, 0x111111];
const CAPS = [0xb71c1c, 0x111111, 0xf9a825, 0x1b5e20, 0x0d47a1];
const SKINS = [0x4a2c1d, 0x5a3a28, 0x6b4430];
const wood = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
const WEAPONS = [
    () => new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 1.0, 6), wood(0x7a5a36)), // long stick
    () => new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.025, 0.75, 8), wood(0x4e342e)), // club, fat end up
    () => new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.03), wood(0xa1887f)), // plank
];

// Attach a prop to a bone so it moves with the animation. Given in the character's bind pose, in world terms:
// where it should sit and which way its long (y) axis should point.
function attachToBone(bone, mesh, worldPos, worldDir) {
    bone.updateWorldMatrix(true, false);
    const boneQuat = bone.getWorldQuaternion(new THREE.Quaternion());
    const want = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), worldDir.clone().normalize());
    bone.add(mesh);
    mesh.position.copy(bone.worldToLocal(worldPos.clone()));
    mesh.quaternion.copy(boneQuat.invert().multiply(want));
    mesh.scale.setScalar(1 / bone.getWorldScale(new THREE.Vector3()).x);
}
const HEIGHT = 1.8;
const RADIUS = 0.45;
const ATTACK_RANGE = 1.9;
const ATTACK_EVERY = 0.9; // seconds between blows
const SCREAM_TIME = 1.2;
const DOWN_TIME = 2.5;
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export function createZombies(scene) {
    const pool = [];

    // roles -> clip names for each kind of mob member
    const KINDS = {
        zombie: { file: 'models/zombie_number_10_animated_gltf/Untitled.glb', count: ZOMBIES, speed: [13, 17], hit: 7, runPace: 6,
            roles: { run: 'Run', attack: 'Attack', rally: 'Scream', down: 'Death', walk: 'Walk' } },
        areaBoy: { file: 'models/people/casual.glb', count: AREA_BOYS, speed: [11, 14], hit: 5, runPace: 4,
            roles: { run: 'Run', attack: 'Punch_Right', rally: 'Wave', down: 'Death', walk: 'Walk' }, shirt: 'LightBrown', trousers: 'LightBlue' },
    };
    const loader = new GLTFLoader();
    for (const [kind, k] of Object.entries(KINDS)) {
        loader.load(k.file, (gltf) => {
            const size = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
            gltf.scene.scale.setScalar(HEIGHT / size.y);
            const clips = Object.fromEntries(Object.entries(k.roles).map(([role, name]) => [role, gltf.animations.find((a) => a.name.split('|').pop() === name)]));
            for (let i = 0; i < k.count; i++) {
                const body = cloneSkinned(gltf.scene);
                if (kind === 'areaBoy') {
                    // Each tout their own skin, top and trousers
                    const skin = pick(SKINS);
                    const top = pick(TOUT_TOPS);
                    const trousers = pick(TOUT_TROUSERS);
                    const copies = new Map();
                    body.traverse((o) => {
                        if (!o.isMesh) return;
                        if (!copies.has(o.material)) copies.set(o.material, o.material.clone());
                        o.material = copies.get(o.material);
                        if (o.material.name.startsWith('Skin')) o.material.color.set(skin);
                        else if (o.material.name.startsWith('Hair') || o.material.name === 'Eyebrows') o.material.color.set(0x151210);
                        else if (o.material.name === k.shirt) o.material.color.set(top);
                        else if (o.material.name === k.trousers) o.material.color.set(trousers);
                    });
                    body.updateMatrixWorld(true);
                    // Face cap or bandana on most of them
                    const head = body.getObjectByName('Head');
                    const headAt = head.getWorldPosition(new THREE.Vector3());
                    if (Math.random() < 0.75) {
                        const capMat = new THREE.MeshStandardMaterial({ color: pick(CAPS), roughness: 0.8 });
                        const cap = new THREE.Group();
                        if (Math.random() < 0.6) {
                            cap.add(new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), capMat));
                            const brim = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.012, 0.12), capMat);
                            brim.position.set(0, 0.005, 0.12); // peak to the front
                            cap.add(brim);
                        } else {
                            cap.add(new THREE.Mesh(new THREE.CylinderGeometry(0.112, 0.112, 0.07, 12, 1, true), capMat)); // bandana band
                        }
                        attachToBone(head, cap, headAt.clone().add(new THREE.Vector3(0, 0.12, 0)), new THREE.Vector3(0, 1, 0));
                    }
                    // Stick, club or plank in the right hand, held pointing forward and up
                    const hand = body.getObjectByName('WristR');
                    const handAt = hand.getWorldPosition(new THREE.Vector3());
                    const dir = new THREE.Vector3(0, 0.55, 1).normalize();
                    attachToBone(hand, pick(WEAPONS)(), handAt.clone().add(dir.clone().multiplyScalar(0.3)), dir);
                }
                body.traverse((o) => o.layers.set(DYNAMIC_LAYER));
                const root = new THREE.Group(); // unscaled wrapper we move and turn
                root.add(body);
                root.visible = false;
                scene.add(root);
                pool.push({ kind, k, root, mixer: new THREE.AnimationMixer(body), clips, active: false, state: '', anim: '' });
            }
        });
    }

    function play(z, name, once = false) {
        if (z.anim === name) return;
        z.anim = name;
        z.mixer.stopAllAction();
        const action = z.mixer.clipAction(z.clips[name]).reset(); // name is a role: run, attack, rally, down, walk
        if (once) {
            action.setLoop(THREE.LoopOnce, 1);
            action.clampWhenFinished = true;
        }
        if (name === 'run') action.timeScale = z.speed / z.k.runPace; // legs keep up with the ground
        action.play();
    }

    // Somewhere walkable behind the player, out of view
    function spawn(z, player, facing) {
        for (let i = 0; i < 12; i++) {
            const angle = facing + Math.PI + THREE.MathUtils.randFloatSpread(Math.PI * 0.8);
            const dist = THREE.MathUtils.randFloat(35, 55);
            const x = player.x + Math.sin(angle) * dist;
            const zz = player.z + Math.cos(angle) * dist;
            if (!isDrivable(x, zz, RADIUS)) continue;
            Object.assign(z, { active: true, x, z: zz, state: 'scream', timer: SCREAM_TIME, speed: THREE.MathUtils.randFloat(...z.k.speed), cooldown: 0, anim: '' });
            z.root.visible = true;
            play(z, 'rally', z.kind === 'zombie');
            return;
        }
    }

    // Step toward a target, sliding along walls instead of walking through buildings
    function stepToward(z, tx, tz, step) {
        const dx = tx - z.x;
        const dz = tz - z.z;
        const d = Math.hypot(dx, dz) || 1;
        const nx = z.x + (dx / d) * step;
        const nz = z.z + (dz / d) * step;
        if (isDrivable(nx, nz, RADIUS)) [z.x, z.z] = [nx, nz];
        else if (isDrivable(nx, z.z, RADIUS)) z.x = nx;
        else if (isDrivable(z.x, nz, RADIUS)) z.z = nz;
        z.yaw = Math.atan2(dx, dz);
    }

    return {
        // wanted: how many should be hunting (0 = mob has calmed down). Returns bike damage dealt this frame.
        update(dt, player, facing, wanted) {
            let damage = 0;
            const live = pool.filter((z) => z.active);
            if (wanted > live.length) {
                // Mostly area boys, some zombies; take whichever kind still has someone free
                const want = Math.random() < AREA_BOY_SHARE ? 'areaBoy' : 'zombie';
                const free = pool.find((z) => !z.active && z.kind === want) ?? pool.find((z) => !z.active);
                if (free) spawn(free, player, facing);
            }
            for (const z of live) {
                const dist = Math.hypot(player.x - z.x, player.z - z.z);
                if (!wanted && z.state !== 'leave') {
                    z.state = 'leave';
                    play(z, 'walk');
                }
                if (z.state === 'scream' && (z.timer -= dt) <= 0) z.state = 'run';
                else if (z.state === 'down' && (z.timer -= dt) <= 0) z.state = 'run';
                else if (z.state === 'run') {
                    play(z, 'run');
                    if (dist < ATTACK_RANGE) z.state = 'attack';
                    else stepToward(z, player.x, player.z, z.speed * dt);
                } else if (z.state === 'attack') {
                    play(z, 'attack');
                    z.yaw = Math.atan2(player.x - z.x, player.z - z.z);
                    if (dist > ATTACK_RANGE + 0.6) z.state = 'run'; // you got away
                    else if ((z.cooldown -= dt) <= 0) {
                        z.cooldown = ATTACK_EVERY;
                        damage += z.k.hit;
                    }
                } else if (z.state === 'leave') {
                    stepToward(z, 2 * z.x - player.x, 2 * z.z - player.z, 2 * dt); // wander off
                    if (dist > 70) {
                        z.active = false;
                        z.root.visible = false;
                    }
                }
                // Keep the pack from merging into one body
                for (const o of live) {
                    if (o === z) continue;
                    const sx = z.x - o.x;
                    const sz = z.z - o.z;
                    const d = Math.hypot(sx, sz);
                    if (d > 0 && d < 1) {
                        z.x += (sx / d) * (1 - d) * 0.5;
                        z.z += (sz / d) * (1 - d) * 0.5;
                    }
                }
                z.root.position.set(z.x, roadHeight(z.x) + 0.2, z.z);
                z.root.rotation.y = z.yaw;
                z.mixer.update(dt);
            }
            return damage;
        },
        // Zombie a circle at (x, z) touches, if any (not ones already down)
        hit(x, z, r) {
            return pool.find((o) => o.active && o.state !== 'down' && Math.hypot(o.x - x, o.z - z) < r + RADIUS);
        },
        // Rammed: thrown back, down for a moment, then straight back up and after you
        knock(z, dirX, dirZ) {
            z.state = 'down';
            z.timer = DOWN_TIME;
            z.x += dirX * 1.5;
            z.z += dirZ * 1.5;
            play(z, 'down', true);
        },
        clear() {
            for (const z of pool) {
                z.active = false;
                z.root.visible = false;
            }
        },
        count: () => pool.filter((z) => z.active && z.state !== 'leave').length,
    };
}
