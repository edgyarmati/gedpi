import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Provider model registration.
 *
 * Pi now handles provider and model management natively, so GedPi no longer
 * ships its own provider catalog or custom model setup commands. This module
 * retains the minimal surface that the rest of the codebase imports.
 */

// Kept for config.ts re-export compatibility. Pi manages the actual model list.
export const AVAILABLE_MODELS: never[] = [];

export async function registerGedProviders(_api: ExtensionAPI): Promise<void> {
  // No-op: Pi handles provider registration natively.
}
