import * as THREE from 'three';

function organicWave(time: number, a: number, b: number, c: number, phase: number) {
  return Math.sin(time * a + phase) * 0.56
    + Math.sin(time * b + phase * 1.73) * 0.29
    + Math.cos(time * c + phase * 2.41) * 0.15;
}

export function sampleUniverseMotion(
  time: number,
  position: THREE.Vector3,
  rotation: THREE.Euler
) {
  // One shared clock drives every star, galaxy, nebula, dust field and planet
  // in DeepSpaceBackground. The higher multiplier makes the transformation
  // readable across the full viewport without introducing discontinuities.
  const motionTime = time * 2.4;
  const amplitudeDrift = 0.86
    + organicWave(motionTime, 0.008, 0.013, 0.019, 0.7) * 0.16;
  rotation.set(
    organicWave(motionTime, 0.029, 0.071, 0.113, 1.35) * 0.44 * amplitudeDrift,
    organicWave(motionTime, 0.037, 0.083, 0.131, 0.45) * 0.98 * amplitudeDrift,
    organicWave(motionTime, 0.021, 0.059, 0.097, 2.2) * 0.2
  );
  position.set(
    organicWave(motionTime, 0.031, 0.077, 0.127, 0.2) * 3.8 * amplitudeDrift,
    organicWave(motionTime, 0.023, 0.067, 0.109, 1.1) * 1.85 * amplitudeDrift,
    organicWave(motionTime, 0.017, 0.053, 0.091, 2.45) * 2.45 * amplitudeDrift
  );
}

const universePosition = new THREE.Vector3();
const universeRotation = new THREE.Euler();

export function localUniversePointToWorld(
  localPoint: THREE.Vector3,
  time: number,
  target = new THREE.Vector3()
) {
  sampleUniverseMotion(time, universePosition, universeRotation);
  return target.copy(localPoint).applyEuler(universeRotation).add(universePosition);
}
