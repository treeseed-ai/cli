import { withDevelopmentLifecycle } from '../../src/cli/commands/development-support/lifecycle.ts';

await withDevelopmentLifecycle({ ...process.env, XDG_STATE_HOME: process.argv[2] }, async () => {
    process.send?.('entered');
    await new Promise<void>(resolve => process.once('message', () => resolve()));
});
process.disconnect?.();
