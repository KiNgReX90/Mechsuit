/**
 * Random single-word codenames for spawned agent sessions.
 *
 * Each terminal/agent session gets a stable, human-friendly codename at spawn so
 * tiles read as "Nova", "Orion", … rather than a raw UUID. Names are picked at
 * random from a curated list, skipping any already in use; if the whole list is
 * exhausted, a numeric suffix keeps them unique ("Nova-2", "Nova-3", …).
 */

/** Curated pool of single-word codenames (celestial / mythic / elemental). */
export const SESSION_CODENAMES = [
  "Apollo",
  "Atlas",
  "Aurora",
  "Cinder",
  "Cobalt",
  "Comet",
  "Cosmos",
  "Echo",
  "Ember",
  "Flux",
  "Frost",
  "Halo",
  "Helios",
  "Indigo",
  "Iris",
  "Juno",
  "Kepler",
  "Lumen",
  "Lyra",
  "Maple",
  "Nebula",
  "Nimbus",
  "Nova",
  "Onyx",
  "Orion",
  "Phoenix",
  "Pulsar",
  "Quartz",
  "Quasar",
  "Raven",
  "Rigel",
  "Sable",
  "Sol",
  "Solstice",
  "Spark",
  "Tundra",
  "Vega",
  "Vesper",
  "Volt",
  "Zephyr",
] as const;

/**
 * Pick a codename not present in `taken`. Prefers an unused base name (chosen via
 * `rng`); when every base name is in use, returns the first free `Name-N` suffix
 * (N starting at 2) so the result is always unique. `rng` defaults to
 * `Math.random` and is injectable for deterministic tests.
 */
export function generateSessionName(
  taken: Iterable<string>,
  rng: () => number = Math.random,
): string {
  const used = new Set(taken);

  const free = SESSION_CODENAMES.filter((name) => !used.has(name));
  if (free.length > 0) {
    return free[Math.floor(rng() * free.length)];
  }

  // Pool exhausted: walk suffixes deterministically until one is free.
  for (let suffix = 2; ; suffix += 1) {
    for (const base of SESSION_CODENAMES) {
      const candidate = `${base}-${suffix}`;
      if (!used.has(candidate)) return candidate;
    }
  }
}
