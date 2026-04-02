// pedestrian.js

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export class Pedestrian {
  constructor(scene, carStateRef) { // Pass GUI instance and carState
    this.scene = scene;
    this.carState = carStateRef; // Store carState reference

    this.model = null;
    this.mixer = null;
    this.actions = {};
    this.currentAction = null;
    this.state = "idle";

    this.speed = 3.5;
    this.animationSpeed = 2;
    this.animationCycleDistance = 1;

    this.cooldown = false;
    this.cooldownTime = 2000;
    this.chaseDistance = 1.5;
    this.startPosition = new THREE.Vector3();
    this.hasStarted = false;

   
    this.loadModel();
  }


  loadModel() {
    const loader = new GLTFLoader();
    loader.load(
        "models/zombie_number_10_animated_gltf/Untitled.glb",
        (gltf) => {
            this.model = gltf.scene;
            this.model.scale.set(1, 1, 1);
            // Use the carState reference here
            const carPosition = this.carState.modelRoot ? this.carState.modelRoot.position : this.carState.initialCar.position; // Assuming initialCar is passed or accessible
            this.model.position.set(carPosition.x + 10, 0, carPosition.z + 10);

            this.mixer = new THREE.AnimationMixer(this.model);
            const clips = gltf.animations;

            console.log("Available gltf animation clips:", clips.map((clip, index) => `${index}: ${clip.name}`));


            if (clips.length === 0) {
                console.warn("No animations found in gltf file.");
                return;
            }

            this.actions = {
                idle: this.mixer.clipAction(clips[1]),
                walk: this.mixer.clipAction(clips[5]),
                run: this.mixer.clipAction(clips[8]),
                attack: this.mixer.clipAction(clips[6]),
                death: this.mixer.clipAction(clips[4]),
            };

            Object.values(this.actions).forEach((action) => {
                action.loop = THREE.LoopRepeat;
                action.clampWhenFinished = false;
                action.timeScale = this.animationSpeed;
            });

            this.setState("idle");
            this.scene.add(this.model);

            setTimeout(() => {
                this.startChase = true;
            }, 2000);
        },
        undefined,
        (error) => {
            console.error("Error loading pedestrian gltf:", error);
        }
    );
  }

  setState(newState) {
    if (this.state === newState || !this.actions[newState]) return;

    if (this.currentAction) {
      this.currentAction.fadeOut(0.2);
    }

    this.currentAction = this.actions[newState];

    if (newState === "walk" || newState === "run") {
      const currentPos = this.model.position.clone();

      if (this.state !== newState) {
        this.startPosition.copy(currentPos);
      }

      const traveledDistance = currentPos.distanceTo(this.startPosition);
      const clip = this.currentAction.getClip();
      const clipDuration = clip.duration;

      if (this.animationCycleDistance > 0) {
        const normalizedOffset = (traveledDistance % this.animationCycleDistance) / this.animationCycleDistance;
        this.currentAction.time = normalizedOffset * clipDuration;
      } else {
        this.currentAction.time = 0;
      }
    } else {
      this.currentAction.time = 0;
    }

    this.currentAction.reset().fadeIn(0.2).play();
    this.state = newState;
  }

  update(delta) {
    if (!this.model) return;
    if (this.mixer) this.mixer.update(delta);

    if (!this.startChase || this.cooldown) return;

    // Use the carState reference here
    const carPosition = this.carState.modelRoot ? this.carState.modelRoot.position : this.carState.initialCar.position;
    const direction = new THREE.Vector3().subVectors(
      carPosition,
      this.model.position
    );
    const distance = direction.length();
    direction.normalize();

    const lookAtPosition = carPosition.clone();
    lookAtPosition.y = this.model.position.y;
    this.model.lookAt(lookAtPosition);

    if (distance > this.chaseDistance) {
      if (this.state !== "run") {
        this.setState("run");
      }
      this.model.position.add(direction.multiplyScalar(this.speed * delta));
    } else {
      if (this.state !== "attack") {
        this.setState("attack");
        this.cooldown = true;
        setTimeout(() => {
          this.cooldown = false;
        }, this.cooldownTime);
      }
    }
  }
}