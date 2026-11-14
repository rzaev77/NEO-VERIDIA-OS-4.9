import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CameraMode, FollowSubMode, SpinnerState } from '../types';
import { TrafficSystem } from '../simulation/TrafficSystem';

export class CameraSystem {
  public readonly camera: THREE.PerspectiveCamera;
  public readonly controls: OrbitControls;

  private mode: CameraMode = 'orbit';
  private followSubMode: FollowSubMode = 'chase';
  private followedAgentIndex = 0;

  private readonly keysPressed = new Set<string>();
  private readonly smoothPos = new THREE.Vector3();
  private readonly smoothTarget = new THREE.Vector3();
  private readonly smoothUp = new THREE.Vector3(0, 1, 0);
  private followInitialized = false;

  // Reusable temporaries
  private readonly tmpEuler = new THREE.Euler();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpLocalPos = new THREE.Vector3();
  private readonly tmpLocalLook = new THREE.Vector3();
  private readonly tmpDesiredUp = new THREE.Vector3();
  private readonly tmpForward = new THREE.Vector3();
  private readonly tmpRight = new THREE.Vector3();

  private readonly onKeyDownBound: (e: KeyboardEvent) => void;
  private readonly onKeyUpBound: (e: KeyboardEvent) => void;

  constructor(domElement: HTMLElement, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.3, 1200);
    this.camera.position.set(118, 72, 140);

    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.target.set(0, 32, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.maxPolarAngle = Math.PI * 0.492;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 420;
    this.controls.update();

    this.onKeyDownBound = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      this.keysPressed.add(e.code);
    };
    this.onKeyUpBound = (e: KeyboardEvent) => {
      this.keysPressed.delete(e.code);
    };

    window.addEventListener('keydown', this.onKeyDownBound);
    window.addEventListener('keyup', this.onKeyUpBound);
  }

  public setMode(mode: CameraMode): void {
    if (this.mode === mode) return;
    this.mode = mode;

    if (mode === 'orbit') {
      this.camera.up.set(0, 1, 0);
      this.controls.enabled = true;
      // Place orbit target nicely in front of current camera position
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      this.controls.target.copy(this.camera.position).addScaledVector(dir, 45);
      this.controls.target.y = Math.max(4, this.controls.target.y);
      this.controls.update();
    } else {
      this.controls.enabled = false;
      this.followInitialized = false;
    }
  }

  public getMode(): CameraMode {
    return this.mode;
  }

  public setFollowSubMode(subMode: FollowSubMode): void {
    this.followSubMode = subMode;
    this.followInitialized = false;
  }

  public getFollowSubMode(): FollowSubMode {
    return this.followSubMode;
  }

  public toggleFollowSubMode(): FollowSubMode {
    this.followSubMode = this.followSubMode === 'chase' ? 'cockpit' : 'chase';
    this.followInitialized = false;
    return this.followSubMode;
  }

  public getFollowedAgentIndex(): number {
    return this.followedAgentIndex;
  }

  public nextAgent(traffic: TrafficSystem): number {
    const count = traffic.getActiveCount();
    this.followedAgentIndex = (this.followedAgentIndex + 1) % count;
    this.followInitialized = false;
    return this.followedAgentIndex;
  }

  public prevAgent(traffic: TrafficSystem): number {
    const count = traffic.getActiveCount();
    this.followedAgentIndex = (this.followedAgentIndex - 1 + count) % count;
    this.followInitialized = false;
    return this.followedAgentIndex;
  }

  public update(dt: number, traffic: TrafficSystem): SpinnerState {
    const activeCount = traffic.getActiveCount();
    if (this.followedAgentIndex >= activeCount) {
      this.followedAgentIndex = 0;
      this.followInitialized = false;
    }
    const agent = traffic.getAgent(this.followedAgentIndex);

    if (this.mode === 'orbit') {
      this.handleFreeFlyKeys(dt);
      this.controls.update();
      return agent;
    }

    // Follow-cam (Taxi mode)
    this.tmpEuler.set(agent.pitch, agent.yaw, agent.roll, 'YXZ');
    this.tmpQuat.setFromEuler(this.tmpEuler);

    if (this.followSubMode === 'cockpit') {
      // Driver seat inside spinner cabin looking forward
      this.tmpLocalPos.set(0, 0.56, 0.85).applyQuaternion(this.tmpQuat).add(agent.position);
      this.tmpLocalLook.set(0, 0.35, 38).applyQuaternion(this.tmpQuat).add(agent.position);
      this.tmpDesiredUp.set(0, 1, 0).applyQuaternion(this.tmpQuat);
      // Soften bank angle in cockpit for comfort
      this.tmpDesiredUp.lerp(new THREE.Vector3(0, 1, 0), 0.35).normalize();
    } else {
      // Third-person chase camera behind & slightly above
      this.tmpLocalPos.set(0, 2.5, -9.2).applyQuaternion(this.tmpQuat).add(agent.position);
      this.tmpLocalLook.set(0, 0.6, 22).applyQuaternion(this.tmpQuat).add(agent.position);
      this.tmpDesiredUp.set(0, 1, 0);
    }

    // Snap immediately on first frame or corridor wraparound teleport (> 100m jump)
    const jumpDist = this.smoothPos.distanceTo(this.tmpLocalPos);
    if (!this.followInitialized || jumpDist > 100) {
      this.smoothPos.copy(this.tmpLocalPos);
      this.smoothTarget.copy(this.tmpLocalLook);
      this.smoothUp.copy(this.tmpDesiredUp);
      this.followInitialized = true;
    } else {
      const posBlend = this.followSubMode === 'cockpit' ? 1 - Math.exp(-26 * dt) : 1 - Math.exp(-8.5 * dt);
      const lookBlend = this.followSubMode === 'cockpit' ? 1 - Math.exp(-24 * dt) : 1 - Math.exp(-10 * dt);
      this.smoothPos.lerp(this.tmpLocalPos, posBlend);
      this.smoothTarget.lerp(this.tmpLocalLook, lookBlend);
      this.smoothUp.lerp(this.tmpDesiredUp, 1 - Math.exp(-10 * dt)).normalize();
    }

    this.camera.position.copy(this.smoothPos);
    this.camera.up.copy(this.smoothUp);
    this.camera.lookAt(this.smoothTarget);

    return agent;
  }

  private handleFreeFlyKeys(dt: number): void {
    const moveSpeed = (this.keysPressed.has('ShiftLeft') || this.keysPressed.has('ShiftRight') ? 130 : 52) * dt;

    this.camera.getWorldDirection(this.tmpForward);
    this.tmpForward.y = 0;
    if (this.tmpForward.lengthSq() > 0.0001) {
      this.tmpForward.normalize();
    }
    this.tmpRight.crossVectors(this.tmpForward, this.camera.up).normalize();

    let moved = false;
    const delta = new THREE.Vector3();

    if (this.keysPressed.has('KeyW') || this.keysPressed.has('ArrowUp')) {
      delta.addScaledVector(this.tmpForward, moveSpeed);
      moved = true;
    }
    if (this.keysPressed.has('KeyS') || this.keysPressed.has('ArrowDown')) {
      delta.addScaledVector(this.tmpForward, -moveSpeed);
      moved = true;
    }
    if (this.keysPressed.has('KeyD') || this.keysPressed.has('ArrowRight')) {
      delta.addScaledVector(this.tmpRight, moveSpeed);
      moved = true;
    }
    if (this.keysPressed.has('KeyA') || this.keysPressed.has('ArrowLeft')) {
      delta.addScaledVector(this.tmpRight, -moveSpeed);
      moved = true;
    }
    if (this.keysPressed.has('KeyE')) {
      delta.y += moveSpeed;
      moved = true;
    }
    if (this.keysPressed.has('KeyQ')) {
      delta.y -= moveSpeed;
      moved = true;
    }

    if (moved) {
      // Keep above street level
      if (this.camera.position.y + delta.y < 3) {
        delta.y = Math.max(0, 3 - this.camera.position.y);
      }
      this.camera.position.add(delta);
      this.controls.target.add(delta);
    }
  }

  public resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.onKeyDownBound);
    window.removeEventListener('keyup', this.onKeyUpBound);
    this.controls.dispose();
  }
}
