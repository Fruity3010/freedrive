import * as THREE from 'three';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

// Physical sky plus a reflective, rippling lagoon lit by the same sun
export function setupEnvironment(scene, renderer, sunLight) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;

    const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(60), THREE.MathUtils.degToRad(200));
    sunLight.position.copy(sun).multiplyScalar(300);

    const sky = new Sky();
    sky.scale.setScalar(4500);
    const u = sky.material.uniforms;
    u.turbidity.value = 8; // Lagos haze
    u.rayleigh.value = 1.5;
    u.mieCoefficient.value = 0.005;
    u.mieDirectionalG.value = 0.8;
    u.sunPosition.value.copy(sun);

    // Bake the sky into an environment map once, so glass and metal reflect it
    sky.scale.setScalar(50); // inside the bake camera's far plane
    const envScene = new THREE.Scene();
    envScene.add(sky);
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(envScene).texture;
    sky.scale.setScalar(4500);
    scene.add(sky);

    const normals = new THREE.TextureLoader().load('textures/waternormals.jpg');
    normals.wrapS = normals.wrapT = THREE.RepeatWrapping;
    const water = new Water(new THREE.PlaneGeometry(4000, 4000), {
        textureWidth: 256, // reflection is rippled anyway; 512 cost 4x the pixels
        textureHeight: 256,
        waterNormals: normals,
        sunDirection: sun.clone(),
        sunColor: 0xffffff,
        waterColor: 0x0f3d47, // murky lagoon green-blue
        distortionScale: 3.7,
        fog: !!scene.fog,
    });
    water.rotation.x = -Math.PI / 2;
    water.position.y = -1.5;
    scene.add(water);

    return (dt, camera) => {
        water.material.uniforms.time.value += dt * 0.6;
        sky.position.copy(camera.position);
    };
}
