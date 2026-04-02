// car.js

import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as THREE from "three"; // Import THREE if needed directly in this module

// Car state (export so main.js can access it)
export const carState = {
  speed: 0,
  maxSpeed: 1.2,
  acceleration: 0.006,
  deceleration: 0.038,
  turnSpeed: 0.02,
  direction: new THREE.Vector3(0, 0, -1),
  modelRoot: null,
};

// Keyboard controls specific to the car
const keys = {
  ArrowUp: false,
  ArrowDown: false,
  ArrowLeft: false,
  ArrowRight: false,
};

document.addEventListener("keydown", (event) => {
  if (keys.hasOwnProperty(event.key)) {
    keys[event.key] = true;
  }
});

document.addEventListener("keyup", (event) => {
  if (keys.hasOwnProperty(event.key)) {
    keys[event.key] = false;
  }
});

// Function to set up and load the car model
export function setupCar(scene, initialCarPlaceholder) {
  const loader = new GLTFLoader();
  loader.load(
    "models/chevy-avalanche (1)/source/Chevy_Avalanche.glb",
    (gltf) => {
      const carModel = gltf.scene;
      carModel.scale.set(1, 1, 1); // Adjust scale
      carModel.position.copy(initialCarPlaceholder.position);

      // Enable shadows for all meshes in the model
      carModel.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
        }
      });

      scene.remove(initialCarPlaceholder); // Remove placeholder
      scene.add(carModel);
      carState.modelRoot = carModel; // Update carState with the loaded model
    },
    undefined,
    (error) => {
      console.error("Error loading car model:", error);
    }
  );
}

// Function to update car movement (called in the animate loop)
export function updateCar(activeCar, delta) {
  if (keys.ArrowUp) {
    carState.speed = Math.min(
      carState.speed + carState.acceleration,
      carState.maxSpeed
    );
  } else if (keys.ArrowDown) {
    carState.speed = Math.max(
      carState.speed - carState.acceleration,
      -carState.maxSpeed * 0.5
    );
  } else {
    if (carState.speed > 0) {
      carState.speed = Math.max(0, carState.speed - carState.deceleration);
    } else if (carState.speed < 0) {
      carState.speed = Math.min(0, carState.speed + carState.deceleration);
    }
  }

  if (keys.ArrowLeft && Math.abs(carState.speed) > 0.01) {
    activeCar.rotation.y += carState.turnSpeed * (carState.speed > 0 ? 1 : -1);
  }
  if (keys.ArrowRight && Math.abs(carState.speed) > 0.01) {
    activeCar.rotation.y -= carState.turnSpeed * (carState.speed > 0 ? 1 : -1);
  }

  carState.direction.set(0, 0, 1).applyQuaternion(activeCar.quaternion);
  activeCar.position.add(
    carState.direction.clone().multiplyScalar(carState.speed)
  );
}