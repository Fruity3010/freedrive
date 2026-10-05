import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Mainland in the west, Lagos Island in the east, Third Mainland Bridge across the lagoon at z = 0
export const MAINLAND = { x0: -690, x1: -150, z0: -240, z1: 240 };
export const ISLAND = { x0: 450, x1: 870, z0: -240, z1: 240 };
export const SPAWN = { x: -210, z: 0 };
export const BRIDGE_HALF_WIDTH = 16; // dual carriageway, 3 lanes each way
const BRIDGE_HEIGHT = 18;
const RAMP = 100; // length of the climb at each end
export const MEDIAN_HALF = 1;
export const MEDIAN_X0 = MAINLAND.x1 + 30; // median stops short of the ends so you can pick a side
export const MEDIAN_X1 = ISLAND.x0 - 30;
export const LANE_WIDTH = (BRIDGE_HALF_WIDTH - MEDIAN_HALF) / 3;
export const STEP = 60; // block size
export const ROAD = 20; // road width: two lanes each way
export const STOP_LINE = ROAD / 2 + 5; // distance from a junction's centre to the stop line on each approach
const KERB = 0.2; // pavement height
const LOT = (STEP - ROAD - 4) / 2; // half-size of a building lot

const MAINLAND_AREAS = ['Yaba', 'Ikeja', 'Surulere', 'Ebute Metta', 'Oyingbo', 'Maryland', 'Ojota', 'Mushin'];
const ISLAND_AREAS = ['Lekki Phase 1', 'Victoria Island', 'Ikoyi', 'Obalende', 'CMS', 'Oniru', 'Marina', 'Ajah'];

// Placeholder blocks for places, swap for real models later
const PLACES = {
    bank: { label: 'Bank', color: 0x1565c0, h: 14 },
    police: { label: 'Police Station', color: 0x1a237e, h: 10 },
    restaurant: { label: 'Restaurant', color: 0xe65100, h: 6 },
    hospital: { label: 'Hospital', color: 0xf5f5f5, h: 18 },
    filling: { label: 'Filling Station', color: 0xc62828, h: 8 },
    garage: { label: 'Motor Park', color: 0xfbc02d, h: 6 },
    school: { label: 'School', color: 0xfff176, h: 8 },
    church: { label: 'Church', color: 0xd7ccc8, h: 16 },
    mosque: { label: 'Mosque', color: 0x2e7d32, h: 12 },
    market: { label: 'Market', color: 0x8d6e63, h: 5 },
    hotel: { label: 'Hotel', color: 0x6a1b9a, h: 40 },
    busstop: { label: 'Bus Stop', color: 0xfbc02d, h: 3 },
};

const MAINLAND_PLACES = [
    ['bank'], ['bank'], ['bank'], ['police'], ['police'],
    ['restaurant', 'Mama Put'], ['restaurant', 'Amala Joint'], ['restaurant', 'Suya Spot'], ['restaurant', 'Buka'],
    ['busstop', 'Ojuelegba Bus Stop'], ['busstop', 'Yaba Bus Stop'], ['busstop', 'Oshodi Bus Stop'], ['busstop', 'Obanikoro Bus Stop'],
    ['hospital', 'General Hospital'], ['filling'], ['filling'], ['filling'],
    ['garage', 'Ojuelegba Motor Park'], ['garage', 'Oshodi Motor Park'], ['garage', 'Yaba Motor Park'],
    ['market', 'Yaba Market'], ['market', 'Computer Village'], ['market', 'Mile 12 Market'], ['market', 'Oyingbo Market'],
    ['school'], ['school'], ['church'], ['mosque'],
];
const ISLAND_PLACES = [
    ['bank'], ['bank'], ['bank'], ['bank'], ['police'],
    ['restaurant', 'Suya Spot'], ['restaurant', 'Seafood Grill'], ['restaurant', 'Cafe'], ['restaurant', 'Buka'],
    ['busstop', 'Obalende Bus Stop'], ['busstop', 'CMS Bus Stop'], ['busstop', 'Falomo Bus Stop'],
    ['hospital'], ['filling'], ['filling'], ['market', 'Balogun Market'], ['garage', 'Obalende Motor Park'],
    ['school'], ['church'], ['mosque'], ['hotel'], ['hotel'],
];

const solids = []; // building footprints { x, z, hx, hz }
export const DYNAMIC_LAYER = 1; // the camera sees this layer, the water reflection doesn't

const materials = {};
const box = (w, h, d, color) =>
    new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[color] ??= new THREE.MeshStandardMaterial({ color }));

const pick = (a) => a[Math.floor(Math.random() * a.length)];

function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

export function makeLabel(text, scale = 1, color = '#fff') {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const g = canvas.getContext('2d');
    g.fillStyle = 'rgba(0, 0, 0, 0.6)';
    g.fillRect(0, 0, 512, 128);
    g.font = 'bold 52px Arial';
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 64);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas) }));
    sprite.scale.set(24 * scale, 6 * scale, 1);
    return sprite;
}

function addLabel(scene, text, x, y, z, scale, color) {
    const label = makeLabel(text, scale, color);
    label.position.set(x, y, z);
    label.layers.set(DYNAMIC_LAYER);
    scene.add(label);
}

// ---- Surfaces: tiling PBR textures (Poly Haven, CC0) ----

const TILE = 8; // world units per texture repeat
const surfaces = {};
function surface(name, tint = 0xffffff) {
    const key = `${name}:${tint}`;
    if (surfaces[key]) return surfaces[key];
    const loader = new THREE.TextureLoader();
    const tex = (suffix, srgb) => {
        const t = loader.load(`textures/${name}_${suffix}.jpg`);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 8;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        return t;
    };
    return (surfaces[key] = new THREE.MeshStandardMaterial({
        color: tint, map: tex('diff', true), normalMap: tex('nor'), roughnessMap: tex('rough'),
    }));
}

// Stretch a geometry's UVs so the texture tiles at a constant world size
function tiled(geometry, w, h) {
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / TILE, uv.getY(i) * h / TILE);
    return geometry;
}

function flat(scene, w, h, material, x, y, z) {
    const mesh = new THREE.Mesh(tiled(new THREE.PlaneGeometry(w, h), w, h), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    scene.add(mesh);
    return mesh;
}

// One draw call for many flat marks: each item is [x, z, sizeX, sizeZ]
function decals(scene, geometry, material, y, items) {
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    const m = new THREE.Matrix4();
    items.forEach(([x, z, sx, sz], i) => mesh.setMatrixAt(i, m.makeScale(sx, 1, sz).setPosition(x, y, z)));
    mesh.layers.set(DYNAMIC_LAYER); // road paint needn't show in the water's reflection
    scene.add(mesh);
}
const flatSquare = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const flatDisc = new THREE.CircleGeometry(1, 9).rotateX(-Math.PI / 2); // few sides = ragged pothole
const paintMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.6 });
const yellowPaintMat = new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.6 });
const potholeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 1 });
const puddleMat = new THREE.MeshStandardMaterial({ color: 0x35454c, roughness: 0.05, metalness: 0.4 }); // rainwater in the hole
const rimMat = new THREE.MeshStandardMaterial({ color: 0x4a4744, roughness: 1 }); // broken tarmac round the edge
export const potholes = []; // { x, z, r } the bike feels these

// Roadside rubbish, gathered while building and drawn as a few instanced batches at the end
export const trash = { bags: [], bottles: [], sachets: [], cardboard: [], dumps: [], heaps: [] }; // bags, bottles and dumps get downloaded models (props.js)
function rubbish(x, z, size) {
    if (size >= 10) trash.heaps.push([x, 0, z, Math.random() * 6.3, 1]); // big piles get a proper heap of dirty bags in the middle
    for (let i = 0; i < size; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * size * 0.12;
        const s = THREE.MathUtils.randFloat(0.25, 0.4);
        trash.bags.push([x + Math.cos(a) * r, s * 0.6 + Math.random() * size * 0.02, z + Math.sin(a) * r, Math.random() * 3, s, s * 0.8, s * 0.9]);
    }
    for (let i = 0; i < size / 2; i++) trash.bottles.push([x + THREE.MathUtils.randFloatSpread(2), 0.05, z + THREE.MathUtils.randFloatSpread(2), Math.random() * 3, 1, 1, 1]);
    for (let i = 0; i < size; i++) trash.sachets.push([x + THREE.MathUtils.randFloatSpread(3), z + THREE.MathUtils.randFloatSpread(3), 0.18, 0.12]);
    if (Math.random() < 0.5) trash.cardboard.push([x + THREE.MathUtils.randFloatSpread(1.5), 0.04, z + THREE.MathUtils.randFloatSpread(1.5), Math.random() * 3, 0.6, 0.05, 0.45]);
}
// items: [x, y, z, rotY, sx, sy, sz]
function scatter(scene, geometry, material, items, colours) {
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    const o = new THREE.Object3D();
    items.forEach(([x, y, z, ry, sx, sy, sz], i) => {
        o.position.set(x, y, z);
        o.rotation.set(geometry.userData.lying ? Math.PI / 2 : 0, ry, 0);
        o.scale.set(sx, sy, sz);
        o.updateMatrix();
        mesh.setMatrixAt(i, o.matrix);
        if (colours) mesh.setColorAt(i, new THREE.Color(colours()));
    });
    mesh.layers.set(DYNAMIC_LAYER);
    scene.add(mesh);
}
const patchMat = new THREE.MeshStandardMaterial({ color: 0x262626, roughness: 0.9 });

// Lane paint, zebra crossings, potholes and patches along every street of a district
// grime: how rough the district's roads are { holes, patches, rubbish } (chances per few metres of street)
function roadMarkings(scene, d, grime) {
    const paint = [];
    const yellow = [];
    const holes = [];
    const puddles = [];
    const rims = [];
    const patches = [];
    const edge = ROAD / 2 - 0.5;
    const blemish = (x, z) => {
        if (Math.random() < grime.holes) {
            const rx = THREE.MathUtils.randFloat(0.4, 1.2);
            const rz = THREE.MathUtils.randFloat(0.4, 1.2);
            (Math.random() < 0.25 ? puddles : holes).push([x, z, rx, rz]);
            rims.push([x, z, rx * 1.3, rz * 1.3]);
            potholes.push({ x, z, r: Math.max(rx, rz) });
        }
        if (Math.random() < grime.patches) patches.push([x, z, THREE.MathUtils.randFloat(1.5, 4), THREE.MathUtils.randFloat(1.5, 4)]);
    };
    // Rubbish heaped in the gutter by the kerb
    const gutter = (x, z) => Math.random() < grime.rubbish && rubbish(x, z, THREE.MathUtils.randInt(4, 14));
    for (let x = d.x0; x <= d.x1; x += STEP) {
        for (let z = d.z0; z <= d.z1; z += STEP) {
            // Street running along z from this junction
            if (z + STEP <= d.z1) {
                const a = z + STOP_LINE;
                const b = z + STEP - STOP_LINE;
                for (let t = a + 1.5; t < b; t += 6) {
                    paint.push([x - ROAD / 4, t, 0.15, 3], [x + ROAD / 4, t, 0.15, 3]); // lane dividers
                    blemish(x + THREE.MathUtils.randFloatSpread(ROAD - 3), t);
                    gutter(x + (Math.random() < 0.5 ? -1 : 1) * (ROAD / 2 - 0.9), t);
                }
                paint.push([x - edge, (a + b) / 2, 0.15, b - a], [x + edge, (a + b) / 2, 0.15, b - a]);
                yellow.push([x - 0.18, (a + b) / 2, 0.12, b - a], [x + 0.18, (a + b) / 2, 0.12, b - a]); // double yellow centre line
                // Stop lines across the incoming half of the road (traffic keeps right), then zebra crossings
                paint.push([x - ROAD / 4, b, ROAD / 2 - 0.7, 0.5], [x + ROAD / 4, a, ROAD / 2 - 0.7, 0.5]);
                for (let k = -3; k <= 3; k++) paint.push([x + k * 2.6, z + ROAD / 2 + 2.5, 1.2, 3], [x + k * 2.6, z + STEP - ROAD / 2 - 2.5, 1.2, 3]);
            }
            // Street running along x from this junction
            if (x + STEP <= d.x1) {
                const a = x + STOP_LINE;
                const b = x + STEP - STOP_LINE;
                for (let t = a + 1.5; t < b; t += 6) {
                    paint.push([t, z - ROAD / 4, 3, 0.15], [t, z + ROAD / 4, 3, 0.15]); // lane dividers
                    blemish(t, z + THREE.MathUtils.randFloatSpread(ROAD - 3));
                    gutter(t, z + (Math.random() < 0.5 ? -1 : 1) * (ROAD / 2 - 0.9));
                }
                paint.push([(a + b) / 2, z - edge, b - a, 0.15], [(a + b) / 2, z + edge, b - a, 0.15]);
                yellow.push([(a + b) / 2, z - 0.18, b - a, 0.12], [(a + b) / 2, z + 0.18, b - a, 0.12]); // double yellow centre line
                paint.push([b, z + ROAD / 4, 0.5, ROAD / 2 - 0.7], [a, z - ROAD / 4, 0.5, ROAD / 2 - 0.7]); // stop lines
                for (let k = -3; k <= 3; k++) paint.push([x + ROAD / 2 + 2.5, z + k * 2.6, 3, 1.2], [x + STEP - ROAD / 2 - 2.5, z + k * 2.6, 3, 1.2]);
            }
        }
    }
    decals(scene, flatSquare, patchMat, 0.045, patches);
    decals(scene, flatDisc, rimMat, 0.047, rims);
    decals(scene, flatDisc, potholeMat, 0.05, holes);
    decals(scene, flatDisc, puddleMat, 0.05, puddles);
    decals(scene, flatSquare, paintMat, 0.055, paint);
    decals(scene, flatSquare, yellowPaintMat, 0.056, yellow);
}

// ---- Building facades: drawn once per style on a canvas, tiled over every wall ----

const FLOOR = 3.5; // storey height
const FACADE = 12; // texture covers 12 x 12 world units: 4 bays x 4 floors, and 3 repeats span a lot exactly
const facades = {};

function facadeTexture(kind, color) {
    const key = `${kind}:${color}`;
    if (facades[key]) return facades[key];
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const g = canvas.getContext('2d');
    const cell = 128; // one bay x one floor
    const base = new THREE.Color(color);
    const shade = (k) => `#${base.clone().multiplyScalar(k).getHexString()}`;
    const rand = THREE.MathUtils.randFloat;

    if (kind === 'glass') {
        // Curtain wall: glass panels of slightly varying tone, dark mullions, spandrel band per floor
        for (let f = 0; f < 4; f++) {
            for (let b = 0; b < 4; b++) {
                g.fillStyle = shade(rand(0.8, 1.15));
                g.fillRect(b * cell, f * cell, cell, cell);
            }
            g.fillStyle = shade(0.45);
            g.fillRect(0, f * cell + cell - 18, 512, 18);
        }
        g.fillStyle = '#1c2328';
        for (let i = 0; i <= 8; i++) g.fillRect(i * 64 - 2, 0, 4, 512);
    } else if (kind === 'office') {
        // Concrete bands with ribbon windows
        g.fillStyle = shade(1);
        g.fillRect(0, 0, 512, 512);
        for (let f = 0; f < 4; f++) {
            g.fillStyle = '#2d3b44';
            g.fillRect(0, f * cell + 20, 512, cell * 0.55);
            g.fillStyle = shade(0.75);
            for (let i = 0; i <= 8; i++) g.fillRect(i * 64 - 2, f * cell + 20, 4, cell * 0.55);
        }
    } else {
        // Weathered painted plaster, barred windows, AC units, grime streaks
        g.fillStyle = shade(1);
        g.fillRect(0, 0, 512, 512);
        for (let i = 0; i < 60; i++) {
            g.fillStyle = `rgba(60, 45, 30, ${rand(0.02, 0.08)})`;
            g.fillRect(rand(0, 512), rand(0, 512), rand(10, 120), rand(10, 80));
        }
        for (let f = 0; f < 4; f++) {
            g.fillStyle = 'rgba(0, 0, 0, 0.1)';
            g.fillRect(0, f * cell + cell - 6, 512, 6); // floor slab line
            for (let b = 0; b < 4; b++) {
                const x = b * cell + cell * 0.22;
                const y = f * cell + cell * 0.22;
                const w = cell * 0.56;
                const h = cell * 0.5;
                const streak = g.createLinearGradient(0, y + h, 0, y + h + 45);
                streak.addColorStop(0, 'rgba(0, 0, 0, 0.18)');
                streak.addColorStop(1, 'rgba(0, 0, 0, 0)');
                g.fillStyle = streak;
                g.fillRect(x + 4, y + h, w - 8, 45);
                g.fillStyle = shade(1.15);
                g.fillRect(x - 5, y - 5, w + 10, h + 10); // frame
                g.fillStyle = Math.random() < 0.15 ? '#5a6a70' : '#26343b';
                g.fillRect(x, y, w, h);
                g.fillStyle = '#151515'; // burglar-proof bars
                for (let i = 6; i < w; i += 11) g.fillRect(x + i, y, 2, h);
                g.fillRect(x, y + h / 2 - 1, w, 2);
                if (Math.random() < 0.3) {
                    g.fillStyle = '#d6d6d6'; // split AC unit
                    g.fillRect(x + w + 8, y + h * 0.45, 22, 20);
                    g.fillStyle = '#9a9a9a';
                    for (let i = 3; i < 20; i += 4) g.fillRect(x + w + 10, y + h * 0.45 + i, 18, 1);
                }
            }
        }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    const glassy = kind === 'glass';
    return (facades[key] = new THREE.MeshStandardMaterial({ map: tex, roughness: glassy ? 0.15 : 0.9, metalness: glassy ? 0.7 : 0 }));
}

// Box UVs in world units: walls tile the facade from the ground up, the roof tiles concrete
function buildingUVs(geometry, w, h, d) {
    const uv = geometry.attributes.uv;
    const scale = [[d / FACADE, h / FACADE], [d / FACADE, h / FACADE], [w / TILE, d / TILE], [w / TILE, d / TILE], [w / FACADE, h / FACADE], [w / FACADE, h / FACADE]];
    for (let i = 0; i < uv.count; i++) {
        const [su, sv] = scale[Math.floor(i / 4)];
        uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    }
    return geometry;
}

const roofTanks = []; // black plastic water tanks on Lagos rooftops, drawn in one batch

function placeBlock(scene, x, z, height, kind, color) {
    const h = Math.max(FLOOR, Math.round(height / FLOOR) * FLOOR); // whole storeys
    const wall = facadeTexture(kind, color);
    const roof = surface('concrete_pavement', 0x8a8a8a);
    const b = new THREE.Mesh(buildingUVs(new THREE.BoxGeometry(LOT * 2, h, LOT * 2), LOT * 2, h, LOT * 2), [wall, wall, roof, roof, wall, wall]);
    b.position.set(x, h / 2, z);
    scene.add(b);
    solids.push({ x, z, hx: LOT, hz: LOT });
    const tanks = kind === 'plaster' ? THREE.MathUtils.randInt(1, 3) : Math.random() < 0.3 ? 1 : 0;
    for (let i = 0; i < tanks; i++) roofTanks.push([x + THREE.MathUtils.randFloatSpread(LOT * 1.4), h, z + THREE.MathUtils.randFloatSpread(LOT * 1.4)]);
}

function placeEmptyLot(scene, x, z) {
    flat(scene, LOT * 2, LOT * 2, surface('red_laterite_soil_stones'), x, KERB + 0.01, z); // bare Lagos red earth
}

// ---- Lagos street life: filling stations, motor parks, POS stands ----

const signMaterials = {};
// Flat painted sign; identical signs share one material so they merge
function signMaterial(lines, bg, fg) {
    const key = `${lines.join('|')}:${bg}:${fg}`;
    if (signMaterials[key]) return signMaterials[key];
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const g = canvas.getContext('2d');
    g.fillStyle = bg;
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach((line, i) => {
        let size = i === 0 ? 40 : 26;
        do g.font = `bold ${size--}px Arial`; while (g.measureText(line).width > 240 && size > 10); // shrink long names to fit
        g.fillText(line, 128, 128 * (i + 0.5) / lines.length);
    });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return (signMaterials[key] = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide }));
}
function sign(scene, lines, w, h, x, y, z, rotY, bg = '#c62828', fg = '#ffffff') {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), signMaterial(lines, bg, fg));
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    scene.add(mesh);
}
function solidBox(scene, w, h, d, color, x, y, z) {
    const b = box(w, h, d, color);
    b.position.set(x, y, z);
    scene.add(b);
    solids.push({ x, z, hx: w / 2, hz: d / 2 });
    return b;
}

// Invented brands, no real logos
const FUEL_BRANDS = [
    { name: 'EKO OIL', color: 0xc62828, css: '#c62828' },
    { name: 'LAGOON PETROLEUM', color: 0x1565c0, css: '#1565c0' },
    { name: 'NAIJA FUEL', color: 0x2e7d32, css: '#2e7d32' },
];

function placeFillingStation(scene, x, z) {
    const brand = pick(FUEL_BRANDS);
    flat(scene, LOT * 2, LOT * 2, surface('concrete_pavement', 0xc8c8c8), x, KERB + 0.01, z); // forecourt
    // Canopy on four pillars over two pump islands
    const cz = z + 4;
    const canopy = box(26, 1, 14, 0xf2f2f2);
    canopy.position.set(x, 6.7, cz);
    const fascia = box(26.2, 0.7, 14.2, brand.color);
    fascia.position.set(x, 6.1, cz);
    scene.add(canopy, fascia);
    for (const dx of [-9, 9]) for (const dz of [-4, 4]) solidBox(scene, 0.6, 6, 0.6, 0xdedede, x + dx, 3, cz + dz);
    sign(scene, [brand.name], 10, 1.2, x, 6.4, cz + 7.15, 0, brand.css);
    for (const dx of [-4.5, 4.5]) {
        solidBox(scene, 1.2, 0.3, 5, 0x9e9e9e, x + dx, KERB + 0.15, cz);
        for (const dz of [-1.5, 1.5]) {
            const pump = box(0.9, 1.8, 0.6, brand.color);
            pump.position.set(x + dx, KERB + 1.2, cz + dz);
            const screen = box(0.95, 0.45, 0.65, 0x222222);
            screen.position.set(x + dx, KERB + 1.7, cz + dz);
            scene.add(pump, screen);
        }
    }
    // Shop at the back
    const shop = solidBox(scene, 14, 4, 7, 0xffffff, x, 2, z - 14);
    buildingUVs(shop.geometry, 14, 4, 7);
    shop.material = facadeTexture('plaster', 0xf0ece4);
    sign(scene, [brand.name, 'MART'], 5, 1.4, x, 3.4, z - 10.45, 0, brand.css);
    person(x - 3, z + 4, Math.PI / 2, 'idle'); // pump attendant
    // Pole sign with the pump price
    solidBox(scene, 0.4, 9, 0.4, 0x616161, x + 17, 4.5, z + 17);
    sign(scene, [brand.name, 'PMS ₦1,250/L'], 4.5, 3, x + 17, 8.5, z + 17.25, 0, brand.css);
    return brand.name;
}

export const parkedSlots = []; // danfos waiting in motor parks: { x, z, yaw }, drawn by the traffic code

function placeMotorPark(scene, x, z, name) {
    flat(scene, LOT * 2, LOT * 2, surface('red_laterite_soil_stones'), x, KERB + 0.01, z);
    const WALL = 0xd7ccc8;
    const GATE = 10; // entrance on the west side, exit on the east
    for (const sz of [-1, 1]) solidBox(scene, LOT * 2, 2, 0.4, WALL, x, 1, z + sz * LOT);
    const piece = (LOT * 2 - GATE) / 2;
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) solidBox(scene, 0.4, 2, piece, WALL, x + sx * LOT, 1, z + sz * (GATE / 2 + piece / 2));
        // Gate arch with the park's name (entrance) or EXIT
        for (const sz of [-1, 1]) solidBox(scene, 0.5, 6, 0.5, 0x5d4037, x + sx * LOT, 3, z + sz * (GATE / 2 + 0.3));
        sign(scene, sx < 0 ? [name.toUpperCase(), 'ENTRANCE'] : ['EXIT'], GATE, 1.8, x + sx * LOT, 5.4, z, sx * Math.PI / 2, '#fbc02d', '#111111'); // faces out to the road
    }
    // Touts and drivers hanging about; someone always has music on
    person(x - LOT + 3, z + 2, -Math.PI / 2, 'talk');
    person(x - LOT + 3.5, z - 2.5, Math.PI / 2, 'talk');
    person(x + 6, z + 1, 0, 'idle');
    person(x - 4, z - 1, Math.PI, 'dance');
    person(x + 12, z - 13.5, Math.PI, 'idle');
    // Ticket booth with a zinc roof
    solidBox(scene, 4, 2.8, 3, 0x8d6e63, x + 14, 1.4, z - 16);
    const zinc = box(5, 0.15, 4, 0xa0a4a8);
    zinc.position.set(x + 14, 3, z - 16);
    zinc.rotation.x = 0.12;
    scene.add(zinc);
    // Two rows of danfos nose-in to the centre aisle; a few bays empty
    for (const [rz, yaw] of [[-11, 0], [11, Math.PI]]) {
        for (let px = -13.5; px <= 13.5; px += 4.5) {
            if (Math.random() < 0.8) parkedSlots.push({ x: x + px, z: z + rz, yaw });
        }
    }
}

const POS_SIGNS = [['POS'], ['POS', 'CASH OUT'], ['POS', 'TRANSFER'], ['POS', 'WITHDRAWAL']];

// Roadside POS stand on the pavement: umbrella, table, A-board facing the road
function placePOS(scene, bx, bz) {
    const side = Math.floor(Math.random() * 4);
    const along = THREE.MathUtils.randFloatSpread(30);
    const out = LOT + 1.2; // on the pavement strip between building and kerb
    const [x, z, rotY] = [[bx + along, bz + out, 0], [bx + along, bz - out, Math.PI], [bx + out, bz + along, Math.PI / 2], [bx - out, bz + along, -Math.PI / 2]][side];
    asStall(scene, x, z, () => {
        umbrella(scene, x, z, 1.3, 2.4);
        solidBox(scene, 1.1, 0.8, 0.6, 0x6d4c41, x, KERB + 0.4, z);
        sign(scene, pick(POS_SIGNS), 0.9, 0.7, x + Math.sin(rotY) * 1.1, KERB + 0.55, z + Math.cos(rotY) * 1.1, rotY, '#ffffff', '#c62828');
    });
    // Attendant behind the table, facing the road; sometimes a customer at the table
    const fx = Math.sin(rotY);
    const fz = Math.cos(rotY);
    person(x - fx * 0.75, z - fz * 0.75, rotY, pick(['sit', 'sitTalk']));
    if (Math.random() < 0.5) person(x + fx * 0.7 + fz * 0.6, z + fz * 0.7 - fx * 0.6, rotY + Math.PI, 'talk');
}

export const peopleSlots = []; // where NPCs stand, sit or walk; people.js draws the nearest ones
const person = (x, z, yaw, anim, y = KERB, type) => peopleSlots.push({ x, z, y, yaw, anim, type });
const walker = (path, y = KERB, cart = false) => peopleSlots.push({ path, y, anim: 'walk', cart });
const TRAYS = ['snacks', 'drinks', 'fruit'];
const hawker = (path, y) => peopleSlots.push({ path, y, anim: 'walk', tray: pick(TRAYS) });

// ---- Pedestrian overhead footbridges: steel deck over the road, stairs down to each pavement ----

const BRIDGE_BANNERS = [['MIGHTY FIRE', 'CRUSADE'], ['GOD DEY!', 'NO SHAKING'], ['JOLLOF FESTIVAL', 'THIS SATURDAY'], ['NEW NOLLYWOOD', 'IN CINEMAS'], ['CROSS HERE', 'USE THE BRIDGE']];
const DECK_Y = 5.6;
const SPAN = ROAD + 6; // road plus both pavements
const STAIR_RUN = 9; // stairs run along the pavement

const DECK_TOP = DECK_Y + 0.175; // the surface you walk or ride on
const STAIR_W = 2.0;
const DECK_W = 2.6;
const FB_END = ROAD / 2 + 1; // stairs over the middle of each pavement
export const footbridges = []; // { x, z, alongZ }

// Footbridge-local coordinates: local x crosses the road, local z runs along it
const fbLocal = (fb, x, z) => (fb.alongZ ? { lx: x - fb.x, lz: z - fb.z } : { lx: -(z - fb.z), lz: x - fb.x });

// The walkable/rideable surface at (x, z) with a margin r in from the edges: { h, stair } or null
export function footbridgeSurface(x, z, r = 0) {
    let best = null;
    for (const fb of footbridges) {
        if (Math.abs(x - fb.x) > 25 || Math.abs(z - fb.z) > 25) continue;
        const { lx, lz } = fbLocal(fb, x, z);
        if (Math.abs(lx) <= SPAN / 2 - r && Math.abs(lz) <= DECK_W / 2 - r) best = { h: DECK_TOP, stair: false };
        for (const e of [-FB_END, FB_END]) {
            if (Math.abs(lx - e) <= STAIR_W / 2 - r && lz >= 0 && lz <= DECK_W / 2 + STAIR_RUN) { // overlaps the deck so there's no gap at the top
                const t = Math.min(1, Math.max(0, (lz - DECK_W / 2) / STAIR_RUN));
                const h = DECK_TOP + (KERB - DECK_TOP) * t; // a smooth ramp under the steps, for wheels
                if (!best || h > best.h) best = { h, stair: true };
            }
        }
    }
    return best;
}

// Build at (x, z) spanning a street that runs along z (alongZ) or along x
function placeFootbridge(scene, x, z, alongZ) {
    footbridges.push({ x, z, alongZ });
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = alongZ ? 0 : Math.PI / 2; // local x always crosses the road
    const BLUE = 0x1f5fa8; // painted steel
    const CONCRETE = 0xb7b2a8;
    const part = (w, h, d, color, px, py, pz, rx = 0) => {
        const m = box(w, h, d, color);
        m.position.set(px, py, pz);
        m.rotation.x = rx;
        g.add(m);
        return m;
    };
    // Railing along a run from (x0, y0, z0) to (x1, y1, z1): posts every ~1.4 m, a top rail and a mid rail
    const railing = (x0, y0, z0, x1, y1, z1) => {
        const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
        const posts = Math.max(2, Math.round(len / 1.4) + 1);
        for (let i = 0; i < posts; i++) {
            const t = i / (posts - 1);
            part(0.06, 1.05, 0.06, BLUE, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + 0.52, z0 + (z1 - z0) * t);
        }
        for (const hgt of [1.05, 0.55]) {
            const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 6), materials[BLUE] ??= new THREE.MeshStandardMaterial({ color: BLUE }));
            rail.position.set((x0 + x1) / 2, (y0 + y1) / 2 + hgt, (z0 + z1) / 2);
            rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0).normalize());
            g.add(rail);
        }
    };

    // Deck: concrete walkway on two blue girders
    part(SPAN, 0.2, DECK_W, CONCRETE, 0, DECK_TOP - 0.1, 0);
    for (const sz of [-1, 1]) {
        part(SPAN, 0.55, 0.18, BLUE, 0, DECK_TOP - 0.45, sz * (DECK_W / 2 - 0.05));
        railing(-SPAN / 2, DECK_TOP, sz * (DECK_W / 2 - 0.08), SPAN / 2, DECK_TOP, sz * (DECK_W / 2 - 0.08));
    }
    // Banner in a frame on each side, centred over the road
    const banner = pick(BRIDGE_BANNERS);
    const bannerMat = signMaterial(banner, '#fbc02d', '#1a237e');
    for (const sz of [-1, 1]) {
        part(8.3, 1.65, 0.08, BLUE, 0, DECK_TOP - 1.25, sz * (DECK_W / 2 + 0.05));
        const b = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.4), bannerMat);
        b.position.set(0, DECK_TOP - 1.25, sz * (DECK_W / 2 + 0.1));
        if (sz < 0) b.rotation.y = Math.PI;
        g.add(b);
    }
    // Each end: concrete pillars with a crossbeam, then a flight of steps down along the pavement
    const toWorld = (lx, lz) => (alongZ ? { x: x + lx, z: z + lz } : { x: x + lz, z: z - lx });
    for (const e of [-FB_END, FB_END]) {
        for (const sz of [-1, 1]) {
            part(0.45, DECK_TOP - 0.7, 0.45, CONCRETE, e, (DECK_TOP - 0.7) / 2, sz * (DECK_W / 2 - 0.3));
            const p = toWorld(e, sz * (DECK_W / 2 - 0.3));
            solids.push({ x: p.x, z: p.z, hx: 0.3, hz: 0.3, top: DECK_TOP - 1 }); // ride over it on the deck
        }
        part(0.5, 0.4, DECK_W, CONCRETE, e, DECK_TOP - 0.85, 0);
        // Steps: a sloped slab with treads on top, blue stringers and handrails on both sides
        const slope = Math.atan2(DECK_TOP - KERB, STAIR_RUN);
        const midZ = DECK_W / 2 + STAIR_RUN / 2;
        part(STAIR_W, 0.25, Math.hypot(DECK_TOP - KERB, STAIR_RUN), CONCRETE, e, (DECK_TOP + KERB) / 2 - 0.15, midZ, slope);
        const treads = 18;
        for (let i = 0; i < treads; i++) {
            const t = (i + 0.5) / treads;
            part(STAIR_W - 0.1, 0.06, STAIR_RUN / treads + 0.02, 0x9e9a92, e, DECK_TOP + (KERB - DECK_TOP) * t + 0.02, DECK_W / 2 + STAIR_RUN * t);
        }
        for (const sx of [-1, 1]) {
            const ex = e + sx * (STAIR_W / 2);
            part(0.12, 0.35, Math.hypot(DECK_TOP - KERB, STAIR_RUN), BLUE, ex, (DECK_TOP + KERB) / 2, midZ, slope);
            railing(ex, DECK_TOP, DECK_W / 2, ex, KERB, DECK_W / 2 + STAIR_RUN);
        }
    }
    scene.add(g);
    // People crossing: up one flight, over, down the other, and back again
    const at = (lx, h, lz) => ({ ...toWorld(lx, lz), y: h });
    const route = [at(-FB_END, KERB, DECK_W / 2 + STAIR_RUN), at(-FB_END, DECK_TOP, DECK_W / 2), at(-FB_END, DECK_TOP, 0), at(FB_END, DECK_TOP, 0), at(FB_END, DECK_TOP, DECK_W / 2), at(FB_END, KERB, DECK_W / 2 + STAIR_RUN)];
    for (let i = 0; i < 3; i++) peopleSlots.push({ path: [...route, ...route.slice(1, -1).reverse()], y: KERB, anim: 'walk' });
}

// Hawkers work the queues: up and down between the two lanes waiting at red lights, and in the bridge go-slow
function placeHawkers(d, count) {
    for (let i = 0; i < count; i++) {
        const x = d.x0 + STEP * THREE.MathUtils.randInt(1, Math.round((d.x1 - d.x0) / STEP) - 1);
        const z = d.z0 + STEP * THREE.MathUtils.randInt(1, Math.round((d.z1 - d.z0) / STEP) - 1);
        const side = Math.random() < 0.5 ? -1 : 1;
        const back = THREE.MathUtils.randFloat(20, 30);
        if (Math.random() < 0.5) {
            // On the lane divider of a street running along z, from the stop line back along the queue
            const lx = x - side * (ROAD / 4); // the incoming lanes (traffic keeps right)
            const z0 = z - side * STOP_LINE;
            hawker([{ x: lx, z: z0 }, { x: lx, z: z0 - side * back }], 0);
        } else {
            const lz = z - side * (ROAD / 4);
            const x0 = x + side * STOP_LINE;
            hawker([{ x: x0, z: lz }, { x: x0 + side * back, z: lz }], 0);
        }
    }
}

// ---- Market stalls: wooden tables, striped umbrellas in tyre bases, zinc sheds, real goods ----

const canvasMaterial = (w, h, draw, extra = {}) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    draw(canvas.getContext('2d'), w, h);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    return new THREE.MeshStandardMaterial({ map, roughness: 0.85, ...extra });
};
const rand = THREE.MathUtils.randFloat;

const woodMaterial = canvasMaterial(256, 128, (g, w, h) => {
    g.fillStyle = '#8a6440';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 300; i++) {
        g.fillStyle = `rgba(${rand(40, 90)}, ${rand(25, 50)}, 10, 0.15)`;
        g.fillRect(rand(0, w), rand(0, h), rand(20, 90), 1); // grain
    }
    g.fillStyle = 'rgba(40, 25, 10, 0.6)';
    for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 2); // plank gaps
});

const zincMaterial = canvasMaterial(128, 128, (g, w, h) => {
    for (let x = 0; x < w; x++) {
        const ridge = 150 + 60 * Math.sin((x / w) * Math.PI * 16); // corrugation
        g.fillStyle = `rgb(${ridge}, ${ridge + 4}, ${ridge + 8})`;
        g.fillRect(x, 0, 1, h);
    }
    for (let i = 0; i < 25; i++) {
        g.fillStyle = `rgba(${rand(120, 160)}, ${rand(55, 80)}, 20, ${rand(0.15, 0.4)})`; // rust
        g.beginPath();
        g.arc(rand(0, w), rand(0, h), rand(3, 14), 0, Math.PI * 2);
        g.fill();
    }
}, { metalness: 0.4, roughness: 0.6, side: THREE.DoubleSide });

// Ankara wax prints: bold motifs in three colours
const ANKARA_PALETTES = [['#f9a825', '#1565c0', '#c62828'], ['#2e7d32', '#ff7043', '#fdd835'], ['#6a1b9a', '#f57c00', '#fff8e1'], ['#00838f', '#ad1457', '#ffeb3b'], ['#c62828', '#212121', '#ffffff'], ['#1a237e', '#ffb300', '#43a047']];
const ankara = ANKARA_PALETTES.map(([bg, a, b]) => canvasMaterial(128, 128, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 32) {
        for (let x = 0; x < 128; x += 32) {
            const ox = (y / 32) % 2 ? 16 : 0;
            g.fillStyle = a;
            g.beginPath();
            g.arc(x + ox + 16, y + 16, 11, 0, Math.PI * 2);
            g.fill();
            g.fillStyle = b;
            g.beginPath();
            g.moveTo(x + ox + 16, y + 9);
            g.lineTo(x + ox + 23, y + 16);
            g.lineTo(x + ox + 16, y + 23);
            g.lineTo(x + ox + 9, y + 16);
            g.fill();
        }
    }
}, { side: THREE.DoubleSide }));

const UMBRELLA_STRIPES = [['#c62828', '#ffffff'], ['#1565c0', '#ffffff'], ['#f9a825', '#2e7d32'], ['#ffcc00', '#ffcc00'], ['#e65100', '#fff3e0'], ['#2e7d32', '#ffffff']];
const umbrellaMaterials = UMBRELLA_STRIPES.map(([a, b]) => canvasMaterial(256, 16, (g) => {
    for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? a : b;
        g.fillRect(i * 32, 0, 32, 16);
        g.fillStyle = 'rgba(0, 0, 0, 0.35)';
        g.fillRect(i * 32, 0, 2, 16); // rib seam
    }
}, { side: THREE.DoubleSide, roughness: 0.9 }));

const shape = (geometry, material, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    return m;
};
const mat = (color) => (materials[color] ??= new THREE.MeshStandardMaterial({ color }));

// Striped market umbrella on a pole standing in a concrete-filled tyre
function umbrella(scene, x, z, radius = 1.6, height = 2.6) {
    const cloth = pick(umbrellaMaterials);
    scene.add(
        shape(new THREE.ConeGeometry(radius, radius * 0.45, 16, 1, true), cloth, x, KERB + height, z),
        shape(new THREE.CylinderGeometry(radius, radius, 0.14, 16, 1, true), cloth, x, KERB + height - radius * 0.225 - 0.06, z), // valance
        shape(new THREE.CylinderGeometry(0.03, 0.03, height, 6), mat(0x9e9e9e), x, KERB + height / 2, z),
        shape(new THREE.TorusGeometry(0.26, 0.1, 6, 12), mat(0x1a1a1a), x, KERB + 0.1, z, Math.PI / 2), // tyre
        shape(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 10), mat(0x8a8a8a), x, KERB + 0.08, z), // concrete
    );
}

function zincShed(scene, x, z, w = 4.8, d = 3.2) {
    scene.add(shape(new THREE.BoxGeometry(w, 0.04, d), zincMaterial, x, KERB + 2.6, z, -0.12));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) scene.add(shape(new THREE.BoxGeometry(0.1, 2.6, 0.1), woodMaterial, x + sx * (w / 2 - 0.2), KERB + 1.3 + sz * 0.15, z + sz * (d / 2 - 0.2)));
}

// Plank table on four legs; returns the height of its top
function table(scene, x, z, w = 3.6, d = 1.4, h = 0.85) {
    scene.add(shape(new THREE.BoxGeometry(w, 0.06, d), woodMaterial, x, KERB + h, z));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) scene.add(shape(new THREE.BoxGeometry(0.07, h, 0.07), woodMaterial, x + sx * (w / 2 - 0.1), KERB + h / 2, z + sz * (d / 2 - 0.1)));
    solids.push({ x, z, hx: w / 2, hz: d / 2 });
    return KERB + h + 0.03;
}

const ball = new THREE.SphereGeometry(1, 7, 5);
// A heap of round produce: rings shrinking upwards
function heap(scene, x, y, z, color, r, rings = 3) {
    for (let ring = 0; ring < rings; ring++) {
        const n = ring === rings - 1 ? 1 : (rings - ring) * 4;
        const spread = (rings - ring - 1) * r * 1.7;
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + ring;
            const m = shape(ball, mat(color), x + Math.cos(a) * spread, y + r + ring * r * 1.5, z + Math.sin(a) * spread);
            m.scale.setScalar(r * rand(0.85, 1.1));
            scene.add(m);
        }
    }
}
function basket(scene, x, y, z, color, r) {
    scene.add(shape(new THREE.CylinderGeometry(0.36, 0.28, 0.16, 12), mat(0xc9a66b), x, y + 0.08, z)); // raffia basket
    heap(scene, x, y + 0.12, z, color, r);
}

const PRODUCE = [[0xd32f2f, 0.075], [0xff5722, 0.05], [0x8e4a6e, 0.08], [0xff9800, 0.08], [0x7cb342, 0.065], [0xb71c1c, 0.05]]; // tomato, pepper, onion, orange, lime, scotch bonnet
function produceStall(scene, x, z) {
    const top = table(scene, x, z);
    for (let i = -1.5; i <= 1.5; i += 1) basket(scene, x + i * 0.95, top, z + rand(-0.15, 0.15), ...pick(PRODUCE));
    // Plantain bunches at one end, yams and watermelons on the ground in front
    for (let i = 0; i < 6; i++) scene.add(shape(new THREE.CylinderGeometry(0.035, 0.03, 0.32, 6), mat(Math.random() < 0.5 ? 0xc0ca33 : 0xfdd835), x + 1.5 + rand(-0.1, 0.1), top + 0.05, z - 0.45 + i * 0.05, Math.PI / 2, 0, rand(-0.5, 0.5)));
    for (let i = 0; i < 5; i++) scene.add(shape(new THREE.CapsuleGeometry(0.09, 0.45, 3, 6), mat(0x6d4c33), x - 1.2 + i * 0.22, KERB + 0.1 + (i % 2) * 0.12, z + 0.95, 0, 0, Math.PI / 2 + rand(-0.2, 0.2)));
    for (let i = 0; i < 2; i++) {
        const melon = shape(ball, mat(0x2e7d32), x + 0.6 + i * 0.55, KERB + 0.2, z + 1.0);
        melon.scale.set(0.3, 0.22, 0.22);
        scene.add(melon);
    }
}

const chunk = new THREE.DodecahedronGeometry(1, 0);
function meatStall(scene, x, z) {
    const top = table(scene, x, z);
    for (let i = 0; i < 9; i++) {
        const cut = shape(chunk, mat(Math.random() < 0.8 ? pick([0x6e1c1c, 0x7d2424, 0x5c1818]) : 0xcfae98), x + rand(-1.4, 1.0), top + 0.06, z + rand(-0.45, 0.45), rand(0, 3), rand(0, 3), rand(0, 3));
        cut.scale.set(rand(0.12, 0.22), rand(0.06, 0.1), rand(0.1, 0.16));
        scene.add(cut);
    }
    scene.add(shape(new THREE.CylinderGeometry(0.28, 0.3, 0.25, 12), woodMaterial, x + 1.35, top + 0.12, z)); // chopping block
    scene.add(shape(new THREE.BoxGeometry(0.02, 0.12, 0.28), mat(0xb0bec5), x + 1.35, top + 0.3, z, 0, 0.6, 0)); // cleaver
    // Hanging rail behind the table with cuts on hooks
    for (const sx of [-1.7, 1.7]) scene.add(shape(new THREE.BoxGeometry(0.08, 2.2, 0.08), woodMaterial, x + sx, KERB + 1.1, z - 0.8));
    scene.add(shape(new THREE.CylinderGeometry(0.03, 0.03, 3.4, 6), mat(0x757575), x, KERB + 2.1, z - 0.8, 0, 0, Math.PI / 2));
    for (let i = 0; i < 5; i++) {
        const hx = x - 1.3 + i * 0.65;
        scene.add(shape(new THREE.CylinderGeometry(0.01, 0.01, 0.25, 4), mat(0x9e9e9e), hx, KERB + 1.95, z - 0.8));
        const hanging = shape(chunk, mat(pick([0x6a1a1a, 0x7a2222])), hx, KERB + 1.6, z - 0.8, rand(0, 1), rand(0, 3), 0);
        hanging.scale.set(0.16, 0.32, 0.12);
        scene.add(hanging);
    }
}

// Shirt and gown silhouettes for the clothes rail
const tee = new THREE.Shape([[-0.25, 0], [0.25, 0], [0.25, 0.5], [0.42, 0.42], [0.5, 0.55], [0.2, 0.72], [-0.2, 0.72], [-0.5, 0.55], [-0.42, 0.42], [-0.25, 0.5]].map(([a, b]) => new THREE.Vector2(a, b)));
const teeGeometry = new THREE.ExtrudeGeometry(tee, { depth: 0.03, bevelEnabled: false });
const gown = new THREE.Shape([[-0.35, -0.6], [0.35, -0.6], [0.22, 0.5], [0.38, 0.62], [0.18, 0.72], [-0.18, 0.72], [-0.38, 0.62], [-0.22, 0.5]].map(([a, b]) => new THREE.Vector2(a, b)));
const gownGeometry = new THREE.ExtrudeGeometry(gown, { depth: 0.03, bevelEnabled: false });
function clothesStall(scene, x, z) {
    const top = table(scene, x, z);
    for (let i = -1.3; i <= 1.3; i += 0.65) {
        for (let k = 0; k < THREE.MathUtils.randInt(3, 6); k++) scene.add(shape(new THREE.BoxGeometry(0.5, 0.07, 0.38), pick(ankara), x + i, top + 0.035 + k * 0.07, z + rand(-0.2, 0.2), 0, rand(-0.2, 0.2), 0)); // folded wax prints
    }
    for (const sx of [-1.7, 1.7]) scene.add(shape(new THREE.BoxGeometry(0.06, 2.2, 0.06), mat(0x616161), x + sx, KERB + 1.1, z - 0.85));
    scene.add(shape(new THREE.CylinderGeometry(0.025, 0.025, 3.4, 6), mat(0x9e9e9e), x, KERB + 2.15, z - 0.85, 0, 0, Math.PI / 2));
    for (let i = 0; i < 6; i++) {
        const isGown = Math.random() < 0.4;
        scene.add(shape(isGown ? gownGeometry : teeGeometry, pick(ankara), x - 1.4 + i * 0.56, KERB + (isGown ? 1.38 : 1.4), z - 0.87, 0, rand(-0.25, 0.25), 0));
    }
}

// ---- Breakable stalls: built like any static scenery, but remembered so they can be smashed later ----

export const stalls = []; // { x, z, solids, parts, ranges, broken }
function asStall(scene, x, z, build) {
    const id = stalls.length;
    const firstChild = scene.children.length;
    const firstSolid = solids.length;
    build();
    const stall = { x, z, solids: solids.slice(firstSolid), parts: [], ranges: [], broken: false };
    for (const o of scene.children.slice(firstChild)) o.traverse((m) => m.isMesh && (m.userData.stall = id));
    for (const solid of stall.solids) solid.stall = id;
    stalls.push(stall);
}

// Intact stall whose footprint a circle at (x, z) touches, or -1
export function stallHit(x, z, r) {
    const hit = solids.find((b) => b.stall !== undefined && Math.abs(x - b.x) < b.hx + r && Math.abs(z - b.z) < b.hz + r);
    return hit ? hit.stall : -1;
}

// Remove a stall from the merged scenery and its collision; returns its pieces for the debris to use
export function breakStall(id) {
    const stall = stalls[id];
    if (stall.broken) return null;
    stall.broken = true;
    for (const { mesh, start, count } of stall.ranges) {
        const pos = mesh.geometry.attributes.position;
        for (let i = start; i < start + count; i++) pos.setXYZ(i, 0, -50, 0); // collapse its triangles out of sight
        pos.needsUpdate = true;
    }
    for (const solid of stall.solids) solids.splice(solids.indexOf(solid), 1);
    return stall;
}

const SECTIONS = { '-14': meatStall, '-5': produceStall, '4': produceStall, '13': clothesStall }; // rows of the market

// Open-air market in sections: meat, fruit and veg, clothes. Traders at their stalls, shoppers in the aisles
function placeMarket(scene, x, z, name) {
    flat(scene, LOT * 2, LOT * 2, surface('red_laterite_soil_stones'), x, KERB + 0.01, z);
    for (const rz of [-14, -5, 4, 13]) {
        for (const rx of [-15, -9, -3, 3, 9, 15]) {
            const sx = x + rx;
            const sz = z + rz;
            asStall(scene, sx, sz, () => {
                SECTIONS[rz](scene, sx, sz);
                if (SECTIONS[rz] === produceStall && Math.random() < 0.6) umbrella(scene, sx, sz - 0.3, 2);
                else zincShed(scene, sx, sz - 0.2);
            });
            person(sx + rand(-1.2, 1.2), sz - 1.4, 0, pick(['sit', 'sitTalk'])); // trader faces the aisle
            if (Math.random() < 0.35) person(sx + rand(-1, 1), sz + 1.5, Math.PI, 'talk'); // haggling
        }
        // Shoppers strolling the aisle in front of this row
        for (let i = 0; i < 3; i++) {
            const az = z + rz + 3.2;
            walker(Math.random() < 0.5 ? [{ x: x - 18, z: az }, { x: x + 18, z: az }] : [{ x: x + 18, z: az }, { x: x - 18, z: az }]);
        }
    }
    sign(scene, [name.toUpperCase()], 8, 1.6, x, 4, z + LOT + 0.8, 0, '#2e7d32');
    solidBox(scene, 0.3, 4, 0.3, 0x5d4037, x - 4, 2, z + LOT + 0.8);
    solidBox(scene, 0.3, 4, 0.3, 0x5d4037, x + 4, 2, z + LOT + 0.8);
}

export const places = []; // every named place { kind, name, x, z }: landmarks now, delivery stops later

// ---- Police: officers in black at the stations and checkpoints (visual for now; no arrests yet) ----

const barrelMaterial = canvasMaterial(16, 128, (g) => {
    for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? '#ffffff' : '#ef6c00';
        g.fillRect(0, i * 16, 16, 16);
    }
});
const barrelGeometry = new THREE.CylinderGeometry(0.3, 0.32, 0.95, 10);

// A line of orange-and-white barrels from (x0, z0) along (dx, dz), with a sign on a post at the start
function checkpoint(scene, x0, z0, dx, dz, count, signYaw) {
    for (let i = 0; i < count; i++) {
        const x = x0 + dx * i * 2.4;
        const z = z0 + dz * i * 2.4;
        scene.add(shape(barrelGeometry, barrelMaterial, x, roadHeight(x) + 0.48, z));
        solids.push({ x, z, hx: 0.3, hz: 0.3 });
    }
    scene.add(shape(new THREE.BoxGeometry(0.12, 2.2, 0.12), mat(0x424242), x0 - dx * 2, roadHeight(x0) + 1.1, z0 - dz * 2));
    sign(scene, ['POLICE', 'CHECKPOINT'], 2.4, 1.2, x0 - dx * 2, roadHeight(x0) + 2.2, z0 - dz * 2, signYaw, '#111111', '#ffffff');
}

// Officers out front of a police station, and a checkpoint on the road edge beside it
function placePoliceStation(scene, x, z) {
    const front = z + LOT + 1.2;
    person(x - 4, front, 0, 'idle', KERB, 'police');
    person(x + 4, front, 0, 'idle', KERB, 'police');
    person(x + 9, front + 1.4, 0, 'wave', KERB, 'police'); // flagging down traffic
    checkpoint(scene, x + 2, z + LOT + 1.0, 1, 0, 6, 0);
}

function placePlace(scene, x, z, [kind, name]) {
    const p = PLACES[kind];
    if (kind === 'market') {
        placeMarket(scene, x, z, name);
    } else if (kind === 'filling') {
        name = placeFillingStation(scene, x, z);
    } else if (kind === 'garage') {
        placeMotorPark(scene, x, z, name);
    } else if (kind === 'busstop') {
        for (let i = 0; i < 4; i++) person(x + THREE.MathUtils.randFloatSpread(7), z + LOT - 2 + THREE.MathUtils.randFloat(-1, 0.5), 0, pick(['idle', 'talk', 'idle']));
        // Open lot with a shelter at the roadside, drivable
        placeEmptyLot(scene, x, z);
        const roof = box(8, 0.3, 3, p.color);
        roof.position.set(x, p.h, z + LOT - 2);
        const back = box(8, p.h, 0.3, 0x424242);
        back.position.set(x, p.h / 2, z + LOT - 0.5);
        scene.add(roof, back);
    } else {
        placeBlock(scene, x, z, p.h, kind === 'bank' || kind === 'hotel' ? 'glass' : 'plaster', p.color);
        if (kind === 'police') placePoliceStation(scene, x, z);
    }
    addLabel(scene, name || p.label, x, p.h + 5, z, 0.8, '#ffeb3b');
    places.push({ kind, name: name || p.label, x, z });
}

function buildDistrict(scene, d, areas, places, minH, maxH, styles, posStands, walkers, grime) {
    const w = d.x1 - d.x0;
    const l = d.z1 - d.z0;
    const cx = (d.x0 + d.x1) / 2;
    const cz = (d.z0 + d.z1) / 2;

    const land = box(w + ROAD, 2, l + ROAD, 0x8d8a6e);
    land.position.set(cx, -1, cz);
    scene.add(land);

    const asphalt = surface('asphalt_02', 0xb0b0b0);
    const intersections = [];
    for (let x = d.x0; x <= d.x1; x += STEP) {
        flat(scene, ROAD, l + ROAD, asphalt, x, 0.02, cz);
        for (let z = d.z0; z <= d.z1; z += STEP) intersections.push({ x, z });
    }
    for (let z = d.z0; z <= d.z1; z += STEP) flat(scene, w + ROAD, ROAD, asphalt, cx, 0.03, z);
    roadMarkings(scene, d, grime);

    const blocks = [];
    for (let bx = d.x0; bx < d.x1; bx += STEP) {
        for (let bz = d.z0; bz < d.z1; bz += STEP) blocks.push({ x: bx + STEP / 2, z: bz + STEP / 2 });
    }
    // Raised concrete pavement with a kerb around every block
    const paving = surface('concrete_pavement');
    for (const b of blocks) {
        const size = STEP - ROAD;
        const kerb = new THREE.Mesh(tiled(new THREE.BoxGeometry(size, KERB, size), size, size), paving);
        kerb.position.set(b.x, KERB / 2, b.z);
        scene.add(kerb);
    }
    shuffle(blocks).forEach((b, i) => {
        if (i < places.length) placePlace(scene, b.x, b.z, places[i]);
        else if (Math.random() < 0.75) placeBlock(scene, b.x, b.z, THREE.MathUtils.randFloat(minH, maxH), ...pick(styles));
        else {
            placeEmptyLot(scene, b.x, b.z);
            if (Math.random() < grime.dumps) {
                const dx = b.x + THREE.MathUtils.randFloatSpread(20);
                const dz = b.z + THREE.MathUtils.randFloatSpread(20);
                trash.dumps.push([dx, KERB, dz, Math.random() * 6.3, 1]);
                rubbish(dx, dz, 25); // refuse dump: a heap with bags all round it
            }
        }
    });

    for (let i = 0; i < posStands; i++) placePOS(scene, ...Object.values(pick(blocks)));
    // Pedestrians looping the pavement around random blocks, either direction
    for (let i = 0; i < walkers; i++) {
        const b = pick(blocks);
        const r = LOT + 1.6;
        const corners = [{ x: b.x - r, z: b.z - r }, { x: b.x + r, z: b.z - r }, { x: b.x + r, z: b.z + r }, { x: b.x - r, z: b.z + r }];
        walker(Math.random() < 0.5 ? corners : corners.reverse(), KERB, i < grime.barrows); // the first few push wheelbarrows
    }

    // Neighbourhood names on random intersections
    const spots = shuffle(intersections).slice(0, areas.length).map((p, i) => ({ ...p, name: areas[i] }));
    for (const s of spots) addLabel(scene, s.name, s.x, 12, s.z, 0.6);
    return spots;
}

// Deck height along the bridge: 0 at both shores, smooth ramps up to BRIDGE_HEIGHT
export function roadHeight(x) {
    const d = Math.min(x - MAINLAND.x1, ISLAND.x0 - x);
    if (d <= 0) return 0;
    const t = Math.min(d / RAMP, 1);
    return BRIDGE_HEIGHT * t * t * (3 - 2 * t);
}
export const roadSlope = (x) => roadHeight(x + 0.5) - roadHeight(x - 0.5);

function buildBridge(scene) {
    // Built from short tilted segments so the deck follows the ramps
    const SEG = RAIL_SEG;
    for (let x = MAINLAND.x1; x < ISLAND.x0; x += SEG) {
        const y0 = roadHeight(x);
        const y1 = roadHeight(x + SEG);
        const len = Math.hypot(SEG, y1 - y0) + 0.2;
        const seg = new THREE.Group();
        seg.position.set(x + SEG / 2, (y0 + y1) / 2, 0);
        seg.rotation.z = Math.atan2(y1 - y0, SEG);

        const deck = new THREE.Mesh(tiled(new THREE.BoxGeometry(len, 1.2, BRIDGE_HALF_WIDTH * 2 + 2), len, BRIDGE_HALF_WIDTH * 2 + 2), surface('asphalt_02', 0x9a9a9a));
        deck.position.y = -0.57;
        seg.add(deck);
        seg.updateMatrix();
        for (const side of [-1, 1]) {
            const local = new THREE.Matrix4().makeTranslation(0, 0.6, side * (BRIDGE_HALF_WIDTH + 0.3)).scale(new THREE.Vector3(len, 1, 1));
            rails.set(railKey(x, side), railMatrices.push(seg.matrix.clone().multiply(local)) - 1);
        }
        if (x >= MEDIAN_X0 && x + SEG <= MEDIAN_X1) {
            const median = box(len, 1, MEDIAN_HALF * 2, 0xbdbdbd);
            median.position.y = 0.5;
            seg.add(median);
        }
        scene.add(seg);
    }
    railMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1.2, 0.6), new THREE.MeshStandardMaterial({ color: 0xbdbdbd }), railMatrices.length);
    railMatrices.forEach((m, i) => railMesh.setMatrixAt(i, m));
    scene.add(railMesh);

    // Dashed lane lines
    const dashGeo = new THREE.BoxGeometry(4, 0.05, 0.25);
    const dashMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    for (let x = MAINLAND.x1 + 5; x < ISLAND.x0; x += 12) {
        for (const side of [-1, 1]) {
            for (const lane of [1, 2]) {
                const dash = new THREE.Mesh(dashGeo, dashMat);
                dash.position.set(x, roadHeight(x) + 0.06, side * (MEDIAN_HALF + lane * LANE_WIDTH));
                dash.rotation.z = Math.atan(roadSlope(x));
                scene.add(dash);
            }
        }
    }

    // Lamps on the median
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffcc66, emissiveIntensity: 1 });
    for (let x = MEDIAN_X0 + 10; x < MEDIAN_X1; x += 40) {
        const y = roadHeight(x);
        const pole = box(0.4, 9, 0.4, 0x616161);
        pole.position.set(x, y + 5.5, 0);
        const arm = box(0.2, 0.2, 7, 0x616161);
        arm.position.set(x, y + 10, 0);
        scene.add(pole, arm);
        for (const side of [-1, 1]) {
            const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.4, 1.2), lampMat);
            lamp.position.set(x, y + 9.8, side * 3.4);
            scene.add(lamp);
        }
    }

    // Pillars from the lagoon bed up to the deck, two rows plus a crossbeam
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x9e9e9e });
    for (let x = MAINLAND.x1 + 15; x < ISLAND.x0; x += 30) {
        const top = roadHeight(x) - 1.2;
        if (top < 1) continue;
        for (const side of [-1, 1]) {
            const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, top + 6), pillarMat);
            pillar.position.set(x, (top - 6) / 2, side * 9);
            scene.add(pillar);
        }
        const beam = box(2.4, 1.6, 22, 0x9e9e9e);
        beam.position.set(x, top - 0.8, 0);
        scene.add(beam);
    }

    for (const x of [MAINLAND.x1 + 20, ISLAND.x0 - 20]) addLabel(scene, 'THIRD MAINLAND BRIDGE', x, roadHeight(x) + 14, 0, 1.2, '#ffeb3b');

    // Police checkpoints at both ends of the bridge: barrels along each edge, officers among them
    for (const x of [MAINLAND.x1 + 30, ISLAND.x0 - 42]) {
        for (const side of [-1, 1]) {
            const z = side * (BRIDGE_HALF_WIDTH - 0.6);
            checkpoint(scene, x, z, 1, 0, 5, side > 0 ? Math.PI : 0);
            person(x + 3.6, z, side > 0 ? Math.PI : 0, 'wave', roadHeight(x + 3.6), 'police');
            person(x + 8.4, z, side > 0 ? Math.PI : 0, 'idle', roadHeight(x + 8.4), 'police');
        }
    }
}

// Bridge rails, one piece per segment and side. Smash through one fast enough and you're in the lagoon.
const RAIL_SEG = 10;
const rails = new Map(); // "segment,side" -> instance index in railMesh, deleted once broken
const railMatrices = [];
let railMesh = null; // all rail pieces in one draw call
const railKey = (x, side) => `${Math.floor((x - MAINLAND.x1) / RAIL_SEG)},${side}`;

// Which bridge rail (+1 / -1) a vehicle of radius r at (x, z) would hit, or 0
export function railHit(x, z, r) {
    if (x <= MAINLAND.x1 || x >= ISLAND.x0 || Math.abs(z) <= BRIDGE_HALF_WIDTH - r) return 0;
    return Math.sign(z);
}
export const railBroken = (x, side) => !rails.has(railKey(x, side));
export function breakRail(x, side) {
    const index = rails.get(railKey(x, side));
    if (index === undefined) return;
    railMesh.setMatrixAt(index, new THREE.Matrix4().makeScale(0, 0, 0)); // hide that piece
    railMesh.instanceMatrix.needsUpdate = true;
    rails.delete(railKey(x, side));
}

// Merge the static city into one mesh per material per CHUNK-sized square: a few hundred draw calls
// instead of thousands, while chunks behind the camera still get culled.
const CHUNK = 250;
const REFLECT_ABOVE = 6; // only scenery taller than this shows in the water; low stuff can't be seen in it anyway
function mergeStatic(root) {
    root.updateMatrixWorld(true);
    const buckets = new Map();
    const add = (material, chunk, geometry, stall) => {
        geometry.computeBoundingBox();
        const low = geometry.boundingBox.max.y < REFLECT_ABOVE;
        const key = `${material.uuid}|${chunk}|${low}`;
        if (!buckets.has(key)) buckets.set(key, { material, geometries: [], owners: [], low });
        buckets.get(key).geometries.push(geometry);
        buckets.get(key).owners.push(stall);
    };
    const merged = [];
    root.traverse((o) => {
        if (!o.isMesh || o.isInstancedMesh) return;
        const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
        const p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
        const chunk = `${Math.floor(p.x / CHUNK)},${Math.floor(p.z / CHUNK)}`;
        if (Array.isArray(o.material)) {
            // Split multi-material meshes (buildings: walls + roof) by group
            for (const group of o.geometry.groups) {
                const part = new THREE.BufferGeometry();
                for (const [name, attr] of Object.entries(g.attributes)) {
                    const start = group.start * attr.itemSize;
                    part.setAttribute(name, new THREE.BufferAttribute(attr.array.slice(start, start + group.count * attr.itemSize), attr.itemSize));
                }
                add(o.material[group.materialIndex], chunk, part);
            }
        } else {
            add(o.material, chunk, g, o.userData.stall);
            // Stall pieces keep their own shape and place, to become flying debris when smashed
            if (o.userData.stall !== undefined) stalls[o.userData.stall].parts.push({ geometry: o.geometry, material: o.material, matrix: o.matrixWorld.clone() });
        }
        merged.push(o);
    });
    for (const o of merged) o.parent.remove(o);
    for (const { material, geometries, owners, low } of buckets.values()) {
        const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
        if (low) mesh.layers.set(DYNAMIC_LAYER); // drawn normally, skipped by the water reflection
        root.add(mesh);
        // Note where each stall's triangles landed in the merged buffer, so breakStall can hide them
        let start = 0;
        geometries.forEach((g, i) => {
            if (owners[i] !== undefined) stalls[owners[i]].ranges.push({ mesh, start, count: g.attributes.position.count });
            start += g.attributes.position.count;
        });
    }
}

export function buildWorld(scene) {
    const root = new THREE.Group();
    scene.add(root);
    scene = root; // everything below is static and gets merged at the end
    const plaster = [0xe8d5b0, 0xc97b4b, 0x8fb3c9, 0xd9c27a, 0xb0a99f, 0xe0b8a0].map((c) => ['plaster', c]);
    const mainland = buildDistrict(scene, MAINLAND, MAINLAND_AREAS, MAINLAND_PLACES, 6, 25, plaster, 40, 140,
        { holes: 0.22, patches: 0.12, rubbish: 0.3, dumps: 0.35, barrows: 15 }); // the Mainland is rough
    const island = buildDistrict(scene, ISLAND, ISLAND_AREAS, ISLAND_PLACES, 20, 90,
        [['glass', 0x4a7a8c], ['glass', 0x2f5d6b], ['glass', 0x6f8fa3], ['office', 0xbdbdbd], ['office', 0xd8d2c4], ['plaster', 0xe8d5b0]], 6, 25,
        { holes: 0.04, patches: 0.04, rubbish: 0.03, dumps: 0, barrows: 3 });

    // Rubbish: sachets and flattened cartons here; bags, bottles and dump heaps are models placed by props.js
    scatter(scene, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x9c7a4b }), trash.cardboard);
    decals(scene, flatSquare, new THREE.MeshStandardMaterial({ color: 0xf2f2f2 }), 0.06, trash.sachets);

    // Rooftop water tanks, one instanced batch
    const tanks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.9, 0.9, 1.6, 12).translate(0, 0.8, 0), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 }), roofTanks.length);
    const m = new THREE.Matrix4();
    roofTanks.forEach(([x, y, z], i) => tanks.setMatrixAt(i, m.makeTranslation(x, y, z)));
    scene.add(tanks);
    buildBridge(scene);

    addLabel(scene, 'MAINLAND', (MAINLAND.x0 + MAINLAND.x1) / 2, 110, 0, 3, '#ffeb3b');
    addLabel(scene, 'LAGOS ISLAND', (ISLAND.x0 + ISLAND.x1) / 2, 130, 0, 3, '#ffeb3b');

    // Overhead footbridges halfway along a few streets (four on the Mainland, one on the Island)
    for (const [d, count] of [[MAINLAND, 4], [ISLAND, 1]]) {
        for (let i = 0; i < count; i++) {
            const alongZ = Math.random() < 0.5;
            const x = d.x0 + STEP * THREE.MathUtils.randInt(1, Math.round((d.x1 - d.x0) / STEP) - 1);
            const z = d.z0 + STEP * THREE.MathUtils.randInt(1, Math.round((d.z1 - d.z0) / STEP) - 1);
            if (alongZ) placeFootbridge(scene, x, z + STEP / 2, true);
            else placeFootbridge(scene, x + STEP / 2, z, false);
        }
    }
    placeHawkers(MAINLAND, 70);
    placeHawkers(ISLAND, 12);
    // A crowd of them where you start: the junction in front of you and the bridge entrance
    for (const [x0, x1, z] of [[SPAWN.x - 5, SPAWN.x - 35, ROAD / 4], [SPAWN.x + 25, SPAWN.x + 45, -ROAD / 4], [MAINLAND.x1 - STOP_LINE, MAINLAND.x1 - STOP_LINE - 30, ROAD / 4]]) {
        hawker([{ x: x0, z }, { x: x1, z }], 0);
        hawker([{ x: x1, z }, { x: x0, z }], 0);
    }
    for (let i = 0; i < 6; i++) {
        // Bridge go-slow, on the level middle stretch, between lanes
        const x = THREE.MathUtils.randFloat(MAINLAND.x1 + 120, ISLAND.x0 - 160);
        const z = (Math.random() < 0.5 ? -1 : 1) * (MEDIAN_HALF + LANE_WIDTH * THREE.MathUtils.randInt(1, 2));
        hawker([{ x, z }, { x: x + 40, z }], roadHeight(x));
    }

    mergeStatic(root);
    return [...mainland, ...island];
}


const inside = (d, x, z, m) => x >= d.x0 - m && x <= d.x1 + m && z >= d.z0 - m && z <= d.z1 + m;

export function isDrivable(x, z, r, y = 0) {
    if (x > MAINLAND.x1 && x < ISLAND.x0) {
        if (Math.abs(z) > BRIDGE_HALF_WIDTH - r) return false;
        if (x > MEDIAN_X0 - r && x < MEDIAN_X1 + r && Math.abs(z) < MEDIAN_HALF + r) return false;
    } else if (!inside(MAINLAND, x, z, ROAD / 2 - r) && !inside(ISLAND, x, z, ROAD / 2 - r)) {
        return false;
    }
    // ponytail: linear scan over ~200 solids, switch to a grid lookup if the map grows a lot
    return !solids.some((b) => (b.top === undefined || y < b.top) && Math.abs(x - b.x) < b.hx + r && Math.abs(z - b.z) < b.hz + r);
}

// Height of the ground under (x, z): bridge deck on the bridge, raised pavement on every block, road level elsewhere
export function groundHeight(x, z) {
    if (x > MAINLAND.x1 && x < ISLAND.x0) return roadHeight(x);
    const d = x < 0 ? MAINLAND : ISLAND;
    if (x <= d.x0 || x >= d.x1 || z <= d.z0 || z >= d.z1) return 0;
    const bx = d.x0 + STEP / 2 + Math.floor((x - d.x0) / STEP) * STEP;
    const bz = d.z0 + STEP / 2 + Math.floor((z - d.z0) / STEP) * STEP;
    const half = (STEP - ROAD) / 2;
    return Math.abs(x - bx) < half && Math.abs(z - bz) < half ? KERB : 0;
}

export function areaName(x, z, spots) {
    if (x > MAINLAND.x1 && x < ISLAND.x0) return 'Third Mainland Bridge';
    let best = spots[0];
    for (const s of spots) if (Math.hypot(s.x - x, s.z - z) < Math.hypot(best.x - x, best.z - z)) best = s;
    return best.name;
}
