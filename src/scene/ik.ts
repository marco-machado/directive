import { Vector3 } from 'three';

const along = new Vector3(), bend = new Vector3();

// Two-bone IK for a limb rooted at `root` with segment lengths `upper` and `lower`: writes where the joint
// (`elbow`) and the end (`hand`) go so the end reaches `target`, the joint bending toward `pole`. A target out
// of reach straightens the limb toward it; one closer than the segments can fold stops at the fold.
export function twoBone(root: Vector3, target: Vector3, upper: number, lower: number, pole: Vector3, elbow: Vector3, hand: Vector3) {
  along.subVectors(target, root);
  const reach = Math.min(upper + lower - 1e-5, Math.max(Math.abs(upper - lower) + 1e-5, along.length()));
  if (along.lengthSq() < 1e-12) along.set(0, -1, 0);
  along.normalize();
  hand.copy(root).addScaledVector(along, reach);
  // Law of cosines: how far along the reach the joint sits, and how far off it toward the pole.
  const x = (upper * upper - lower * lower + reach * reach) / (2 * reach), off = Math.sqrt(Math.max(0, upper * upper - x * x));
  bend.subVectors(pole, root);
  bend.addScaledVector(along, -bend.dot(along));
  // A pole on the reach line gives no bend direction; any perpendicular will do.
  if (bend.lengthSq() < 1e-12) bend.set(along.y, -along.x, 0);
  if (bend.lengthSq() < 1e-12) bend.set(0, 0, 1);
  bend.normalize();
  elbow.copy(root).addScaledVector(along, x).addScaledVector(bend, off);
}
