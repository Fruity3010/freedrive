import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadProp } from './props.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DYNAMIC_LAYER } from './world.js';

// Pedestrians, traders, POS attendants. Hundreds of spots, but only a small pool of animated
// characters is ever drawn: each one is handed to whichever spots are nearest the player.

// Clothed characters (Quaternius, CC0), all sharing one animation set.
// [file, how common, garment to recolour, odd hair material name, fixed uniform colours]
const TYPES = {
    casual: ['casual', 3, 'White'],
    womanA: ['woman_a', 2, 'White'],
    womanB: ['woman_b', 2, 'LimeGreen', 'Red'], // this model's hair material is called 'Red'
    worker: ['worker', 1, null],
    farmer: ['farmer', 1, 'LightBlue'],
    business: ['business', 1, null],
    // Nigeria Police: the suit model in all black. Never picked at random, only placed at stations and checkpoints.
    police: ['business', 0, null, null, { Suit: 0x15171a, White: 0x23262b, Tie: 0x15171a }],
};
const PER_TYPE = 8; // pool of 48 drawn characters
const HEIGHT = 1.75;
const SHOW_WITHIN = 90;
const WALK_SPEED = 1.3;
const ANIMS = {
    idle: 'Idle',
    talk: 'Interact',
    walk: 'Walk',
    sit: 'Idle_Neutral', // no sitting clips in this set: traders and attendants stand at their tables
    sitTalk: 'Interact',
    dance: 'Wave',
    wave: 'Wave',
    fall: 'Death',
    angry: 'Punch_Left', // shaking a fist at the rider
};
const SKIN = [0x4a2c1d, 0x5a3a28, 0x6b4430, 0x7b4a2e, 0x8d5524];
const GARMENTS = [0xc62828, 0x1565c0, 0x2e7d32, 0xf9a825, 0x6a1b9a, 0xef6c00, 0x00838f, 0xad1457, 0xffffff];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const weighted = Object.keys(TYPES).flatMap((k) => Array(TYPES[k][1]).fill(k));
const DOWN_TIME = 4; // seconds from being hit to standing again
const UP_TIME = 1.2; // the last part of that is getting back up
const ANGRY_TIME = 3; // then they stand and shout at you
const MAX_CARTS = 12;
const MAX_TRAYS = 12; // per kind of tray
const TRAY_ABOVE_HEAD = 0.18; // from the head bone (base of the skull) up to the top of the head
const SHOULDER = 0.28; // Gala cartons ride on the right shoulder, this far out from the head
const CALL_WITHIN = 50; // hawkers call out when you're this close

// What hawkers shout, in speech bubbles over their trays
const CALLS = {
    snacks: ['Gala! Gala!', 'Buy Gala!', 'Gala dey!'],
    galaBox: ['Gala! Gala!', 'Buy Gala!', 'Gala dey!'],
    galaBasin: ['Gala! Gala!', 'Buy Gala!', 'Hot Gala!'],
    drinks: ['Cold mineral!', 'Buy cold drink!', 'Mineral dey!'],
    fruit: ['Fresh orange!', 'Banana! Orange!', 'Sweet orange!'],
};
const bubbleTextures = {};
function bubbleTexture(text) {
    if (bubbleTextures[text]) return bubbleTextures[text];
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#222222';
    g.lineWidth = 4;
    g.beginPath();
    g.roundRect(6, 6, 244, 62, 18);
    g.moveTo(112, 66); // tail pointing down at the speaker
    g.lineTo(128, 90);
    g.lineTo(144, 66);
    g.fill();
    g.stroke();
    g.fillRect(114, 62, 28, 8); // hide the outline where the tail joins
    g.fillStyle = '#111111';
    g.font = 'bold 34px Arial';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 38);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return (bubbleTextures[text] = tex);
}

// Hawkers' head trays as single vertex-coloured geometries: snacks (red-and-yellow wrapped rolls), soft drinks, fruit
function trayGeometry(kind) {
    const parts = [];
    const add = (geometry, color, x, y, z) => {
        geometry.translate(x, y, z);
        const g = geometry.index ? geometry.toNonIndexed() : geometry;
        const c = new THREE.Color(color);
        g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).map((_, i) => [c.r, c.g, c.b][i % 3]), 3));
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        parts.push(g);
    };
    const ring = (n, r, place) => { for (let i = 0; i < n; i++) place(Math.cos((i / n) * Math.PI * 2) * r, Math.sin((i / n) * Math.PI * 2) * r, i); };
    const galaPack = (x, y, z, ry = 0, rz = 0) => {
        add(new THREE.BoxGeometry(0.16, 0.05, 0.09).rotateZ(rz).rotateY(ry), 0xd32f2f, x, y, z);
        add(new THREE.BoxGeometry(0.162, 0.052, 0.035).rotateZ(rz).rotateY(ry), 0xfdd835, x, y, z);
    };
    if (kind === 'galaBox') {
        // Open carton on the head, packs spilling up out of the top
        add(new THREE.BoxGeometry(0.5, 0.28, 0.36), 0xc62828, 0, 0.14, 0);
        add(new THREE.BoxGeometry(0.505, 0.07, 0.365), 0xfdd835, 0, 0.18, 0);
        for (let i = 0; i < 14; i++) galaPack(THREE.MathUtils.randFloatSpread(0.38), 0.3 + Math.random() * 0.12, THREE.MathUtils.randFloatSpread(0.24), Math.random() * 3, THREE.MathUtils.randFloatSpread(1.2));
        return mergeGeometries(parts);
    }
    if (kind === 'galaBasin') {
        // Black plastic basin heaped high with packs
        add(new THREE.CylinderGeometry(0.38, 0.26, 0.17, 20), 0x1c1c1c, 0, 0.085, 0);
        for (let layer = 0; layer < 4; layer++) {
            const r = 0.3 - layer * 0.07;
            const n = Math.max(3, Math.round(12 - layer * 3));
            for (let i = 0; i < n; i++) {
                const a = (i / n) * Math.PI * 2 + layer;
                galaPack(Math.cos(a) * r, 0.19 + layer * 0.06, Math.sin(a) * r, -a + Math.PI / 2, THREE.MathUtils.randFloatSpread(0.8));
            }
        }
        return mergeGeometries(parts);
    }
    if (kind === 'snacks') {
        // Open carton carried on the shoulder: red with a yellow band, rows of wrapped rolls showing on top
        add(new THREE.BoxGeometry(0.5, 0.26, 0.32), 0xc62828, 0, 0.13, 0);
        add(new THREE.BoxGeometry(0.505, 0.06, 0.325), 0xfdd835, 0, 0.17, 0);
        for (let i = 0; i < 4; i++) {
            for (let k = 0; k < 2; k++) {
                add(new THREE.BoxGeometry(0.1, 0.05, 0.13), 0xd32f2f, -0.18 + i * 0.12, 0.28, -0.07 + k * 0.14);
                add(new THREE.BoxGeometry(0.102, 0.052, 0.04), 0xfdd835, -0.18 + i * 0.12, 0.28, -0.07 + k * 0.14);
            }
        }
        return mergeGeometries(parts);
    }
    add(new THREE.CylinderGeometry(0.34, 0.3, 0.05, 18), 0xb8b8b8, 0, 0.025, 0); // enamel tray
    if (kind === 'drinks') {
        const colours = [0x3e2723, 0xff8f00, 0x7cb342]; // cola, orange, lemon
        const bottle = (x, z, i) => {
            add(new THREE.CylinderGeometry(0.03, 0.033, 0.2, 8), colours[i % 3], x, 0.15, z);
            add(new THREE.CylinderGeometry(0.014, 0.02, 0.05, 6), colours[i % 3], x, 0.275, z);
            add(new THREE.CylinderGeometry(0.016, 0.016, 0.015, 6), 0xd32f2f, x, 0.305, z); // cap
        };
        ring(8, 0.2, bottle);
        ring(4, 0.09, bottle);
    } else {
        const orange = (x, z, y) => add(new THREE.SphereGeometry(0.06, 8, 6), 0xff9800, x, y, z);
        ring(8, 0.19, (x, z) => orange(x, z, 0.1));
        ring(4, 0.08, (x, z) => orange(x, z, 0.12));
        orange(0, 0, 0.21);
        for (let i = 0; i < 4; i++) {
            const banana = new THREE.CapsuleGeometry(0.025, 0.18, 2, 6).rotateZ(Math.PI / 2 - 0.3 + i * 0.12);
            add(banana, 0xfdd835, 0.05, 0.19 + i * 0.012, -0.08 + i * 0.05);
        }
    }
    return mergeGeometries(parts);
}

const CART_AHEAD = 1.0; // wheelbarrow centre, metres in front of the pusher
const CART_YAW = 0; // turn the model so its wheel leads

const KEEP_RIGHT = 0.45; // walkers drift right of their path so oncoming people pass each other
const SIDESTEP = 1.6; // how far to step out around the player

// slots: [{ x, z, y, yaw, anim }] or walkers [{ path: [{x, z}, ...], y, anim: 'walk' }]
export function createPeople(scene, slots) {
    for (const s of slots) init(s);
    function init(s) {
        // Market traders and POS attendants are mostly women; everyone else is a mix
        s.type ??= (s.anim === 'sit' || s.anim === 'sitTalk') && Math.random() < 0.7 ? pick(['womanA', 'womanB']) : pick(weighted);
        s.skin = pick(SKIN);
        s.garment = pick(GARMENTS);
        s.down = 0;
        s.angry = 0;
        s.kx = 0; // knock-back offset
        s.kz = 0;
        if (s.cart) s.type = pick(['casual', 'worker', 'farmer']);
        if (s.tray === 'snacks' && Math.random() < 0.5) {
            // Gala women: red shirts, headscarves, a carton or a heaped basin on the head
            s.tray = pick(['galaBox', 'galaBasin']);
            s.garment = 0xc62828;
            s.scarf = pick([0x8e24aa, 0x1565c0, 0xef6c00, 0x2e7d32, 0xad1457, 0xf9a825]);
            s.type = pick(['womanA', 'womanB']);
        } else if (s.tray) s.type = s.tray === 'snacks' ? pick(['casual', 'worker', 'farmer']) : pick(['womanA', 'womanB', 'casual']); // Gala boys; tray women
        if (s.path) {
            s.side = KEEP_RIGHT;
            s.seg = Math.floor(Math.random() * s.path.length);
            s.u = 0;
            s.pace = s.cart ? 0.6 : THREE.MathUtils.randFloat(0.8, 1.2); // heavy load
            if (s.oneWay) s.seg = 0;
            advance(s, 0, null);
        }
    }
    const members = [];
    let timer = 0;
    // Wheelbarrows (downloaded model), one instanced batch per material, placed in front of each pusher
    const trays = Object.fromEntries(['snacks', 'galaBox', 'galaBasin', 'drinks', 'fruit'].map((kind) => {
        const mesh = new THREE.InstancedMesh(trayGeometry(kind), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), MAX_TRAYS);
        mesh.frustumCulled = false;
        mesh.layers.set(DYNAMIC_LAYER);
        mesh.count = 0;
        scene.add(mesh);
        return [kind, mesh];
    }));
    const carts = [];
    loadProp('models/props/wheelbarrow.glb', 1.5).then((parts) => {
        for (const { geometry, material } of parts) {
            const mesh = new THREE.InstancedMesh(geometry, material, MAX_CARTS);
            mesh.frustumCulled = false;
            mesh.layers.set(DYNAMIC_LAYER);
            mesh.count = 0;
            scene.add(mesh);
            carts.push(mesh);
        }
    });
    const cartObject = new THREE.Object3D();
    const headAt = new THREE.Vector3();

    const loader = new GLTFLoader();
    for (const [type, [file, , garment, hair, uniform]] of Object.entries(TYPES)) {
        loader.load(`models/people/${file}.glb`, (gltf) => {
            const size = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
            gltf.scene.scale.setScalar(HEIGHT / size.y);
            const clips = Object.fromEntries(Object.entries(ANIMS).map(([k, name]) => [k, gltf.animations.find((a) => a.name.split('|').pop() === name)]));
            for (let i = 0; i < PER_TYPE; i++) {
                const man = cloneSkinned(gltf.scene);
                // Own copies of the materials so each person can have their own skin and clothes colour
                const copies = new Map();
                man.traverse((o) => {
                    if (!o.isMesh) return;
                    if (!copies.has(o.material)) copies.set(o.material, o.material.clone());
                    o.material = copies.get(o.material);
                    o.layers.set(DYNAMIC_LAYER);
                });
                const mats = [...copies.values()];
                const wear = (s) => {
                    for (const m of mats) {
                        if (m.name.startsWith('Skin')) m.color.set(s.skin).multiplyScalar(m.name === 'Skin_Darker' ? 0.8 : 1);
                        else if ((m.name.startsWith('Hair') || m.name === hair) && s.scarf) m.color.set(s.scarf); // headscarf
                        else if (m.name.startsWith('Hair') || m.name === hair || m.name === 'Eyebrows' || m.name === 'Moustache') m.color.set(0x151210);
                        else if (uniform?.[m.name] !== undefined) m.color.set(uniform[m.name]);
                        else if (m.name === garment) m.color.set(s.garment);
                    }
                };
                man.visible = false;
                scene.add(man);
                const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTexture(CALLS.snacks[0]), depthWrite: false }));
                bubble.scale.set(1.6, 0.6, 1);
                bubble.layers.set(DYNAMIC_LAYER);
                bubble.visible = false;
                scene.add(bubble);
                members.push({ man, wear, clips, type, bubble, head: man.getObjectByName('Head'), hips: man.getObjectByName('Hips'), mixer: new THREE.AnimationMixer(man), slot: null });
            }
        });
    }

    // Walk the path; step sideways around the player, then drift back to the right of the path
    function advance(s, dt, player) {
        let a = s.path[s.seg];
        let b = s.path[(s.seg + 1) % s.path.length];
        let len = Math.hypot(b.x - a.x, b.z - a.z);
        let dx = (b.x - a.x) / len;
        let dz = (b.z - a.z) / len;
        let target = KEEP_RIGHT;
        if (player) {
            // Player in path coordinates: how far ahead, and how far to our right
            const px = player.x - (a.x + dx * s.u);
            const pz = player.z - (a.z + dz * s.u);
            const ahead = px * dx + pz * dz;
            const right = -px * dz + pz * dx;
            if (ahead > -1 && ahead < 4 && Math.abs(right - s.side) < 1.3) target = right >= s.side ? right - SIDESTEP : right + SIDESTEP;
        }
        const step = THREE.MathUtils.clamp(target - s.side, -1.5 * dt, 1.5 * dt);
        s.side += step;
        s.u += WALK_SPEED * s.pace * dt;
        while (s.u > len) {
            if (s.oneWay && s.seg >= s.path.length - 2) {
                s.u = len; // reached the end of a one-off walk
                s.done = true;
                break;
            }
            s.u -= len;
            s.seg = (s.seg + 1) % s.path.length;
            a = s.path[s.seg];
            b = s.path[(s.seg + 1) % s.path.length];
            len = Math.hypot(b.x - a.x, b.z - a.z);
            dx = (b.x - a.x) / len;
            dz = (b.z - a.z) / len;
        }
        s.x = a.x + dx * s.u - dz * s.side;
        s.z = a.z + dz * s.u + dx * s.side;
        if (a.y !== undefined) s.y = a.y + ((b.y - a.y) * s.u) / len; // paths with heights: stairs and footbridges
        s.yaw = Math.atan2(dx, dz) - Math.atan2(step / Math.max(dt, 1e-3), WALK_SPEED); // turn into the sidestep
    }

    // What a person should be doing right now
    const pose = (s) => (s.down > 0 ? (s.down > UP_TIME ? 'fall' : 'getUp') : s.angry > 0 ? 'angry' : s.anim);

    function play(m, key) {
        m.pose = key;
        m.mixer.stopAllAction();
        const action = m.mixer.clipAction(m.clips[key === 'getUp' ? 'fall' : key]).reset();
        if (key === 'fall' || key === 'getUp') {
            // The fall clip once forwards to go down, once backwards to get up
            action.setLoop(THREE.LoopOnce, 1);
            action.clampWhenFinished = true;
            action.timeScale = key === 'fall' ? 1.6 : -1.6;
            if (key === 'getUp') action.time = action.getClip().duration;
            action.play();
        } else {
            action.play();
            m.mixer.setTime(Math.random() * action.getClip().duration);
        }
    }

    function attach(m, s) {
        m.slot = s;
        s.member = m;
        m.man.visible = true;
        play(m, pose(s));
        m.wear(s);
    }

    // Hand the pool to the nearest spots
    function assign(player) {
        const dist = (s) => Math.abs(s.x - player.x) + Math.abs(s.z - player.z);
        const near = slots.filter((s) => dist(s) < SHOW_WITHIN).sort((a, b) => dist(a) - dist(b)).slice(0, PER_TYPE * Object.keys(TYPES).length);
        const wanted = new Set(near);
        for (const m of members) {
            if (m.slot && !wanted.has(m.slot)) {
                m.slot.member = null;
                m.slot = null;
                m.man.visible = false;
                m.bubble.visible = false;
            }
        }
        for (const s of near) {
            if (s.member) continue;
            const free = members.find((m) => !m.slot && m.type === s.type);
            if (!free) continue; // all of this type are busy nearer by
            attach(free, s);
        }
    }

    return {
        update(dt, player) {
            for (const s of slots) {
                if (s.down > 0) {
                    s.down -= dt;
                    if (s.down <= 0) s.angry = ANGRY_TIME;
                    continue;
                }
                if (s.angry > 0) {
                    s.angry -= dt;
                    s.glare = Math.atan2(player.x - s.x - s.kx, player.z - s.z - s.kz); // face the rider
                    continue;
                }
                s.kx *= Math.exp(-2 * dt); // drift back onto their spot
                s.kz *= Math.exp(-2 * dt);
                // Only stop if the bike is practically on top of them; otherwise walk around it
                if (s.path && Math.hypot(s.x - player.x, s.z - player.z) > 0.9) advance(s, dt, player);
            }
            // One-off walkers (getting on or off a danfo) leave the street when they arrive
            for (let i = slots.length - 1; i >= 0; i--) {
                const s = slots[i];
                if (!s.done) continue;
                if (s.member) {
                    s.member.slot = null;
                    s.member.man.visible = false;
                    s.member.bubble.visible = false;
                }
                slots.splice(i, 1);
                s.onDone?.();
            }
            if ((timer -= dt) <= 0) {
                timer = 0.3;
                assign(player);
            }
            let cartCount = 0;
            for (const mesh of Object.values(trays)) mesh.count = 0;
            for (const m of members) {
                if (!m.slot) continue;
                const s = m.slot;
                // Hawkers near you call out now and then: a bubble for a couple of seconds, then a pause
                let calling = false;
                if (s.tray && s.down <= 0 && s.angry <= 0 && Math.hypot(s.x - player.x, s.z - player.z) < CALL_WITHIN) {
                    if ((s.callTimer = (s.callTimer ?? Math.random() * 3) - dt) <= 0) {
                        s.calling = !s.calling;
                        s.callTimer = s.calling ? 2.2 : THREE.MathUtils.randFloat(1.5, 4);
                        if (s.calling) m.bubble.material.map = bubbleTexture(pick(CALLS[s.tray]));
                    }
                    calling = s.calling;
                }
                m.bubble.visible = calling;
                if (m.pose !== pose(s)) play(m, pose(s));
                m.man.position.set(s.x + s.kx, s.y, s.z + s.kz);
                m.man.rotation.y = s.angry > 0 ? s.glare : s.down > 0 ? s.fallYaw : s.yaw;
                m.mixer.update(dt);
                if (s.cart && s.down <= 0 && cartCount < MAX_CARTS) {
                    // Wheelbarrow out in front of the pusher's hips (follows the body through the walk cycle)
                    m.man.updateMatrixWorld(true);
                    m.hips.getWorldPosition(headAt);
                    cartObject.position.set(headAt.x + Math.sin(s.yaw) * CART_AHEAD, s.y, headAt.z + Math.cos(s.yaw) * CART_AHEAD);
                    cartObject.rotation.set(0, s.yaw + CART_YAW, 0);
                    cartObject.updateMatrix();
                    for (const mesh of carts) mesh.setMatrixAt(cartCount, cartObject.matrix);
                    cartCount++;
                }
                if (s.tray && s.down <= 0) {
                    // Tray and bubble ride on the head bone itself: the walk cycle moves the body about,
                    // so placing them at the walker's spot would leave the tray floating beside them
                    m.man.updateMatrixWorld(true);
                    m.head.getWorldPosition(headAt);
                    if (trays[s.tray].count < MAX_TRAYS) {
                        if (s.tray === 'snacks') {
                            // Carton on the right shoulder, a little below and beside the head
                            cartObject.position.set(headAt.x - Math.cos(s.yaw) * SHOULDER, headAt.y - 0.12, headAt.z + Math.sin(s.yaw) * SHOULDER);
                        } else cartObject.position.set(headAt.x, headAt.y + TRAY_ABOVE_HEAD, headAt.z);
                        cartObject.rotation.set(0, s.yaw, 0);
                        cartObject.updateMatrix();
                        trays[s.tray].setMatrixAt(trays[s.tray].count++, cartObject.matrix);
                    }
                    if (calling) m.bubble.position.set(headAt.x, headAt.y + TRAY_ABOVE_HEAD + 0.85, headAt.z);
                }
            }
            for (const mesh of Object.values(trays)) mesh.instanceMatrix.needsUpdate = true;
            for (const mesh of carts) {
                mesh.count = cartCount;
                mesh.instanceMatrix.needsUpdate = true;
            }
        },
        // The visible, standing person a circle at (x, z) touches, if any
        hit(x, z, r, y = 0) {
            const m = members.find((m) => m.slot && m.slot.down <= 0 && Math.abs(m.slot.y - y) < 1.5 && Math.hypot(m.slot.x + m.slot.kx - x, m.slot.z + m.slot.kz - z) < r + 0.35);
            return m && m.slot;
        },
        // Someone walking a one-off route, e.g. off a danfo to the pavement; onDone runs when they get there
        walk(path, onDone) {
            const s = { path, y: 0.15, anim: 'walk', oneWay: true, onDone };
            init(s);
            slots.push(s);
            timer = 0; // show them straight away
        },
        // Everyone standing within r of (x, z) turns on the rider
        anger(x, z, r) {
            for (const s of slots) if (s.down <= 0 && Math.hypot(s.x - x, s.z - z) < r) s.angry = 4;
        },
        // Hit by the bike: thrown a little the way it was going, falls, gets up angry. Never dies.
        knock(s, dirX, dirZ) {
            s.down = DOWN_TIME;
            s.kx += dirX * 0.9;
            s.kz += dirZ * 0.9;
            s.fallYaw = Math.atan2(-dirX, -dirZ); // face the bike as they go over backwards
        },
    };
}
