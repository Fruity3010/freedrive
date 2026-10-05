import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadCity } from './road.js';
import { LoadingScreen } from './ui/LoadingScreen.js';
import { HUD } from './ui/HUD.js';
import { GameManager } from './GameManager.js';

// Initialize loading screen and game manager
const loadingScreen = new LoadingScreen();
const gameManager = new GameManager();
let hud = null;

// Loading manager
const loadingManager = new THREE.LoadingManager();
loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
    const progress = itemsLoaded / itemsTotal;
    loadingScreen.updateProgress(progress);
};
loadingManager.onLoad = () => {
    setTimeout(() => {
        loadingScreen.hide();
        if (hud) hud.show();
    }, 500);
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); // Sky blue
scene.fog = new THREE.Fog(0x87CEEB, 10, 1000);

// Camera - diagonal top view
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(-15, 20, -15);
camera.lookAt(0, 0, 0);
const hemiLight = new THREE.HemisphereLight(0xffffbb, 0x080820, 1);
scene.add(hemiLight);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// Lighting
const ambientLight = new THREE.AmbientLight(0x404040);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(10, 20, 10);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 1024;  // Reduced for performance
directionalLight.shadow.mapSize.height = 1024; // Reduced for performance
directionalLight.shadow.camera.far = 100;
scene.add(directionalLight);

// Ground
const groundGeometry = new THREE.PlaneGeometry(1000, 1000);
const groundMaterial = new THREE.MeshStandardMaterial({ 
    color: 0x3a5f0b,
    roughness: 0.8,
    metalness: 0.2
});
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
ground.position.y = -0.01; // Prevents road and ground z-fighting

scene.add(ground);
function createWall(x, z, width, height, depth) {
  const wallGeometry = new THREE.BoxGeometry(width, height, depth);
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x888888 });
  const wall = new THREE.Mesh(wallGeometry, wallMaterial);
  wall.position.set(x, height / 2, z); // raise to ground level
  wall.castShadow = true;
  wall.receiveShadow = true;
  scene.add(wall);
}

// Wall dimensions
const wallThickness = 2;
const wallHeight = 10;
const halfSize = 500; // since ground is 1000x1000

// Create walls on all 4 sides
createWall(0, -halfSize + wallThickness / 2, 1000, wallHeight, wallThickness); // North
createWall(0, halfSize - wallThickness / 2, 1000, wallHeight, wallThickness);  // South
createWall(-halfSize + wallThickness / 2, 0, wallThickness, wallHeight, 1000); // West
createWall(halfSize - wallThickness / 2, 0, wallThickness, wallHeight, 1000);  // East

// Initialize HUD
hud = new HUD();
hud.hide(); // Hide until assets load

loadCity(scene);

// Car placeholder (will be removed after model loads)
const carGeometry = new THREE.BoxGeometry(3, 1, 5);
const carMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
const car = new THREE.Mesh(carGeometry, carMaterial);
car.position.y = 0.5;
car.castShadow = true;
scene.add(car);

// Load GLB car model and replace the box car (with loading manager)
const loader = new GLTFLoader(loadingManager);
loader.load(
  'models/sedan_car_gltf/scene.gltf',
  (gltf) => {
    const carModel = gltf.scene;
    carModel.scale.set(0.01, 0.01, 0.01); // Adjust scale
    carModel.position.copy(car.position);

    // Enable shadows for all meshes in the model
    carModel.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
      }
    });

    scene.remove(car);
    scene.add(carModel);

    // Update car state with the loaded model
    carState.modelRoot = carModel;
  },
  undefined,
  (error) => {
    console.error('Error loading car model:', error);
  }
);

// Trees
function createTree(x, z) {
    const trunkGeometry = new THREE.CylinderGeometry(0.2, 0.2, 2);
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.position.set(x, 1, z);
    trunk.castShadow = true;
    
    const leavesGeometry = new THREE.SphereGeometry(1.5, 16, 16);
    const leavesMaterial = new THREE.MeshStandardMaterial({ color: 0x228B22 });
    const leaves = new THREE.Mesh(leavesGeometry, leavesMaterial);
    leaves.position.set(x, 3, z);
    leaves.castShadow = true;
    
    scene.add(trunk);
    scene.add(leaves);
}

// Add some trees (reduced for performance)
for (let i = 0; i < 20; i++) {
    const x = (Math.random() - 0.5) * 500;
    const z = (Math.random() - 0.5) * 500;
    createTree(x, z);
}

// Controls
const keys = {
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false
};

document.addEventListener('keydown', (event) => {
    if (keys.hasOwnProperty(event.key)) {
        keys[event.key] = true;
    }
});

document.addEventListener('keyup', (event) => {
    if (keys.hasOwnProperty(event.key)) {
        keys[event.key] = false;
    }
});

// Game state
const carState = {
    speed: 0,
    maxSpeed: 1.2,
    acceleration: 0.005,
    deceleration: 0.038,
    turnSpeed: 0.02,
    direction: new THREE.Vector3(0, 0, -1),
    modelRoot: null,  // Will hold the loaded car model
    boundingBox: new THREE.Box3()
};

// Zombie class
class Zombie {
    constructor(scene, carState) {
        this.scene = scene;
        this.carState = carState;
        this.model = null;
        this.mixer = null;
        this.speed = THREE.MathUtils.randFloat(2.0, 3.5);
        this.boundingBox = new THREE.Box3();
        this.isAttacked = false;
        this.velocity = new THREE.Vector3();

        this.loadModel();
    }

    loadModel() {
        const loader = new GLTFLoader(loadingManager);
        loader.load('models/zombie_number_10_animated_gltf/Untitled.glb', (gltf) => {
            this.model = gltf.scene;
            this.model.scale.set(1, 1, 1);
            const carPosition = this.carState.modelRoot ? this.carState.modelRoot.position : car.position;
            this.model.position.set(
                carPosition.x + (Math.random() - 0.5) * 100,
                0,
                carPosition.z + (Math.random() - 0.5) * 100
            );
            this.model.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            this.mixer = new THREE.AnimationMixer(this.model);
            const runAnimation = this.mixer.clipAction(gltf.animations[8]); // Run animation
            runAnimation.play();

            this.scene.add(this.model);
            this.boundingBox.setFromObject(this.model);
        });
    }

    update(delta) {
        if (!this.model) return;

        // Apply velocity decay
        if (this.velocity.lengthSq() > 0.0001) {
            this.model.position.add(this.velocity.clone().multiplyScalar(delta));
            this.velocity.multiplyScalar(0.9);
        }

        if (this.mixer) this.mixer.update(delta);
        this.boundingBox.setFromObject(this.model);

        // Chase the car
        if (!this.isAttacked) {
            const carPosition = this.carState.modelRoot ? this.carState.modelRoot.position : car.position;
            const direction = new THREE.Vector3().subVectors(carPosition, this.model.position);
            const distance = direction.length();
            direction.normalize();

            const lookAtPosition = carPosition.clone();
            lookAtPosition.y = this.model.position.y;
            this.model.lookAt(lookAtPosition);

            if (distance > 2.0) {
                this.model.position.add(direction.multiplyScalar(this.speed * delta));
            } else {
                // Attack range - damage player
                if (Math.random() < 0.05) {
                    gameManager.onZombieAttack();
                }
            }
        }
    }

    handleCollision(carBoundingBox) {
        if (this.isAttacked) return;
        this.isAttacked = true;

        gameManager.onZombieHit();

        // Push zombie away
        const pushDirection = new THREE.Vector3().subVectors(
            this.model.position,
            carBoundingBox.getCenter(new THREE.Vector3())
        ).normalize();
        this.velocity.add(pushDirection.multiplyScalar(5));

        setTimeout(() => {
            this.isAttacked = false;
        }, 300);
    }
}

// Spawn 10 zombies (reduced for performance)
const zombies = [];
for (let i = 0; i < 10; i++) {
    zombies.push(new Zombie(scene, carState));
}

// Game loop
const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();
    const activeCar = carState.modelRoot || car; // Use model if loaded, otherwise use placeholder

    // Update game manager
    gameManager.update(delta);

    // Update HUD
    if (hud) {
        hud.updateHealth(gameManager.health, gameManager.maxHealth);
        hud.updateScore(gameManager.score);
        hud.updateTime(gameManager.survivalTime);
    }

    // Update car bounding box
    if (carState.modelRoot) {
        carState.boundingBox.setFromObject(carState.modelRoot);
    }

    // Update zombies and check collisions
    zombies.forEach(zombie => {
        zombie.update(delta);
        if (zombie.model && carState.modelRoot && !zombie.isAttacked) {
            if (carState.boundingBox.intersectsBox(zombie.boundingBox)) {
                zombie.handleCollision(carState.boundingBox);
            }
        }
    });

    // Movement controls
    if (keys.ArrowUp) {
        carState.speed = Math.min(carState.speed + carState.acceleration, carState.maxSpeed);
    } else if (keys.ArrowDown) {
        carState.speed = Math.max(carState.speed - carState.acceleration, -carState.maxSpeed * 0.5);
    } else {
        // Decelerate when no keys pressed
        if (carState.speed > 0) {
            carState.speed = Math.max(0, carState.speed - carState.deceleration);
        } else if (carState.speed < 0) {
            carState.speed = Math.min(0, carState.speed + carState.deceleration);
        }
    }

    // Steering
    if (keys.ArrowLeft && Math.abs(carState.speed) > 0.01) {
        activeCar.rotation.y += carState.turnSpeed * (carState.speed > 0 ? 1 : -1);
    }
    if (keys.ArrowRight && Math.abs(carState.speed) > 0.01) {
        activeCar.rotation.y -= carState.turnSpeed * (carState.speed > 0 ? 1 : -1);
    }

    // Update car position
    carState.direction.set(0, 0, 1).applyQuaternion(activeCar.quaternion);
    activeCar.position.add(carState.direction.clone().multiplyScalar(carState.speed));

    // Update camera
    camera.position.copy(activeCar.position);
    camera.position.x += -12;
    camera.position.y += 100;
    camera.position.z += 12;
    camera.lookAt(activeCar.position);

    renderer.render(scene, camera);
}

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Start the game
animate();