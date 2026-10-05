import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildWorld, isDrivable, areaName, railHit, railBroken, breakRail, stallHit, breakStall, groundHeight, footbridgeSurface, SPAWN, DYNAMIC_LAYER, places, peopleSlots, potholes, trash } from './world.js';
import { placeProps } from './props.js';
import { createDebris } from './debris.js';
import { createBoats } from './boats.js';
import { createPeople } from './people.js';
import { createZombies } from './zombies.js';
import { createTraffic } from './traffic.js';
import { createAnimals } from './animals.js';
import { setupEnvironment } from './environment.js';

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xb8c8d0, 200, 1400);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.layers.enable(DYNAMIC_LAYER); // traffic, labels, road paint: drawn, but not reflected in the water
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // full retina res costs ~2x for little gain
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a7a, 0.7));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
scene.add(sun);
const updateEnvironment = setupEnvironment(scene, renderer, sun);

const spots = buildWorld(scene);

// Rubbish models: bin bags (pairs and singles), bottles lying about, heaped refuse at the dumps
const bagSpot = ([x, y, z, ry, s]) => [x, groundHeight(x, z) + Math.max(0, y - s * 0.6), z, ry, s / 0.33]; // on the ground (or heaped up), roughly the old size
const bags = trash.bags.map(bagSpot);
// Each set only draws what's near you (see props.js); the heavy heaps and bottles get a shorter range
const propSets = [];
const addProps = (...args) => placeProps(scene, ...args).then((set) => propSets.push(set));
addProps('models/props/garbage_bags.glb', 0.9, bags.filter((_, i) => i % 5 < 2), { range: 80 }); // most bags: the textured ones
addProps('models/props/trash_bags.glb', 0.6, bags.filter((_, i) => i % 5 === 2 || i % 5 === 3), { range: 80 });
addProps('models/props/trash_bag.glb', 0.5, bags.filter((_, i) => i % 5 === 4), { range: 80 });
addProps('models/props/plastic_garbage_bags.glb', 2.4, trash.heaps.map(([x, , z, ry]) => [x, groundHeight(x, z), z, ry, 1]), { range: 65 });
addProps('models/props/bottle.glb', 0.28, trash.bottles.map(([x, , z, ry]) => [x, 0.04, z, ry, 1]), { lying: true, range: 45 });
addProps('models/props/rubbish_pile.glb', 5, trash.dumps, { range: 200 });
const traffic = createTraffic(scene, (impact) => crash(impact), (v) => danfoStop(v)); // traffic ramming you hurts too
const people = createPeople(scene, peopleSlots);
// Chickens and goats: flocks in every market, and goats and hens in the Mainland rubbish dumps
const animals = createAnimals(scene, [
    ...places.filter((p) => p.kind === 'market').map((p) => ({ x: p.x, z: p.z, chickens: p.x < 0 ? 14 : 5, goats: p.x < 0 ? 4 : 1 })),
    ...[...trash.dumps, ...trash.heaps].filter(([x]) => x < 0).map(([x, , z]) => ({ x, z, chickens: 3, goats: 2 })),
]);
const zombies = createZombies(scene);
const debris = createDebris(scene);
const boats = createBoats(scene);

// Player: delivery rider on a bike. `car` yaws and pitches on ramps; `bike` inside it leans into corners.
const BIKE_LENGTH = 2.1;
const KERB_TOP = 0.2; // pavement height
const WHEELBASE = 1.7; // distance between the bike's wheels, for feeling kerbs and slopes
const bikeWheels = []; // { pivot, radius }
const barsPivot = new THREE.Group(); // steers the handlebars and front wheel
const SEAT = { z: -0.3 }; // where the rider sits along the bike, from its centre
const car = new THREE.Group();
car.rotation.order = 'YXZ'; // yaw, then pitch on the bridge ramps
const bike = new THREE.Group();
car.add(bike);
const placeholder = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1, BIKE_LENGTH), new THREE.MeshStandardMaterial({ color: 0x1565c0 }));
placeholder.position.y = 0.5;
bike.add(placeholder);
scene.add(car);

const loader = new GLTFLoader();
loader.load(
    'models/delivery-bike/scene.gltf',
    (gltf) => {
        const model = gltf.scene;
        let size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
        if (size.x > size.z) model.rotation.y = -Math.PI / 2; // built along x: turn it to face +z
        model.scale.setScalar(BIKE_LENGTH / Math.max(size.x, size.z));
        const box = new THREE.Box3().setFromObject(model);
        const centre = box.getCenter(new THREE.Vector3());
        model.position.set(-centre.x, -box.min.y, -centre.z);
        bike.remove(placeholder);
        bike.add(model);
        // Give the front and back wheels (tyre + rim) their own pivot at the hub so they can roll
        bike.updateMatrixWorld(true);
        const byEnd = { front: [], back: [] };
        model.traverse((o) => {
            if (!o.isMesh || !/rim|tyre/i.test(`${o.name} ${o.material.name}`)) return;
            const c = bike.worldToLocal(new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()));
            byEnd[c.z > 0 ? 'front' : 'back'].push(o);
        });
        for (const meshes of Object.values(byEnd)) {
            if (!meshes.length) continue;
            const box = new THREE.Box3();
            meshes.forEach((m) => box.expandByObject(m));
            const pivot = new THREE.Group();
            pivot.position.copy(bike.worldToLocal(box.getCenter(new THREE.Vector3())));
            bike.add(pivot);
            pivot.updateMatrixWorld(true);
            meshes.forEach((m) => pivot.attach(m));
            bikeWheels.push({ pivot, radius: (box.max.y - box.min.y) / 2 });
        }
        // Handlebars, fork and front wheel turn together about the front hub
        const controls = model.getObjectByName('Controls');
        const front = bikeWheels.find((w) => w.pivot.position.z > 0);
        if (controls && front) {
            barsPivot.position.set(0, front.pivot.position.y, front.pivot.position.z);
            bike.add(barsPivot);
            barsPivot.updateMatrixWorld(true);
            barsPivot.attach(controls);
            barsPivot.attach(front.pivot);
        }
    },
    undefined,
    (error) => console.error('Error loading bike model:', error)
);


const RIDER_HEIGHT = 1.75;
const SEAT_TOP = 0.95; // height of the seat above the road, in bike space
const RIDER_COLOURS = { LightBrown: 0x00897b, LightBlue: 0x1a1a1a, Skin: 0x5a3a28, Skin_Darker: 0x4a2e20, Hair: 0x151210, Eyebrows: 0x151210 };

// Turn a bone about an axis given in the rider's own space (x = rider's left, y = up, z = forward)
function bend(bone, axis, angle) {
    const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const turn = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    bone.quaternion.premultiply(parent.clone().invert().multiply(turn).multiply(parent));
    bone.updateMatrixWorld(true);
}
const X = new THREE.Vector3(1, 0, 0);

loader.load(
    'models/people/casual.glb',
    (gltf) => {
        const rider = gltf.scene;
        const size = new THREE.Box3().setFromObject(rider).getSize(new THREE.Vector3());
        rider.scale.setScalar(RIDER_HEIGHT / size.y);
        rider.traverse((o) => {
            if (o.isMesh && RIDER_COLOURS[o.material.name] !== undefined) o.material.color.set(RIDER_COLOURS[o.material.name]);
        });
        rider.updateMatrixWorld(true);
        const bone = (name) => rider.getObjectByName(name.replace('.', '')); // the loader strips dots: UpperLeg.L -> UpperLegL
        // Seated: thighs forward, shins back down to the pegs, a slight forward lean, hands out to the bars
        for (const side of ['L', 'R']) {
            bend(bone(`UpperLeg.${side}`), X, -1.4);
            bend(bone(`LowerLeg.${side}`), X, 1.9); // tuck the feet back onto the pegs
        }
        bend(bone('Abdomen'), X, 0.2);
        // Arms hang down in the bind pose: swing them forward to the handlebars
        bend(bone('UpperArm.L'), X, -1.15);
        bend(bone('UpperArm.R'), X, -1.15);
        // Helmet on the head bone
        const head = bone('Head');
        const scale = head.getWorldScale(new THREE.Vector3()).x;
        const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 }));
        const top = head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.1, 0.01));
        head.add(helmet);
        helmet.position.copy(head.worldToLocal(top));
        helmet.quaternion.copy(head.getWorldQuaternion(new THREE.Quaternion()).invert());
        helmet.scale.setScalar(1 / scale);
        // Sit the hips on the seat
        const hips = bone('Hips').getWorldPosition(new THREE.Vector3());
        rider.position.set(0, SEAT_TOP - hips.y, SEAT.z);
        bike.add(rider);
    },
    undefined,
    (error) => console.error('Error loading rider model:', error)
);

const drive = { speed: 0, maxSpeed: 16, accel: 4, brake: 20, drag: 6, turn: 2.6, radius: 0.55, damage: 0, wrecked: null, fall: null, shake: 0 };
const RAIL_BREAK_SPEED = 9; // ~32 km/h straight into the rail takes you through; a glancing scrape won't
const WATER_Y = -1.5;

// Mob rating, 0-5 fists: the street's patience with you. Rises with bad behaviour, cools off over time.
const KNOCK_SPEED = 2.8; // ~10 km/h: faster than this and a pedestrian goes down
const MOB_PER_KNOCKDOWN = 1;
const MOB_PER_STALL = 1.5; // smashing up someone's livelihood
const STALL_BREAK_SPEED = 6; // ~22 km/h: faster than this and you go through a stall
const MOB_COOLDOWN_DELAY = 10; // seconds of good behaviour before it starts falling
const MOB_COOL_RATE = 0.05; // fists per second after that
const MOB_THRESHOLD = 2; // fists before the zombie mob comes for you
const mob = { rating: 0, calm: 0, hunting: false, offer: null };

// Wallet, saved between sessions. Deliveries will fill it; Egbon Adugbo can empty it.
const SETTLE_PER_FIST = 3000;
const wallet = { naira: 15000 };
try {
    const saved = Number(localStorage.getItem('freedrive-naira'));
    if (saved >= 0 && localStorage.getItem('freedrive-naira') !== null) wallet.naira = saved;
} catch {}
const naira = (n) => `₦${Math.round(n).toLocaleString('en-NG')}`;
function spend(amount) {
    wallet.naira -= amount;
    try { localStorage.setItem('freedrive-naira', String(wallet.naira)); } catch {}
}

// A danfo pulls over: a few passengers climb out and walk off, a few from the kerb walk to the door and get in
function danfoStop(v) {
    const fx = Math.sin(v.yaw);
    const fz = Math.cos(v.yaw);
    const rx = -fz; // kerbside (right) of the bus
    const rz = fx;
    const door = { x: v.x + rx * (v.kind.wid / 2 + 0.2) + fx * 0.3, z: v.z + rz * (v.kind.wid / 2 + 0.2) + fz * 0.3 };
    const kerb = { x: door.x + rx * 2.2, z: door.z + rz * 2.2 };
    const along = (p, d) => ({ x: p.x + fx * d, z: p.z + fz * d });
    const off = Math.min(THREE.MathUtils.randInt(0, 2), v.passengers);
    v.passengers -= off;
    for (let i = 0; i < off; i++) people.walk([door, kerb, along(kerb, (Math.random() < 0.5 ? -1 : 1) * THREE.MathUtils.randFloat(10, 18))]);
    const on = Math.min(THREE.MathUtils.randInt(0, 2), 9 - v.passengers);
    for (let i = 0; i < on; i++) people.walk([along(kerb, (Math.random() < 0.5 ? -1 : 1) * THREE.MathUtils.randFloat(2.5, 5)), kerb, door], () => v.passengers++);
}

// Egbon Adugbo block your road: settle them, or face them. The street pauses while you decide.
const offerBox = document.createElement('div');
offerBox.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(420px,calc(100vw - 32px));padding:20px;background:rgba(20,16,12,.92);color:#fff;font:15px Arial,sans-serif;border-radius:10px;border:2px solid #f9a825;text-align:center;display:none;z-index:10';
document.body.appendChild(offerBox);
function offerSettlement() {
    const cost = Math.round((mob.rating * SETTLE_PER_FIST) / 500) * 500;
    const canPay = wallet.naira >= cost;
    mob.offer = { cost };
    offerBox.innerHTML = `<div style="font:bold 22px Arial;color:#f9a825;margin-bottom:8px">EGBON ADUGBO DON BLOCK YOU!</div>
        <div style="margin-bottom:14px">"Oga, you don scatter our area. Drop something, or we go handle you."</div>
        <button data-choice="settle" ${canPay ? '' : 'disabled'} style="margin:4px;padding:10px 14px;font:bold 15px Arial;border:0;border-radius:6px;background:${canPay ? '#2e7d32' : '#555'};color:#fff;cursor:${canPay ? 'pointer' : 'default'}">1 · Settle them (${naira(cost)})</button>
        <button data-choice="face" style="margin:4px;padding:10px 14px;font:bold 15px Arial;border:0;border-radius:6px;background:#c62828;color:#fff;cursor:pointer">2 · Face them</button>
        <div style="margin-top:10px;opacity:.75">You have ${naira(wallet.naira)}${canPay ? '' : ' — not enough to settle'}</div>`;
    offerBox.style.display = 'block';
}
function chooseOffer(choice) {
    if (!mob.offer) return;
    if (choice === 'settle' && wallet.naira < mob.offer.cost) return; // can't afford it: you'll have to face them
    if (choice === 'settle') {
        spend(mob.offer.cost);
        mob.rating = 0;
        flash(`Egbon Adugbo collect ${naira(mob.offer.cost)}. "Waka pass!"`);
    } else {
        mob.hunting = true;
        flash('EGBON ADUGBO DON VEX!');
    }
    mob.offer = null;
    offerBox.style.display = 'none';
}
offerBox.addEventListener('click', (e) => {
    const choice = e.target.closest('button')?.dataset.choice;
    if (choice && !e.target.disabled) chooseOffer(choice);
});
function raiseMob(amount) {
    mob.rating = Math.min(5, mob.rating + amount);
    mob.calm = 0;
}
function updateMob(dt) {
    if ((mob.calm += dt) > MOB_COOLDOWN_DELAY) mob.rating = Math.max(0, mob.rating - MOB_COOL_RATE * dt);
}

function resetCar() {
    if (drive.toHospital) return wakeUpInHospital();
    car.position.set(SPAWN.x, 0, SPAWN.z);
    car.rotation.y = Math.PI / 2; // facing the bridge (+x)
    car.rotation.x = 0;
    bike.rotation.z = 0;
    drive.speed = 0;
    drive.vy = 0;
    drive.lastFront = 0;
    drive.damage = 0; // repairs the bike; the street's grudge (mob rating) stays
    drive.wrecked = null;
    drive.fall = null;
}

function wreck(message, toHospital = false) {
    drive.wrecked = message;
    drive.speed = 0;
    drive.toHospital = toHospital;
    drive.respawnIn = 3;
}

// Beaten by the mob: wake up outside the nearest hospital, bike patched up, grudge forgotten
function wakeUpInHospital() {
    const { x, z } = car.position;
    const hospital = places.filter((p) => p.kind === 'hospital').sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
    drive.toHospital = false;
    resetCar();
    car.position.set(hospital.x, 0, hospital.z + 30); // the road along the hospital's front
    mob.rating = 0;
    mob.hunting = false;
    zombies.clear();
    flash(`You woke up at ${hospital.name}`);
}

// Damage scales with impact speed; gentle nudges are free
function crash(impact) {
    drive.shake = Math.min(impact * 0.04, 1.2);
    if (impact > 4) drive.damage = Math.min(100, drive.damage + (impact - 4) * 1.6);
    if (drive.damage >= 100) wreck('WRECKED');
}

// Off the bridge: keep momentum, gravity takes over, nose dips, splash
function updateFall(dt) {
    const f = drive.fall;
    f.vy -= 25 * dt;
    car.position.x += f.vx * dt;
    car.position.z += f.vz * dt;
    car.position.y = Math.max(car.position.y + f.vy * dt, WATER_Y - 2.5);
    car.rotation.x = Math.min(car.rotation.x + dt * 0.9, 0.9);
    if (car.position.y < WATER_Y && !drive.wrecked) {
        f.vx *= 0.1;
        f.vz *= 0.1;
        f.vy = -1;
        splash(car.position);
        wreck('SPLASH! You drove into the Lagos Lagoon');
    }
}
resetCar();

const keys = {};
let mapView = false;
window.addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;
    if (e.key.startsWith('Arrow')) e.preventDefault();
    if (mob.offer) {
        if (e.key === '1') chooseOffer('settle');
        if (e.key === '2') chooseOffer('face');
        return;
    }
    if (e.key === 'r' || e.key === 'R') resetCar();
    if (e.key === 'm' || e.key === 'M') mapView = !mapView;
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

// Footbridges: up there the railings keep you on the deck and stairs; down on the road you ride underneath,
// and the side of a staircase is a wall (you can only get on at the bottom of the steps)
const CLIMB = 0.8; // highest step up the wheels can take
function canRide(x, z) {
    const y = car.position.y;
    if (y > groundHeight(x, z) + KERB_TOP + 0.4) { // up on a footbridge (the bridge deck counts as street)
        const s = footbridgeSurface(x, z, drive.radius * 0.5);
        return !!s && s.h <= y + CLIMB;
    }
    const s = footbridgeSurface(x, z, 0);
    if (s && s.stair && s.h > y + CLIMB) return false;
    return isDrivable(x, z, drive.radius, y);
}
// Ground under a wheel: the footbridge surface if it's within reach of the wheel, otherwise the street
function groundAt(x, z) {
    const s = footbridgeSurface(x, z, 0);
    const street = groundHeight(x, z);
    return s && s.h <= car.position.y + CLIMB ? Math.max(s.h, street) : street;
}

function moveStep(dt) {
    const nx = car.position.x + Math.sin(car.rotation.y) * drive.speed * dt;
    const nz = car.position.z + Math.cos(car.rotation.y) * drive.speed * dt;
    const impact = Math.abs(drive.speed);
    const rail = railHit(nx, nz, drive.radius);
    const other = traffic.hit(nx, nz, drive.radius);
    const intoRail = Math.abs(Math.cos(car.rotation.y) * drive.speed); // rails run along x: only speed across them counts
    if (rail && (intoRail > RAIL_BREAK_SPEED || railBroken(nx, rail)) && !other) {
        breakRail(nx, rail);
        crash(impact * 0.5);
        drive.fall = { vx: Math.sin(car.rotation.y) * drive.speed, vz: Math.cos(car.rotation.y) * drive.speed, vy: 3 };
        return true;
    }
    // Smash through market stalls and POS stands: they fly apart, the bike slows and carries on
    const stall = !other && impact > STALL_BREAK_SPEED ? stallHit(nx, nz, drive.radius) : -1;
    if (stall >= 0) {
        const fx = Math.sin(car.rotation.y);
        const fz = Math.cos(car.rotation.y);
        const smashed = breakStall(stall);
        debris.spawn(smashed.parts, fx, fz, impact);
        people.anger(smashed.x, smashed.z, 10);
        raiseMob(MOB_PER_STALL);
        crash(impact * 0.4);
        drive.speed *= 0.6;
    }
    const zombie = !other && zombies.hit(nx, nz, drive.radius);
    const pedestrian = !other && !zombie && people.hit(nx, nz, drive.radius, car.position.y); // not the people on a footbridge overhead
    if (zombie) {
        if (impact > KNOCK_SPEED) {
            zombies.knock(zombie, Math.sin(car.rotation.y), Math.cos(car.rotation.y));
            drive.shake = 0.5;
            drive.speed *= 0.5;
        } else drive.speed *= -0.2;
    } else if (pedestrian) {
        if (impact > KNOCK_SPEED) {
            people.knock(pedestrian, Math.sin(car.rotation.y), Math.cos(car.rotation.y));
            raiseMob(MOB_PER_KNOCKDOWN);
            drive.shake = 0.4;
            drive.speed *= 0.4; // ride on, much slower
        } else drive.speed *= -0.2; // gentle bump, no harm done
    }
    else if (canRide(nx, nz) && !other) car.position.set(nx, car.position.y, nz);
    else if (other) {
        // Rammed a vehicle: it gets shoved, you bounce
        traffic.knock(other, Math.sin(car.rotation.y), Math.cos(car.rotation.y), impact);
        crash(impact);
        drive.speed *= -0.3;
    } else {
        // Wall, building, barrier: slide along it if you hit at an angle. Only the part of your speed
        // going into the wall counts as impact, so a scrape hurts far less than a head-on.
        const { x, z } = car.position;
        const free = (px, pz) => canRide(px, pz) && !traffic.hit(px, pz, drive.radius);
        const vx = (nx - x) / dt;
        const vz = (nz - z) / dt;
        // Scrape: damage only on first contact, then the bike turns to run along the wall
        const scrape = (into, alongYaw) => {
            if (!drive.wasTouching && !drive.touching) crash(into); // first moment of contact only
            drive.touching = true;
            drive.speed *= 0.99; // scraping friction, per small step
            const turn = THREE.MathUtils.euclideanModulo(alongYaw - car.rotation.y + Math.PI, Math.PI * 2) - Math.PI;
            car.rotation.y += turn * 0.15;
        };
        if (Math.abs(vx) > Math.abs(vz) * 0.25 && free(nx, z)) {
            car.position.x = nx;
            scrape(Math.abs(vz), vx > 0 ? Math.PI / 2 : -Math.PI / 2);
        } else if (Math.abs(vz) > Math.abs(vx) * 0.25 && free(x, nz)) {
            car.position.z = nz;
            scrape(Math.abs(vx), vz > 0 ? 0 : Math.PI);
        } else {
            crash(impact); // square on: full hit, bounce back
            drive.speed *= -0.3;
        }
    }
    return false;
}

function updateCar(dt) {
    if (drive.fall) return updateFall(dt);
    if (drive.wrecked) return;
    const up = keys.arrowup || keys.w;
    const down = keys.arrowdown || keys.s;
    const steer = (keys.arrowleft || keys.a ? 1 : 0) - (keys.arrowright || keys.d ? 1 : 0);

    const maxSpeed = drive.maxSpeed * (drive.damage > 75 ? 0.6 : 1); // badly damaged cars limp
    if (up) drive.speed = Math.min(drive.speed + drive.accel * dt, maxSpeed);
    else if (down) drive.speed = Math.max(drive.speed - drive.brake * dt, -drive.maxSpeed * 0.3);
    else drive.speed -= Math.sign(drive.speed) * Math.min(Math.abs(drive.speed), drive.drag * dt);

    car.rotation.y += steer * drive.turn * dt * Math.sign(drive.speed) * Math.min(1, Math.abs(drive.speed) / 8);
    for (const w of bikeWheels) w.pivot.rotation.x += (drive.speed * dt) / w.radius; // roll with the road
    const bars = steer * 0.4 * Math.max(0.25, 1 - Math.abs(drive.speed) / 16); // big turns slow, small ones fast
    barsPivot.rotation.y += (bars - barsPivot.rotation.y) * (1 - Math.exp(-10 * dt));
    const lean = -steer * 0.4 * Math.min(1, Math.abs(drive.speed) / 15); // lean into the corner
    bike.rotation.z += (lean - bike.rotation.z) * (1 - Math.exp(-6 * dt));

    // Move in small steps so nothing is skipped through at speed
    const steps = Math.max(1, Math.ceil((Math.abs(drive.speed) * dt) / 0.25));
    drive.touching = false;
    for (let i = 0; i < steps; i++) if (moveStep(dt / steps) || drive.wrecked) break;
    drive.wasTouching = drive.touching;
    if (drive.fall) return;

    // Suspension: sample the ground under each wheel. Kerbs lift the front wheel first, then the back.
    const fx = Math.sin(car.rotation.y);
    const fz = Math.cos(car.rotation.y);
    const front = groundAt(car.position.x + fx * WHEELBASE / 2, car.position.z + fz * WHEELBASE / 2);
    const back = groundAt(car.position.x - fx * WHEELBASE / 2, car.position.z - fz * WHEELBASE / 2);
    const fast = Math.abs(drive.speed) > 5;
    if (front - drive.lastFront > 0.1 && fast) {
        drive.shake = Math.max(drive.shake, 0.3); // bang up the kerb
        drive.speed *= 0.88;
    } else if (drive.lastFront - front > 0.1 && fast) drive.shake = Math.max(drive.shake, 0.15); // thud down off it
    drive.lastFront = front;
    const ground = (front + back) / 2;
    drive.vy += ((ground - car.position.y) * 160 - drive.vy * 18) * dt;
    car.position.y += drive.vy * dt;
    if (car.position.y < ground - 0.03) {
        car.position.y = ground - 0.03;
        drive.vy = Math.max(0, drive.vy);
    }
    const pitch = Math.atan2(front - back, WHEELBASE); // nose up when the front wheel is higher
    car.rotation.x += (-pitch - car.rotation.x) * (1 - Math.exp(-18 * dt));

    // Potholes: a jolt, a bit of damage, lost speed. Once per hole, not every frame you're in it.
    const { x: px, z: pz } = car.position;
    const hole = Math.abs(drive.speed) > 4 ? potholes.find((p) => Math.abs(p.x - px) < p.r && Math.abs(p.z - pz) < p.r) : null;
    if (hole && hole !== drive.lastHole) {
        drive.shake = Math.max(drive.shake, 0.35);
        drive.speed *= 0.8;
        drive.damage = Math.min(100, drive.damage + 1.5);
    }
    drive.lastHole = hole;
}

const camGoal = new THREE.Vector3();
function updateCamera(dt) {
    const { x, y, z } = car.position;
    if (mapView) camGoal.set(x, 500, z + 1);
    else camGoal.set(x - Math.sin(car.rotation.y) * 9, y + 4.5, z - Math.cos(car.rotation.y) * 9);
    camera.position.lerp(camGoal, 1 - Math.exp(-5 * dt));
    camera.lookAt(x, Math.max(y, WATER_Y) + 1.5, z);
    if (drive.shake > 0) {
        camera.position.x += (Math.random() - 0.5) * drive.shake;
        camera.position.y += (Math.random() - 0.5) * drive.shake;
        drive.shake = Math.max(0, drive.shake - dt * 3);
    }
}

const info = document.createElement('div');
info.style.cssText = 'position:fixed;left:16px;bottom:16px;padding:10px 14px;background:rgba(0,0,0,.65);color:#fff;font:14px Arial,sans-serif;border-radius:6px;line-height:1.5';
document.body.appendChild(info);

let flashText = '';
let flashTimer = 0;
const flash = (text) => {
    flashText = text;
    flashTimer = 2.5;
};
const banner = document.createElement('div');
banner.style.cssText = 'position:fixed;left:0;right:0;top:35%;text-align:center;color:#fff;font:bold 44px Arial,sans-serif;text-shadow:0 3px 8px #000;pointer-events:none;padding:0 16px';
document.body.appendChild(banner);

// Smoke puffs from the bonnet once the car is badly damaged
const puffs = [];
function updateSmoke(dt) {
    if (drive.damage > 50 && !drive.fall && Math.random() < dt * drive.damage * 0.15) {
        const puff = new THREE.Sprite(new THREE.SpriteMaterial({ color: drive.damage > 75 ? 0x222222 : 0x777777, transparent: true, depthWrite: false }));
        puff.position.set(car.position.x + Math.sin(car.rotation.y) * 0.6, car.position.y + 0.8, car.position.z + Math.cos(car.rotation.y) * 0.6);
        puff.life = 1.5;
        scene.add(puff);
        puffs.push(puff);
    }
    for (let i = puffs.length - 1; i >= 0; i--) {
        const p = puffs[i];
        p.life -= dt;
        p.position.y += dt * 2.5;
        p.scale.setScalar(1 + (1.5 - p.life) * 2);
        p.material.opacity = Math.max(0, p.life / 1.5) * 0.6;
        if (p.life <= 0) {
            scene.remove(p);
            p.material.dispose();
            puffs.splice(i, 1);
        }
    }
}

// White spray where the car hits the water
function splash(at) {
    for (let i = 0; i < 25; i++) {
        const drop = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
        drop.position.set(at.x, WATER_Y, at.z);
        drop.life = 1.5;
        drop.vel = new THREE.Vector3((Math.random() - 0.5) * 8, 6 + Math.random() * 8, (Math.random() - 0.5) * 8);
        scene.add(drop);
        drops.push(drop);
    }
}
const drops = [];
function updateSplash(dt) {
    for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        d.life -= dt;
        d.vel.y -= 20 * dt;
        d.position.addScaledVector(d.vel, dt);
        d.material.opacity = Math.max(0, d.life / 1.5);
        if (d.life <= 0 || d.position.y < WATER_Y - 1) {
            scene.remove(d);
            d.material.dispose();
            drops.splice(i, 1);
        }
    }
}

const credits = document.createElement('div');
credits.style.cssText = 'position:fixed;right:12px;top:8px;max-width:min(520px,calc(100vw - 24px));text-align:right;color:rgba(255,255,255,.8);font:10px/1.4 Arial,sans-serif;text-shadow:0 1px 2px #000';
credits.textContent = 'Checkers Sixty60 Bike by Caitlin Pillay (CC-BY 4.0, Sketchfab) · Lagos Danfo Bus by Iam_thearchitect (CC-BY 4.0, Sketchfab) · Garbage bags by DJMaesen, plastic garbage bags by Den1121 (CC-BY 4.0, Sketchfab) · People & bin bags by Quaternius (CC0) · Wheelbarrow & rubbish pile by Poly by Google, bin bag by Jens Kull, bottle by Zoe XR (CC-BY, Poly Pizza)';
document.body.appendChild(credits);

const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    step(Math.min(clock.getDelta(), 0.05));
}

function step(dt) {
    if (mob.offer) return renderer.render(scene, camera); // paused while you decide
    updateCar(dt);
    traffic.update(dt, car.position, drive.radius);
    people.update(dt, car.position);
    animals.update(dt, car.position, drive.speed);
    debris.update(dt);
    for (const set of propSets) set.update(car.position, dt);
    boats.update(dt);
    // Mob mode: zombies hunt you from 2 fists until things cool below 1
    if (mob.rating >= MOB_THRESHOLD && !mob.hunting && !drive.wrecked) offerSettlement();
    else if (mob.rating < 1) mob.hunting = false;
    const hunters = mob.hunting && !drive.wrecked ? Math.min(12, 2 * Math.floor(mob.rating)) : 0;
    const bite = zombies.update(dt, car.position, car.rotation.y, hunters);
    if (bite && !drive.wrecked) {
        drive.damage = Math.min(100, drive.damage + bite);
        drive.shake = 0.6;
        if (drive.damage >= 100) wreck('Egbon Adugbo don scatter your bike!', true);
    }
    if (drive.wrecked && drive.toHospital && (drive.respawnIn -= dt) <= 0) wakeUpInHospital();
    updateCamera(dt);
    updateEnvironment(dt, camera);
    updateSmoke(dt);
    updateSplash(dt);
    updateMob(dt);
    const fists = Math.floor(mob.rating + 0.001);
    const dmg = Math.round(drive.damage);
    const dmgColor = dmg > 75 ? '#ff5252' : dmg > 50 ? '#ffb300' : '#69f0ae';
    info.innerHTML = `<b>${areaName(car.position.x, car.position.z, spots)}</b> · ${Math.round(Math.abs(drive.speed) * 3.6)} km/h<br>` +
        `Damage <span style="display:inline-block;width:100px;height:8px;background:#333;border-radius:4px;vertical-align:middle"><span style="display:block;height:100%;width:${dmg}%;background:${dmgColor};border-radius:4px"></span></span> ${dmg}%<br>` +
        `${naira(wallet.naira)}<br>` +
        `Egbon Adugbo <span style="letter-spacing:2px">${'👊'.repeat(fists)}<span style="opacity:.25">${'👊'.repeat(5 - fists)}</span></span><br>` +
        'Arrows/WASD drive · M map view · R reset/repair';
    if (drive.wrecked) banner.innerHTML = `${drive.wrecked}<br><span style="font-size:20px">${drive.toHospital ? 'Everything goes black...' : 'Press R to respawn'}</span>`;
    else banner.innerHTML = flashTimer > 0 ? flashText : '';
    flashTimer -= dt;
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

camera.position.set(SPAWN.x - 14, 7, SPAWN.z);
animate();

if (import.meta.env.DEV) window.game = { scene, car, bike, camera, renderer, drive, keys, traffic, people, zombies, debris, step, places, peopleSlots, mob, isDrivable }; // console poking while testing

