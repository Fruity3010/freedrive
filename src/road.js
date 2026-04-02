import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const roadMap = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 1, 0, 0, 0, 1],
  [1, 0, 2, 0, 1, 0, 3, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 0, 1, 0, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 4, 0, 1, 0, 5, 0, 1],
  [1, 0, 0, 0, 1, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1]
];

// 0 = empty lot, 1 = road, 2 = apartment, 3 = modern building, 4 = old building, 5 = storage

// Create 3 reusable building geometries (created once, cloned many times)
const buildingTypes = {
  small: null,
  medium: null,
  tall: null
};

function createBuildingTypes() {
  // Small building (10 units tall)
  const smallGeom = new THREE.BoxGeometry(18, 10, 18);
  const smallMat = new THREE.MeshStandardMaterial({
    color: 0x8B7355,
    roughness: 0.8
  });
  buildingTypes.small = new THREE.Mesh(smallGeom, smallMat);
  buildingTypes.small.castShadow = true;
  buildingTypes.small.receiveShadow = true;

  // Medium building (20 units tall)
  const mediumGeom = new THREE.BoxGeometry(18, 20, 18);
  const mediumMat = new THREE.MeshStandardMaterial({
    color: 0x6B5345,
    roughness: 0.7
  });
  buildingTypes.medium = new THREE.Mesh(mediumGeom, mediumMat);
  buildingTypes.medium.castShadow = true;
  buildingTypes.medium.receiveShadow = true;

  // Tall building (35 units tall)
  const tallGeom = new THREE.BoxGeometry(18, 35, 18);
  const tallMat = new THREE.MeshStandardMaterial({
    color: 0x4B3335,
    roughness: 0.6
  });
  buildingTypes.tall = new THREE.Mesh(tallGeom, tallMat);
  buildingTypes.tall.castShadow = true;
  buildingTypes.tall.receiveShadow = true;
}

function placeBuilding(x, z, type, scene) {
  if (!buildingTypes.small) {
    createBuildingTypes();
  }

  let building;
  switch(type) {
    case 'small':
      building = buildingTypes.small.clone();
      building.position.set(x, 5, z);
      break;
    case 'medium':
      building = buildingTypes.medium.clone();
      building.position.set(x, 10, z);
      break;
    case 'tall':
      building = buildingTypes.tall.clone();
      building.position.set(x, 17.5, z);
      break;
  }

  scene.add(building);
}

// Reusable street light (no shadow casting for performance)
let streetLightTemplate = null;

function createStreetLightTemplate() {
  const lightGroup = new THREE.Group();

  // Pole
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x404040 });
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 8),
    poleMat
  );
  pole.position.set(0, 4, 0);
  lightGroup.add(pole);

  // Light fixture
  const fixtureMat = new THREE.MeshStandardMaterial({
    color: 0x202020,
    emissive: 0xffff00,
    emissiveIntensity: 0.5
  });
  const fixture = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.5),
    fixtureMat
  );
  fixture.position.set(0, 8, 0);
  lightGroup.add(fixture);

  // Point light (no shadow for performance)
  const light = new THREE.PointLight(0xffaa00, 1.5, 25);
  light.position.set(0, 8, 0);
  lightGroup.add(light);

  return lightGroup;
}

function placeStreetLight(x, z, scene) {
  if (!streetLightTemplate) {
    streetLightTemplate = createStreetLightTemplate();
  }

  const light = streetLightTemplate.clone(true);
  light.position.set(x, 0, z);
  scene.add(light);
}

export function loadCity(scene) {
  const tileSize = 25;
  const roadWidth = tileSize * 2;
  const roadHeight = 0.05;

  const roadMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a });
  const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0x6a6a6a });
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x3a5f0b, roughness: 0.8 });

  const group = new THREE.Group();
  const rows = roadMap.length;
  const cols = roadMap[0].length;

  const loader = new GLTFLoader();

  // Store building model references
  const buildingModels = {};

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cellType = roadMap[row][col];
      const x = (col - cols / 2) * tileSize;
      const z = (row - rows / 2) * tileSize;

      if (cellType === 1) {
        // Road
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

        // Add road lines
        const lineMat = new THREE.MeshStandardMaterial({ color: 0xffff00 });
        const lineGeom = new THREE.BoxGeometry(0.3, 0.02, tileSize * 0.8);
        const line = new THREE.Mesh(lineGeom, lineMat);
        line.position.set(x, roadHeight + 0.02, z);
        line.receiveShadow = true;
        group.add(line);

        // Add sidewalks on all 4 sides
        const sidewalkWidth = 5;
        const sidewalkHeight = 0.2;
        const sidewalkLength = tileSize;
        const sidewalkGeom = new THREE.BoxGeometry(sidewalkLength, sidewalkHeight, sidewalkWidth);

        const offsets = [
          [x, roadHeight + 0.1, z + tileSize / 2],
          [x, roadHeight + 0.1, z - tileSize / 2],
          [x - tileSize / 2, roadHeight + 0.1, z],
          [x + tileSize / 2, roadHeight + 0.1, z],
        ];

        offsets.forEach(([sx, sy, sz], i) => {
          const sidewalk = new THREE.Mesh(sidewalkGeom, sidewalkMat);
          sidewalk.position.set(sx, sy, sz);
          if (i >= 2) sidewalk.rotation.y = Math.PI / 2;
          sidewalk.receiveShadow = true;
          group.add(sidewalk);

          // Add street lights on corners
          if (i === 0 && Math.random() < 0.3) {
            placeStreetLight(sx + 8, sz, scene);
          }
        });

      } else if (cellType === 0) {
        // Empty lot with grass
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(tileSize, tileSize), grassMat);
        plane.rotation.x = -Math.PI / 2;
        plane.position.set(x, roadHeight, z);
        plane.receiveShadow = true;
        group.add(plane);

        // Random building (70% chance for more density)
        if (Math.random() < 0.7) {
          const rand = Math.random();
          if (rand < 0.33) {
            placeBuilding(x, z, 'small', scene);
          } else if (rand < 0.66) {
            placeBuilding(x, z, 'medium', scene);
          } else {
            placeBuilding(x, z, 'tall', scene);
          }
        }

      } else if (cellType === 2) {
        // Tall building (apartment style)
        placeBuilding(x, z, 'tall', scene);

      } else if (cellType === 3) {
        // Medium building (modern style)
        placeBuilding(x, z, 'medium', scene);

      } else if (cellType === 4) {
        // Small building (old style)
        placeBuilding(x, z, 'small', scene);

      } else if (cellType === 5) {
        // Tall building (storage style)
        placeBuilding(x, z, 'tall', scene);
      }
    }
  }

  scene.add(group);
}