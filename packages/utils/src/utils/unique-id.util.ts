import { createId, init } from "@orama/cuid2";

/**
 * Generate a unique id for Collision-resistant ids optimized for horizontal scaling and binary search lookup performance.
 */
export function createUniqueId() {
  return createId();
}

/**
 * The init function returns a custom createId function with the specified configuration.
 */
const createUniqueSlugHof = init({
  // the length of the id
  length: 10,
});

/**
 * Generate a unique slug for human-readable ids optimized for SEO and user experience.
 */
export function createUniqueSlug() {
  return createUniqueSlugHof();
}
