import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Our clothed characters, posed sitting and baked into plain static geometry so a busload of them can be
// drawn as a few instanced batches (no skeletons or animation to pay for). Each part says whether it takes
// the per-passenger shirt or skin colour.

const X = new THREE.Vector3(1, 0, 0);
const CUT_BELOW_HIPS = -0.12; // metres below the hips: everything lower is cut away

function bend(bone, axis, angle) {
    const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const turn = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    bone.quaternion.premultiply(parent.clone().invert().multiply(turn).multiply(parent));
    bone.updateMatrixWorld(true);
}

// file: character model; shirt: its main garment material; height in metres.
// Returns { parts: [{ geometry, material, tint: 'shirt' | 'skin' | null }] } with the hips at y = 0
export async function loadSeated(file, shirt, height = 1.75) {
    const model = (await new GLTFLoader().loadAsync(file)).scene;
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    model.scale.setScalar(height / size.y);
    model.updateMatrixWorld(true);
    const bone = (name) => model.getObjectByName(name.replace('.', ''));
    for (const side of ['L', 'R']) {
        bend(bone(`UpperLeg.${side}`), X, -1.45); // thighs forward onto the seat
        bend(bone(`LowerLeg.${side}`), X, 2.0); // shins tucked back under the seat
        bend(bone(`UpperArm.${side}`), X, -0.35); // hands towards the lap
    }
    const hips = bone('Hips').getWorldPosition(new THREE.Vector3());

    const byMaterial = new Map();
    const v = new THREE.Vector3();
    model.traverse((o) => {
        if (!o.isSkinnedMesh) return;
        o.skeleton.update();
        // Bake the posed skin into world-space positions (same vertex order as the original, so the
        // bone weights line up), then put the hips at the origin
        const src = o.geometry.attributes.position;
        const pos = new THREE.BufferAttribute(new Float32Array(src.count * 3), 3);
        for (let i = 0; i < src.count; i++) {
            v.fromBufferAttribute(src, i);
            o.applyBoneTransform(i, v);
            v.applyMatrix4(o.matrixWorld).sub(hips);
            pos.setXYZ(i, v.x, v.y, v.z);
        }
        let baked = new THREE.BufferGeometry();
        baked.setAttribute('position', pos);
        if (o.geometry.index) baked.setIndex(o.geometry.index.clone());
        baked = baked.toNonIndexed(); // all parts the same shape of buffer, so they merge
        // Only the upper body is ever seen through the windows; drop anything below the seat so no legs
        // or shoes poke out under the bus (danfos have no floor under the benches)
        const p = baked.attributes.position;
        const keep = [];
        for (let i = 0; i < p.count; i += 3) {
            if (Math.max(p.getY(i), p.getY(i + 1), p.getY(i + 2)) > CUT_BELOW_HIPS) keep.push(i);
        }
        const trimmed = new Float32Array(keep.length * 9);
        keep.forEach((i, k) => trimmed.set(p.array.subarray(i * 3, i * 3 + 9), k * 9));
        baked = new THREE.BufferGeometry();
        baked.setAttribute('position', new THREE.BufferAttribute(trimmed, 3));
        baked.computeVertexNormals();
        if (!byMaterial.has(o.material.name)) byMaterial.set(o.material.name, { material: o.material, geometries: [] });
        byMaterial.get(o.material.name).geometries.push(baked);
    });
    const parts = [...byMaterial.values()].map(({ material, geometries }) => {
        const tint = material.name === shirt ? 'shirt' : material.name.startsWith('Skin') ? 'skin' : null;
        const m = new THREE.MeshStandardMaterial({ color: tint ? 0xffffff : material.color, roughness: 0.85 });
        if (/hair|eyebrow|moustache/i.test(material.name)) m.color.set(0x151210);
        return { geometry: mergeGeometries(geometries), material: m, tint, darker: material.name === 'Skin_Darker' };
    });
    return { parts };
}
