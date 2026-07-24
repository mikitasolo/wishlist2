// Stops the app server and ephemeral MongoDB started in global-setup.
export default async function globalTeardown() {
  const state = globalThis.__E2E__;
  if (state?.server) {
    try {
      state.server.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  if (state?.mongo) {
    try {
      await state.mongo.stop();
    } catch {
      /* already stopped */
    }
  }
}
