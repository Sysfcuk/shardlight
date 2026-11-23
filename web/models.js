// The gems, built in code: a brilliant-style cut (table, crown, girdle, pavilion) turned on a
// lathe with eight facets and flat shading, so every facet catches light on its own.
// Pieces stand on y = 0, point down, and are about 0.75 units across.
import * as THREE from 'three';

/** A faceted gem. `facets` sides around; the profile is the classic cut, bottom point up to the flat table. */
export function gemGeometry(facets = 8) {
  const profile = [
    [0.0, 0.05],   // culet (bottom point)
    [0.33, 0.33],  // pavilion up to the girdle
    [0.36, 0.38],  // girdle
    [0.25, 0.52],  // crown
    [0.17, 0.56],  // table edge
    [0.0, 0.56],   // table centre
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(profile, facets, Math.PI / facets);
  const flat = g.toNonIndexed();
  flat.computeVertexNormals(); // non-indexed: every facet gets its own flat normal
  flat.computeBoundingSphere();
  return flat;
}

/** A small glowing orb for the cave wisps. */
export function wispGeometry() { return new THREE.IcosahedronGeometry(0.3, 1); }

/**
 * Gem material. Desktop: real refraction (transmission) with a little dispersion for fire.
 * Phones: no transmission pass; a glossy, softly glowing stone instead, which reads the same at
 * a glance and costs far less.
 */
export function gemMaterial(color, { rich = true } = {}) {
  const c = new THREE.Color(color);
  if (rich) {
    return new THREE.MeshPhysicalMaterial({
      color: c, roughness: 0.04, metalness: 0, transmission: 0.82, thickness: 0.55, ior: 1.77, dispersion: 0.35,
      attenuationColor: c, attenuationDistance: 0.6, specularIntensity: 1, clearcoat: 1, clearcoatRoughness: 0.03,
      emissive: c, emissiveIntensity: 0.16, flatShading: true, envMapIntensity: 1.6,
    });
  }
  return new THREE.MeshPhysicalMaterial({
    color: c, roughness: 0.08, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05, emissive: c, emissiveIntensity: 0.32,
    flatShading: true, envMapIntensity: 1.8,
  });
}
