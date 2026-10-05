import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DYNAMIC_LAYER } from './world.js';

// Small downloaded props (bin bags, bottles, rubbish piles, wheelbarrows), each baked into one geometry per
// material, scaled so its biggest side is `size` metres, standing on y = 0, centred. Then drawn instanced.

const loader = new GLTFLoader();

export async function loadProp(url, size) {
    const model = (await loader.loadAsync(url)).scene;
    model.updateMatrixWorld(true);
    const byMaterial = new Map();
    model.traverse((o) => {
        if (!o.isMesh) return;
        const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        if (!g.attributes.normal) g.computeVertexNormals();
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        if (!byMaterial.has(o.material)) byMaterial.set(o.material, []);
        byMaterial.get(o.material).push(g);
    });
    const parts = [...byMaterial].map(([material, geometries]) => ({ material, geometry: mergeGeometries(geometries) }));
    const box = new THREE.Box3();
    for (const p of parts) {
        p.geometry.computeBoundingBox();
        box.union(p.geometry.boundingBox);
    }
    const dims = box.getSize(new THREE.Vector3());
    const scale = size / Math.max(dims.x, dims.y, dims.z);
    const centre = box.getCenter(new THREE.Vector3());
    for (const p of parts) p.geometry.translate(-centre.x, -box.min.y, -centre.z).scale(scale, scale, scale);
    return parts;
}

// items: [x, y, z, rotY, scale]; lying: tip it on its side (bottles).
// Returns { update(player) }: only items within `range` of the player are drawn, re-picked a few times a second.
export async function placeProps(scene, url, size, items, { lying = false, range = 120 } = {}) {
    if (!items.length) return { update() {} };
    const parts = await loadProp(url, size);
    const o = new THREE.Object3D();
    const placed = items.map(([x, y, z, ry, s = 1]) => {
        o.position.set(x, y, z);
        o.rotation.set(lying ? Math.PI / 2 : 0, ry, 0, 'YXZ');
        o.scale.setScalar(s);
        o.updateMatrix();
        return { x, z, matrix: o.matrix.toArray() };
    });
    const meshes = parts.map(({ geometry, material }) => {
        const mesh = new THREE.InstancedMesh(geometry, material, items.length);
        mesh.layers.set(DYNAMIC_LAYER);
        mesh.frustumCulled = false; // we cull by distance ourselves
        mesh.count = 0;
        scene.add(mesh);
        return mesh;
    });
    let timer = 0;
    return {
        update(player, dt) {
            if ((timer -= dt) > 0) return;
            timer = 0.4;
            let n = 0;
            for (const p of placed) {
                if (Math.abs(p.x - player.x) > range || Math.abs(p.z - player.z) > range) continue;
                for (const mesh of meshes) mesh.instanceMatrix.array.set(p.matrix, n * 16);
                n++;
            }
            for (const mesh of meshes) {
                mesh.count = n;
                mesh.instanceMatrix.needsUpdate = true;
            }
        },
    };
}
