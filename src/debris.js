import * as THREE from 'three';
import { DYNAMIC_LAYER } from './world.js';

// Flying pieces of smashed stalls: thrown along the impact, tumble under gravity, bounce, settle,
// then disappear after a while. Simple per-piece rigid bodies, no piece-to-piece collision.

const GRAVITY = 22;
const GROUND = 0.2; // pavement / market ground height
const LIFETIME = 45;
const MAX_PIECES = 600;

export function createDebris(scene) {
    const pieces = [];
    const spin = new THREE.Quaternion();
    const axis = new THREE.Vector3();

    return {
        // parts: [{ geometry, material, matrix }] in world space; (dirX, dirZ) the way the bike was going
        spawn(parts, dirX, dirZ, speed) {
            for (const part of parts) {
                const mesh = new THREE.Mesh(part.geometry, part.material);
                part.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
                mesh.layers.set(DYNAMIC_LAYER);
                scene.add(mesh);
                const push = speed * THREE.MathUtils.randFloat(0.25, 0.8);
                if (!part.geometry.boundingSphere) part.geometry.computeBoundingSphere();
                pieces.push({
                    mesh,
                    vel: new THREE.Vector3(dirX * push + THREE.MathUtils.randFloatSpread(4), THREE.MathUtils.randFloat(2, 7), dirZ * push + THREE.MathUtils.randFloatSpread(4)),
                    rot: new THREE.Vector3(THREE.MathUtils.randFloatSpread(12), THREE.MathUtils.randFloatSpread(12), THREE.MathUtils.randFloatSpread(12)),
                    radius: part.geometry.boundingSphere.radius * Math.min(mesh.scale.x, mesh.scale.y, mesh.scale.z),
                    age: 0,
                });
            }
            while (pieces.length > MAX_PIECES) scene.remove(pieces.shift().mesh); // oldest go first
        },
        update(dt) {
            for (let i = pieces.length - 1; i >= 0; i--) {
                const p = pieces[i];
                if ((p.age += dt) > LIFETIME) {
                    scene.remove(p.mesh);
                    pieces.splice(i, 1);
                    continue;
                }
                if (p.resting) continue;
                p.vel.y -= GRAVITY * dt;
                p.mesh.position.addScaledVector(p.vel, dt);
                const angle = p.rot.length() * dt;
                if (angle > 0) p.mesh.quaternion.premultiply(spin.setFromAxisAngle(axis.copy(p.rot).normalize(), angle));
                // Bounce off the ground, losing energy each time, until it lies still
                const floor = GROUND + Math.min(p.radius, 0.3);
                if (p.mesh.position.y < floor) {
                    p.mesh.position.y = floor;
                    p.vel.y *= -0.3;
                    p.vel.x *= 0.6;
                    p.vel.z *= 0.6;
                    p.rot.multiplyScalar(0.5);
                    if (Math.abs(p.vel.y) < 0.6 && Math.hypot(p.vel.x, p.vel.z) < 0.3) p.resting = true;
                }
            }
        },
    };
}
