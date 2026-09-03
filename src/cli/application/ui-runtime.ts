/**
 * Runtime bridge for UI-owned Ink components.
 *
 * The CLI build bundles the shared component implementation into this local
 * module while keeping React and Ink external. This guarantees that the Ink
 * reconciler and every shared hook use the CLI's single React peer during
 * local package-overlay development as well as in the published artifact.
 */
export * from '@treeseed/ui/ink';
