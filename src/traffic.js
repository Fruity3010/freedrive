import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loadSeated } from './seated.js';
import { MAINLAND, ISLAND, STEP, ROAD, STOP_LINE, BRIDGE_HALF_WIDTH, MEDIAN_HALF, LANE_WIDTH, DYNAMIC_LAYER, parkedSlots, roadHeight, roadSlope } from './world.js';

// Moving traffic on every street and the bridge. Danfos randomly swerve to the kerb and stop for passengers.

// [file, length in world units, how common, colour of its far-away stand-in box, nose points backwards?]. Swap in better models here.
const MODELS = [
    ['danfo2/danfo.glb', 5.6, 10, 0xf2c12e, true],
    ['sedan_car_gltf/scene.gltf', 4.6, 6, 0x1d2a3a],
];
const NEAR = 150; // full models inside this distance from the player
const FAR = 600; // plain boxes out to here, nothing beyond
const MAX_VEHICLES = 260;
const CITY_LIMIT = 12; // ~45 km/h
const BRIDGE_LIMIT = 22; // ~80 km/h
const ACCEL = 5;
const BRAKE = 18;
const MARGIN = ROAD / 2; // lanes stop at the edge of each junction
const JUNCTION_SPEED = 6; // ~20 km/h through junctions
const CRASH_SPEED = 6; // closing faster than this (~20 km/h) is a crash, slower is a gentle stop

// ---- Road graph: junctions are nodes, each road is two one-way edges with right-hand lanes ----

const CITY_LANES = [2.6, 7.2]; // inner (overtaking, left turns) and outer (kerbside, right turns)
const BRIDGE_LANES = [0, 1, 2].map((i) => MEDIAN_HALF + LANE_WIDTH * (i + 0.5));
const nodes = new Map();
const node = (x, z) => {
    const key = `${x},${z}`;
    if (!nodes.has(key)) nodes.set(key, { x, z, out: [] });
    return nodes.get(key);
};

function link(a, b, lanes, limit, kerb) {
    for (const [from, to] of [[a, b], [b, a]]) {
        const len = Math.hypot(to.x - from.x, to.z - from.z);
        const dir = { x: (to.x - from.x) / len, z: (to.z - from.z) / len };
        from.out.push({ from, to, len, dir, right: { x: -dir.z, z: dir.x }, lanes, limit, kerb });
    }
}

for (const d of [MAINLAND, ISLAND]) {
    for (let x = d.x0; x <= d.x1; x += STEP) {
        for (let z = d.z0; z <= d.z1; z += STEP) {
            if (x + STEP <= d.x1) link(node(x, z), node(x + STEP, z), CITY_LANES, CITY_LIMIT, ROAD / 2 - 1.5);
            if (z + STEP <= d.z1) link(node(x, z), node(x, z + STEP), CITY_LANES, CITY_LIMIT, ROAD / 2 - 1.5);
        }
    }
}
link(node(MAINLAND.x1, 0), node(ISLAND.x0, 0), BRIDGE_LANES, BRIDGE_LIMIT, BRIDGE_HALF_WIDTH - 1.8);
const edges = [...nodes.values()].flatMap((n) => n.out);
const bridgeEdges = edges.filter((e) => e.lanes === BRIDGE_LANES);
const mainlandEdges = edges.filter((e) => e.lanes !== BRIDGE_LANES && e.from.x <= MAINLAND.x1);

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const cross = (a, b) => a.x * b.z - a.z * b.x;

function nextEdge(edge) {
    const options = edge.to.out.filter((e) => e.to !== edge.from); // no U-turns
    const bridge = options.find((e) => e.lanes === BRIDGE_LANES);
    return bridge && Math.random() < 0.5 ? bridge : pick(options); // keep the bridge busy
}

// Plan the next turn as soon as a vehicle starts down a road, so it can get into the right lane early.
// Traffic keeps right: right turns from the outer lane, left turns from the inner lane.
function plan(v) {
    const next = nextEdge(v.edge);
    const turn = cross(v.edge.dir, next.dir); // > 0 right, < 0 left
    const outer = (e) => e.lanes.length - 1;
    const want = turn > 0.5 ? outer(v.edge) : turn < -0.5 ? 0 : Math.min(v.lane, outer(v.edge));
    const lane = turn > 0.5 ? outer(next) : turn < -0.5 ? 0 : Math.min(v.lane, outer(next));
    v.plan = { next, want, lane };
}

// ---- Traffic lights at every junction where three or more roads meet ----
// North-south and east-west take turns: 8s green, 2s amber, then red (with a moment of all-red between).
const CYCLE = 22;
const GREEN = 8;
const AMBER = 2;
for (const n of nodes.values()) if (n.out.length >= 3) n.light = { offset: Math.random() * CYCLE, state: ['', ''] };
const lightNodes = [...nodes.values()].filter((n) => n.light);
const axisOf = (e) => (Math.abs(e.dir.z) > Math.abs(e.dir.x) ? 0 : 1); // 0 north-south, 1 east-west
function lightState(n, axis, time) {
    const u = (time + n.light.offset - axis * (CYCLE / 2) + CYCLE * 2) % CYCLE;
    return u < GREEN ? 'green' : u < GREEN + AMBER ? 'amber' : 'red';
}

// Curve through a junction from the end of one lane to the start of the next
function turnCurve(p0, d1, p2, d2) {
    const c = cross(d1, d2);
    let ctrl;
    if (Math.abs(c) < 1e-3) ctrl = { x: (p0.x + p2.x) / 2, z: (p0.z + p2.z) / 2 };
    else {
        const s = cross({ x: p2.x - p0.x, z: p2.z - p0.z }, d2) / c;
        ctrl = { x: p0.x + d1.x * s, z: p0.z + d1.z * s };
    }
    return new THREE.QuadraticBezierCurve(
        new THREE.Vector2(p0.x, p0.z), new THREE.Vector2(ctrl.x, ctrl.z), new THREE.Vector2(p2.x, p2.z));
}

// ---- Collision shapes: vehicles are rectangles { x, z, yaw, hl, hw } (half length/width) ----

const axes = (yaw) => [[Math.sin(yaw), Math.cos(yaw)], [Math.cos(yaw), -Math.sin(yaw)]];
const extent = (b, [ax, az]) => {
    const [[fx, fz], [sx, sz]] = axes(b.yaw);
    return b.hl * Math.abs(fx * ax + fz * az) + b.hw * Math.abs(sx * ax + sz * az);
};
// Separating-axis test for two rotated rectangles
function overlaps(a, b) {
    for (const axis of [...axes(a.yaw), ...axes(b.yaw)]) {
        if (Math.abs((b.x - a.x) * axis[0] + (b.z - a.z) * axis[1]) > extent(a, axis) + extent(b, axis)) return false;
    }
    return true;
}
function circleHitsBox(p, r, b) {
    const dx = p.x - b.x;
    const dz = p.z - b.z;
    return Math.abs(dx * Math.sin(b.yaw) + dz * Math.cos(b.yaw)) < b.hl + r && Math.abs(dx * Math.cos(b.yaw) - dz * Math.sin(b.yaw)) < b.hw + r;
}

// ---- Vehicles ----

const WHEEL = /wheel|tyre|tire|rim/i;

// Bake a model's many meshes into one geometry per material, ready to instance.
// Wheels are kept apart, one part per corner with its pivot at the wheel's centre, so they can spin.
function flatten(model) {
    model.updateMatrixWorld(true);
    const centre = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
    const body = new Map();
    const wheels = new Map(); // "material|corner" -> geometries
    model.traverse((o) => {
        if (!o.isMesh) return;
        let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        g.applyMatrix4(o.matrixWorld);
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        if (!g.attributes.normal) g.computeVertexNormals();
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        if (!WHEEL.test(o.name) && !WHEEL.test(o.material.name)) {
            if (!body.has(o.material)) body.set(o.material, []);
            body.get(o.material).push(g);
            return;
        }
        // Wheel geometry may hold all four wheels at once: sort its triangles into corners
        const pos = g.attributes.position;
        const corners = new Map();
        for (let i = 0; i < pos.count; i += 3) {
            const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
            const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
            const corner = `${cx > centre.x ? 'L' : 'R'}${cz > centre.z ? 'F' : 'B'}`;
            if (!corners.has(corner)) corners.set(corner, []);
            corners.get(corner).push(i);
        }
        for (const [corner, starts] of corners) {
            const part = new THREE.BufferGeometry();
            for (const [name, attr] of Object.entries(g.attributes)) {
                const out = new Float32Array(starts.length * 3 * attr.itemSize);
                starts.forEach((start, k) => out.set(attr.array.subarray(start * attr.itemSize, (start + 3) * attr.itemSize), k * 3 * attr.itemSize));
                part.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize));
            }
            const key = `${o.material.uuid}|${corner}`;
            if (!wheels.has(key)) wheels.set(key, { material: o.material, corner, geometries: [] });
            wheels.get(key).geometries.push(part);
        }
    });
    const parts = [...body].map(([material, geometries]) => ({ material, geometry: mergeGeometries(geometries) }));
    // Each corner's pivot is the centre of everything in that corner (tyre and rim together)
    const cornerBox = new Map();
    for (const { corner, geometries } of wheels.values()) {
        for (const g of geometries) {
            g.computeBoundingBox();
            cornerBox.set(corner, (cornerBox.get(corner) ?? g.boundingBox.clone()).union(g.boundingBox));
        }
    }
    for (const { material, corner, geometries } of wheels.values()) {
        const bounds = cornerBox.get(corner);
        const pivot = bounds.getCenter(new THREE.Vector3());
        const geometry = mergeGeometries(geometries).translate(-pivot.x, -pivot.y, -pivot.z);
        parts.push({ material, geometry, wheel: { pivot, radius: Math.max(0.1, (bounds.max.y - bounds.min.y) / 2) } });
    }
    return parts;
}

async function loadKinds() {
    const loader = new GLTFLoader();
    const load = async ([file, len, weight, color, backwards]) => {
        const model = (await loader.loadAsync(`models/${file}`)).scene;
        let size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
        model.rotation.y = (size.x > size.z ? Math.PI / 2 : 0) + (backwards ? Math.PI : 0); // length along z, nose forward
        model.updateMatrixWorld(true);
        size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
        const scale = len / size.z;
        model.scale.setScalar(scale);
        // Stand it on the road, centred: some models have their origin mid-body
        model.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(model);
        const middle = bounds.getCenter(new THREE.Vector3());
        model.position.set(-middle.x, -bounds.min.y, -middle.z);
        const parts = flatten(model);
        const wheelRadius = parts.find((p) => p.wheel)?.wheel.radius ?? 0.35;
        return { parts, wheelRadius, len, wid: size.x * scale, hgt: size.y * scale, weight, color: new THREE.Color(color), danfo: file.startsWith('danfo') };
    };
    const kinds = await Promise.all(MODELS.map(load));
    return { pool: kinds.flatMap((k) => Array(k.weight).fill(k)) };
}


export function createTraffic(scene, onHitPlayer, onDanfoStop) {
    const vehicles = [];
    const pos = new THREE.Vector2();
    const tangent = new THREE.Vector2();

    function spawn(kinds, edge, loop = false) {
        const lane = Math.floor(Math.random() * edge.lanes.length);
        const t = THREE.MathUtils.randFloat(MARGIN, edge.len - MARGIN);
        if (vehicles.some((v) => v.edge === edge && v.lane === lane && Math.abs(v.t - t) < 12)) return;
        const kind = pick(kinds.pool);
        const object = new THREE.Group(); // transform only; the body is drawn by the kind's instanced meshes
        object.rotation.order = 'YXZ';
        scene.add(object);
        const v = {
            kind, object, edge, lane, t, turn: null,
            offset: edge.lanes[lane], targetOffset: edge.lanes[lane],
            speed: 0, cruise: edge.limit * THREE.MathUtils.randFloat(0.85, 1.1),
            state: 'drive', timer: 0, stuck: 0, ghost: 0, x: 0, z: 0, yaw: 0, loop, spin: 0,
        };
        if (kind.danfo) seatPassengers(v);
        plan(v);
        place(v);
        vehicles.push(v);
    }

    // Danfo passengers: a driver plus up to 10, our own characters baked into a sitting pose (seated.js),
    // drawn as instanced batches with each passenger's shirt and skin colour
    const SEATS = [[0.55, 1.35], [-0.6, 0.35], [0, 0.35], [0.6, 0.35], [-0.6, -0.65], [0, -0.65], [0.6, -0.65], [-0.6, -1.65], [0, -1.65], [0.6, -1.65]];
    const SEAT_HIPS = 1.12; // hip height on the bench, above the road (high enough that no legs poke out under the bus)
    const SHIRTS = [0xc62828, 0x1565c0, 0x2e7d32, 0xf9a825, 0xffffff, 0x6a1b9a, 0xef6c00, 0x212121];
    const SKINS = [0x4a2c1d, 0x5a3a28, 0x6b4430, 0x7b4a2e];
    const MAX_RIDERS = 160; // per character type
    const riderKinds = []; // [{ meshes: [{ mesh, tint, darker }], count }]
    Promise.all([loadSeated('models/people/casual.glb', 'LightBrown'), loadSeated('models/people/woman_a.glb', 'White')]).then((kinds) => {
        for (const { parts } of kinds) {
            riderKinds.push({
                count: 0,
                meshes: parts.map(({ geometry, material, tint, darker }) => {
                    const mesh = new THREE.InstancedMesh(geometry, material, MAX_RIDERS);
                    mesh.frustumCulled = false;
                    mesh.layers.set(DYNAMIC_LAYER);
                    mesh.count = 0;
                    if (tint) mesh.setColorAt(0, new THREE.Color()); // allocate per-instance colours
                    scene.add(mesh);
                    return { mesh, tint, darker };
                }),
            });
        }
    });
    const seatMatrix = new THREE.Matrix4();
    const riderMatrix = new THREE.Matrix4();
    const darkSkin = new THREE.Color();
    function seatPassengers(v) {
        v.passengers = THREE.MathUtils.randInt(3, 9);
        v.riders = SEATS.map(() => ({ kind: Math.random() < 0.5 ? 0 : 1, shirt: new THREE.Color(pick(SHIRTS)), skin: new THREE.Color(pick(SKINS)) }));
    }

    // Instanced drawing: one draw call per material per vehicle type, plus one for all distant boxes
    let kindList = [];
    const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial(), MAX_VEHICLES);
    const instance = (mesh) => {
        mesh.frustumCulled = false; // instances are spread across the map
        mesh.layers.set(DYNAMIC_LAYER);
        mesh.count = 0;
        scene.add(mesh);
        return mesh;
    };
    instance(boxes);
    const boxMatrix = new THREE.Matrix4();
    const wheelMatrix = new THREE.Matrix4();
    const wheelWorld = new THREE.Matrix4();
    const boxScale = new THREE.Matrix4();

    function draw(player) {
        let far = 0;
        for (const k of riderKinds) k.count = 0;
        for (const k of kindList) k.count = 0;
        for (const v of vehicles) {
            const d = Math.abs(v.x - player.x) + Math.abs(v.z - player.z);
            if (d > FAR) continue;
            v.object.updateMatrix();
            if (v.riders && riderKinds.length && d < 60) {
                v.object.updateMatrix();
                // Driver always, then as many passengers as are on board, sitting in rows
                for (let i = 0; i <= v.passengers && i < SEATS.length; i++) {
                    const r = v.riders[i];
                    const k = riderKinds[r.kind];
                    if (k.count >= MAX_RIDERS) continue;
                    riderMatrix.multiplyMatrices(v.object.matrix, seatMatrix.makeTranslation(SEATS[i][0], SEAT_HIPS, SEATS[i][1]));
                    for (const { mesh, tint, darker } of k.meshes) {
                        mesh.setMatrixAt(k.count, riderMatrix);
                        if (tint === 'shirt') mesh.setColorAt(k.count, r.shirt);
                        else if (tint === 'skin') mesh.setColorAt(k.count, darker ? darkSkin.copy(r.skin).multiplyScalar(0.8) : r.skin);
                    }
                    k.count++;
                }
            }
            if (d < NEAR) {
                for (const p of v.kind.parts) {
                    if (!p.wheel) p.mesh.setMatrixAt(v.kind.count, v.object.matrix);
                    else {
                        // Wheel: move to its hub, then roll about the axle
                        wheelMatrix.makeRotationX(v.spin ?? 0).setPosition(p.wheel.pivot);
                        p.mesh.setMatrixAt(v.kind.count, wheelWorld.multiplyMatrices(v.object.matrix, wheelMatrix));
                    }
                }
                v.kind.count++;
            } else {
                boxScale.makeScale(v.kind.wid, v.kind.hgt, v.kind.len);
                boxes.setMatrixAt(far, boxMatrix.multiplyMatrices(v.object.matrix, boxScale));
                boxes.setColorAt(far, v.kind.color);
                far++;
            }
        }
        for (const k of kindList) {
            for (const p of k.parts) {
                p.mesh.count = k.count;
                p.mesh.instanceMatrix.needsUpdate = true;
            }
        }
        for (const k of riderKinds) {
            for (const { mesh } of k.meshes) {
                mesh.count = k.count;
                mesh.instanceMatrix.needsUpdate = true;
                if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
            }
        }
        boxes.count = far;
        boxes.instanceMatrix.needsUpdate = true;
        if (boxes.instanceColor) boxes.instanceColor.needsUpdate = true;
    }

    // ---- Traffic light poles: one head per approach, on the kerbside at the stop line ----
    let lightTime = 0;
    const heads = []; // { node, axis, lamp } lamp = index of its red lamp; amber and green follow
    for (const n of lightNodes) {
        for (const e of edges) {
            if (e.to !== n) continue;
            const side = (e.lanes === BRIDGE_LANES ? BRIDGE_HALF_WIDTH : ROAD / 2) + 0.6;
            const x = n.x - e.dir.x * STOP_LINE + e.right.x * side;
            const z = n.z - e.dir.z * STOP_LINE + e.right.z * side;
            heads.push({ node: n, axis: axisOf(e), x, z, y: e.lanes === BRIDGE_LANES ? roadHeight(x) : 0.2, yaw: Math.atan2(-e.dir.x, -e.dir.z) });
        }
    }
    const lightParts = (geometry, material, count) => {
        const mesh = new THREE.InstancedMesh(geometry, material, count);
        mesh.layers.set(DYNAMIC_LAYER);
        scene.add(mesh);
        return mesh;
    };
    const poles = lightParts(new THREE.CylinderGeometry(0.08, 0.1, 4.6, 8).translate(0, 2.3, 0), new THREE.MeshStandardMaterial({ color: 0x37474f }), heads.length);
    const lightBoxes = lightParts(new THREE.BoxGeometry(0.45, 1.3, 0.35).translate(0, 4.75, 0), new THREE.MeshStandardMaterial({ color: 0x1b1b1b }), heads.length);
    const lamps = lightParts(new THREE.SphereGeometry(0.15, 10, 8), new THREE.MeshBasicMaterial(), heads.length * 3);
    {
        const o = new THREE.Object3D();
        const lamp = new THREE.Object3D();
        heads.forEach((h, i) => {
            o.position.set(h.x, h.y, h.z);
            o.rotation.set(0, h.yaw, 0);
            o.updateMatrix();
            poles.setMatrixAt(i, o.matrix);
            lightBoxes.setMatrixAt(i, o.matrix);
            h.lamp = i * 3;
            for (let k = 0; k < 3; k++) {
                lamp.position.set(0, 5.15 - k * 0.4, 0.2); // red, amber, green from the top, facing the traffic
                lamp.updateMatrix();
                lamps.setMatrixAt(h.lamp + k, new THREE.Matrix4().multiplyMatrices(o.matrix, lamp.matrix));
            }
        });
    }
    const LAMP = { on: [0xff2020, 0xffb300, 0x19e36b].map((c) => new THREE.Color(c)), off: [0x3a0909, 0x3a2a05, 0x07301a].map((c) => new THREE.Color(c)) };
    const lit = { red: 0, amber: 1, green: 2 };
    // Recolour lamps only when a junction's light actually changes
    function updateLights() {
        let changed = false;
        for (const h of heads) {
            const state = lightState(h.node, h.axis, lightTime);
            if (h.state === state) continue;
            h.state = state;
            for (let k = 0; k < 3; k++) lamps.setColorAt(h.lamp + k, k === lit[state] ? LAMP.on[k] : LAMP.off[k]);
            changed = true;
        }
        if (changed) lamps.instanceColor.needsUpdate = true;
    }

    createTrafficAsync();
    async function createTrafficAsync() {
        const kinds = await loadKinds();
        kindList = [...new Set(kinds.pool)];
        for (const k of kindList) for (const p of k.parts) p.mesh = instance(new THREE.InstancedMesh(p.geometry, p.material, MAX_VEHICLES));
        // Danfos waiting in the motor parks: never move, but are drawn and collide like the rest
        const danfo = kindList.find((k) => k.danfo);
        for (const { x, z, yaw } of parkedSlots) {
            const object = new THREE.Group();
            object.position.set(x, 0.2, z);
            object.rotation.y = yaw;
            const parked = { kind: danfo, object, x, z, yaw, parked: true, state: 'parked', speed: 0 };
            seatPassengers(parked);
            vehicles.push(parked);
        }
        for (let i = 0; i < 40; i++) spawn(kinds, pick(bridgeEdges), true);
        for (let i = 0; i < 100; i++) spawn(kinds, pick(edges));
        for (let i = 0; i < 70; i++) spawn(kinds, pick(mainlandEdges)); // the Mainland is always jammed
    }

    // Distance to the nearest thing ahead in our path (other vehicles and the player)
    // ponytail: O(n²) scan over ~140 vehicles, fine at this size; use a spatial grid if counts grow
    function gapAhead(v, player) {
        let gap = Infinity;
        const fx = Math.sin(v.yaw);
        const fz = Math.cos(v.yaw);
        const check = (x, z, halfLen) => {
            const dx = x - v.x;
            const dz = z - v.z;
            const ahead = dx * fx + dz * fz;
            if (ahead <= 0 || ahead > 40 || Math.abs(dx * fz - dz * fx) > 2.2) return;
            gap = Math.min(gap, ahead - halfLen - v.kind.len / 2);
        };
        for (const o of vehicles) if (o !== v) check(o.x, o.z, o.kind.len / 2);
        check(player.x, player.z, 2.3);
        return gap;
    }

    const laneClear = (v, offset) =>
        !vehicles.some((o) => o !== v && o.edge === v.edge && !o.turn && Math.abs(o.t - v.t) < 12 && Math.abs(o.offset - offset) < 2.5);

    function updateBehaviour(v, gap, dt) {
        const e = v.edge;
        const laneOffset = e.lanes[v.lane];
        if (v.state === 'drive') {
            // Danfo spots a passenger: swerve to the kerb and brake hard
            if (v.kind.danfo && !v.turn && v.t > MARGIN + 10 && v.t < e.len - 25 && Math.random() < dt * 0.06) {
                v.state = 'pullover';
                v.targetOffset = e.kerb;
            } else if (!v.turn && v.plan && v.lane !== v.plan.want && v.t < e.len - STOP_LINE - 6) {
                // Get into the lane for the coming turn, one lane at a time, when there's a gap
                const lane = v.lane + Math.sign(v.plan.want - v.lane);
                if (laneClear(v, e.lanes[lane])) {
                    v.lane = lane;
                    v.targetOffset = e.lanes[lane];
                }
            } else if (!v.turn && e.lanes.length > 1 && v.t < e.len - 35 && gap < 15 && v.speed < v.cruise - 3 && Math.random() < dt * 0.5) {
                // Overtake on the open stretch only, never just before a junction
                const lane = v.lane + pick([-1, 1]);
                if (lane >= 0 && lane < e.lanes.length && laneClear(v, e.lanes[lane])) {
                    v.lane = lane;
                    v.targetOffset = e.lanes[lane];
                }
            }
        } else if (v.state === 'pullover' && v.speed < 0.3 && Math.abs(v.offset - v.targetOffset) < 0.3) {
            v.state = 'stopped';
            v.timer = THREE.MathUtils.randFloat(5, 8); // long enough for people to get off and on
            onDanfoStop?.(v);
        } else if (v.state === 'stopped' && (v.timer -= dt) <= 0) {
            v.state = 'merge';
            v.targetOffset = laneOffset;
        } else if (v.state === 'merge' && Math.abs(v.offset - laneOffset) < 0.2) {
            v.state = 'drive';
        } else if (v.state === 'crashed' && (v.timer -= dt) <= 0) {
            v.state = 'merge'; // driver recovers and rejoins the lane
            v.targetOffset = laneOffset;
        }
    }

    const footprint = (v) => ({ x: v.x, z: v.z, yaw: v.yaw, hl: v.kind.len / 2, hw: v.kind.wid / 2 });

    function crashVehicle(v, impact) {
        v.state = 'crashed';
        v.timer = 3 + impact * 0.1;
        v.speed = 0;
    }

    // Try somewhere quiet if a vehicle has been wedged for ages (off-screen only)
    function respawn(v) {
        for (let i = 0; i < 10; i++) {
            const edge = pick(edges);
            const lane = Math.floor(Math.random() * edge.lanes.length);
            const t = THREE.MathUtils.randFloat(MARGIN + 5, edge.len - MARGIN - 5);
            const spot = { x: edge.from.x + edge.dir.x * t + edge.right.x * edge.lanes[lane], z: edge.from.z + edge.dir.z * t + edge.right.z * edge.lanes[lane], yaw: Math.atan2(edge.dir.x, edge.dir.z), hl: v.kind.len / 2 + 2, hw: v.kind.wid / 2 };
            if (vehicles.some((o) => o !== v && overlaps(spot, footprint(o)))) continue;
            Object.assign(v, { edge, lane, t, turn: null, offset: edge.lanes[lane], targetOffset: edge.lanes[lane], state: 'drive', speed: 0, stuck: 0 });
            plan(v);
            return;
        }
    }

    // Distance to a red (or catchable amber) light's stop line, treated like a car ahead; Infinity if clear to go
    function lightGap(v) {
        if (v.turn || !v.edge.to.light) return Infinity;
        const toLine = v.edge.len - STOP_LINE - v.t - v.kind.len / 2; // front bumper to the stop line
        if (toLine < -0.5) return Infinity; // already over the line: clear the junction
        const state = lightState(v.edge.to, axisOf(v.edge), lightTime);
        if (state === 'green' || (state === 'amber' && toLine < v.speed * 0.8)) return Infinity; // too close to stop: go
        return Math.max(0, toLine) + 3;
    }

    function move(v, gap, dt, player, playerRadius, onHitPlayer) {
        let target = ['pullover', 'stopped', 'crashed'].includes(v.state) ? 0 : v.cruise;
        if (v.ghost > 0) v.ghost -= dt;
        else target = Math.min(target, Math.max(0, (gap - 3) / 0.6));
        const red = lightGap(v);
        target = Math.min(target, Math.max(0, (red - 3) / 0.6)); // nobody runs a red, even when impatient
        if (v.turn || v.edge.len - MARGIN - v.t < 15) target = Math.min(target, JUNCTION_SPEED); // ease off at junctions
        v.speed += THREE.MathUtils.clamp(target - v.speed, -BRAKE * dt, ACCEL * dt);

        // Junction standoffs: after 5s, stop yielding to what's merely in view (bodies still can't overlap).
        // Waiting at a red light doesn't count.
        if (v.speed < 0.5 && v.state === 'drive' && red === Infinity) {
            v.stuck += dt;
            if (v.stuck > 5 && v.ghost <= 0) v.ghost = 2;
            if (v.stuck > 20 && Math.hypot(v.x - player.x, v.z - player.z) > 120) return respawn(v), place(v);
        } else v.stuck = 0;

        const swerve = v.kind.danfo ? 5 : 2.5; // danfos cut across abruptly
        const nextOffset = v.offset + THREE.MathUtils.clamp(v.targetOffset - v.offset, -swerve * dt, swerve * dt);

        // Collision: probe next frame's footprint. Never move into another vehicle or the player.
        const ahead = v.speed * dt;
        const sideways = v.turn ? 0 : nextOffset - v.offset;
        const right = v.turn ? { x: 0, z: 0 } : v.edge.right;
        const now = footprint(v);
        const probe = { ...now, x: v.x + Math.sin(v.yaw) * ahead + right.x * sideways, z: v.z + Math.cos(v.yaw) * ahead + right.z * sideways };
        // ponytail: O(n²) with a cheap distance reject; spatial grid if vehicle counts grow
        const blocker = vehicles.find((o) => o !== v && Math.abs(o.x - v.x) + Math.abs(o.z - v.z) < 12 &&
            overlaps(probe, footprint(o)) && !overlaps(now, footprint(o))); // already tangled? let them separate
        const hitPlayer = circleHitsBox(player, playerRadius, probe) && !circleHitsBox(player, playerRadius, now);
        if (blocker || hitPlayer) {
            if (v.speed > CRASH_SPEED) {
                const impact = v.speed;
                crashVehicle(v, impact);
                if (blocker) crashVehicle(blocker, impact);
                else onHitPlayer(impact);
            }
            v.speed = 0;
            return;
        }
        v.offset = nextOffset;

        v.spin += (v.speed * dt) / v.kind.wheelRadius; // wheels roll with the distance covered
        if (v.turn) {
            v.turn.u += (v.speed * dt) / v.turn.len;
            if (v.turn.u >= 1) {
                v.edge = v.turn.next;
                v.lane = v.turn.lane;
                v.t = MARGIN;
                v.offset = v.targetOffset = v.edge.lanes[v.lane];
                v.turn = null;
                plan(v);
            }
        } else {
            v.t += v.speed * dt;
            const atEnd = v.t >= v.edge.len - MARGIN && (v.state === 'drive' || v.state === 'merge');
            // Bridge regulars reappear at the start so the go-slow never empties out
            // ...but only if the restart spot is clear of everyone, including cars turning onto the bridge
            const e0 = v.edge;
            const sx = e0.from.x + e0.dir.x * MARGIN + e0.right.x * v.offset;
            const sz = e0.from.z + e0.dir.z * MARGIN + e0.right.z * v.offset;
            const restart = atEnd && v.loop && e0.lanes === BRIDGE_LANES && !vehicles.some((o) => o !== v && Math.abs(o.x - sx) + Math.abs(o.z - sz) < 14);
            if (restart) {
                v.t = MARGIN;
                v.state = 'drive';
                plan(v);
            } else if (atEnd) {
                v.state = 'drive';
                const { next, lane } = v.plan;
                const e = v.edge;
                // Turning left crosses oncoming traffic: wait at the junction until nothing is coming through
                const oncoming = cross(e.dir, next.dir) < -0.5 && vehicles.some((o) => o !== v && !o.turn && !o.parked && o.edge.to === e.to &&
                    o.edge.dir.x * e.dir.x + o.edge.dir.z * e.dir.z < -0.9 && o.edge.len - o.t < 30 && o.speed > 1);
                if (oncoming) {
                    v.t = e.len - MARGIN;
                    v.speed = 0;
                    place(v);
                    return;
                }
                const p0 = { x: e.from.x + e.dir.x * v.t + e.right.x * v.offset, z: e.from.z + e.dir.z * v.t + e.right.z * v.offset };
                const o2 = next.lanes[lane];
                const p2 = { x: next.from.x + next.dir.x * MARGIN + next.right.x * o2, z: next.from.z + next.dir.z * MARGIN + next.right.z * o2 };
                const curve = turnCurve(p0, e.dir, p2, next.dir);
                v.turn = { curve, len: curve.getLength(), u: 0, next, lane };
            }
        }
        place(v);
    }

    function place(v) {
        if (v.turn) {
            v.turn.curve.getPointAt(Math.min(v.turn.u, 1), pos);
            v.turn.curve.getTangentAt(Math.min(v.turn.u, 1), tangent);
            v.x = pos.x;
            v.z = pos.y;
            v.yaw = Math.atan2(tangent.x, tangent.y);
        } else {
            const e = v.edge;
            v.x = e.from.x + e.dir.x * v.t + e.right.x * v.offset;
            v.z = e.from.z + e.dir.z * v.t + e.right.z * v.offset;
            v.yaw = Math.atan2(e.dir.x, e.dir.z);
        }
        v.object.position.set(v.x, roadHeight(v.x), v.z);
        v.object.rotation.y = v.yaw;
        v.object.rotation.x = -Math.atan(roadSlope(v.x) * Math.sin(v.yaw));
    }

    return {
        vehicles,
        update(dt, player, playerRadius) {
            lightTime += dt;
            updateLights();
            for (const v of vehicles) {
                if (v.parked) continue;
                const gap = gapAhead(v, player);
                updateBehaviour(v, gap, dt);
                move(v, gap, dt, player, playerRadius, onHitPlayer);
            }
            draw(player);
        },
        // Vehicle whose footprint a circle of radius r at (x, z) overlaps, if any
        hit(x, z, r) {
            return vehicles.find((v) => circleHitsBox({ x, z }, r, footprint(v)));
        },
        // Player rammed this vehicle: shove it sideways in its lane and stop it for a few seconds
        knock(v, dirX, dirZ, impact) {
            if (v.parked) return; // parked danfos just take it
            crashVehicle(v, impact);
            if (!v.turn) {
                const push = (dirX * v.edge.right.x + dirZ * v.edge.right.z) * Math.min(impact * 0.08, 1.5);
                v.offset = v.targetOffset = THREE.MathUtils.clamp(v.offset + push, v.edge.lanes[0] - 2, v.edge.kerb);
            }
        },
    };
}
