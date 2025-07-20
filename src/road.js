import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const roadMap = [
  [1, 1, 1, 1, 1, 1, 1,],
  [1, 0, 0, 0, 0, 0, 0,],
  [1, 0, 1, 0, 1, 0, 1,],
  [1, 0, 0, 0, 0, 0, 0,],
  [1, 0, 1, 0, 1, 0, 1,],
  [1, 0, 0, 0, 0, 0, 0,],
  [1, 0, 1, 0, 1, 0, 1,],
  [1, 0, 0, 0, 0, 0, 0,],
  [1, 0, 1, 0, 1, 0, 1,],
  [1, 1, 1, 1, 1, 1, 1,]
];


export function loadCity(scene) {
  const tileSize = 25;
  const roadWidth = tileSize * 2;
  const roadHeight = 0.05;

  const roadMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
  const carParkMat = new THREE.MeshStandardMaterial({ color: 0x0000ff });
  const buildingMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa });
  const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0x888888 });

  const group = new THREE.Group();
  const rows = roadMap.length;
  const cols = roadMap[0].length;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const isRoad = roadMap[row][col] === 1;
      const x = (col - cols / 2) * tileSize;
      const z = (row - rows / 2) * tileSize;

      if (isRoad) {
        const shape = new THREE.Shape();
        const radius = 3;

        shape.moveTo(-roadWidth / 2 + radius, -roadWidth / 2);
        shape.lineTo(roadWidth / 2 - radius, -roadWidth / 2);
        shape.quadraticCurveTo(roadWidth / 2, -roadWidth / 2, roadWidth / 2, -roadWidth / 2 + radius);
        shape.lineTo(roadWidth / 2, roadWidth / 2 - radius);
        shape.quadraticCurveTo(roadWidth / 2, roadWidth / 2, roadWidth / 2 - radius, roadWidth / 2);
        shape.lineTo(-roadWidth / 2 + radius, roadWidth / 2);
        shape.quadraticCurveTo(-roadWidth / 2, roadWidth / 2, -roadWidth / 2, roadWidth / 2 - radius);
        shape.lineTo(-roadWidth / 2, -roadWidth / 2 + radius);
        shape.quadraticCurveTo(-roadWidth / 2, -roadWidth / 2, -roadWidth / 2 + radius, -roadWidth / 2);

        const extrudeSettings = {
          depth: 0.1,
          bevelEnabled: false
        };

        const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        const mesh = new THREE.Mesh(geometry, roadMat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(x, roadHeight, z);
        mesh.receiveShadow = true;
        group.add(mesh);

        // Add sidewalks on all 4 sides
        const sidewalkWidth = 5;
        const sidewalkHeight = 0.05;
        const sidewalkLength = tileSize;
        const sidewalkGeom = new THREE.BoxGeometry(sidewalkLength, sidewalkHeight, sidewalkWidth);

        const offsets = [
          [x, roadHeight + 0.01, z + tileSize / 2],
          [x, roadHeight + 0.01, z - tileSize / 2],
          [x - tileSize / 2, roadHeight + 0.01, z],
          [x + tileSize / 2, roadHeight + 0.01, z],
        ];

        offsets.forEach(([sx, sy, sz], i) => {
          const sidewalk = new THREE.Mesh(sidewalkGeom, sidewalkMat);
          sidewalk.position.set(sx, sy, sz);
          if (i >= 2) sidewalk.rotation.y = Math.PI / 2;
          sidewalk.receiveShadow = true;
          group.add(sidewalk);
        });

      } else {
        const mat = Math.random() < 0.4 ? carParkMat : buildingMat;
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(tileSize, tileSize), mat);
        plane.rotation.x = -Math.PI / 2;
        plane.position.set(x, roadHeight, z);
        plane.receiveShadow = true;
        group.add(plane);

        if (mat === buildingMat) {
          const height = 10 + Math.random() * 30;
          const box = new THREE.Mesh(
            new THREE.BoxGeometry(tileSize * 0.8, height, tileSize * 0.8),
            buildingMat
          );
          box.position.set(x, height / 2, z);
          box.castShadow = true;
          group.add(box);
        }
      }
    }
  }

  scene.add(group);
  spawnCars(scene, 10);
}

export function spawnCars(scene, numberOfCars = 5) {
  const loader = new GLTFLoader();
  const tileSize = 25;
  const roadHeight = 0.5;

  const positions = [];
  for (let r = 0; r < roadMap.length; r++) {
    for (let c = 0; c < roadMap[0].length; c++) {
      if (roadMap[r][c] === 1) {
        const x = (c - roadMap[0].length / 2) * tileSize;
        const z = (r - roadMap.length / 2) * tileSize;
        positions.push({ x, z });
      }
    }
  }

  loader.load(
    'models/sedan_car_gltf/scene.gltf',
    (gltf) => {
      for (let i = 0; i < numberOfCars; i++) {
        const pos = positions[Math.floor(Math.random() * positions.length)];
        const car = gltf.scene.clone(true);
        car.scale.set(0.01, 0.01, 0.01);
        car.position.set(pos.x, roadHeight, pos.z);
        car.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        scene.add(car);
      }
      console.log(`🚗 Spawned ${numberOfCars} cars`);
    },
    undefined,
    (err) => console.error('❌ Car model load error:', err)
  );
}