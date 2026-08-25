import { loadEnv } from 'vite';
import { encrypt } from 'pagecrypt';

// Runs after `vite build`. If REQUIRE_PASSWORD is "true" in .env, encrypts
// the already-built dist/index.html (which vite.config.js will have bundled
// as a single file for this mode) in place with pagecrypt, using
// APP_PASSWORD. Otherwise this is a no-op and the build stays unprotected.

const env = loadEnv('production', process.cwd(), '');

if (env.REQUIRE_PASSWORD !== 'true') {
  console.log('REQUIRE_PASSWORD is not "true" - build stays unprotected.');
  process.exit(0);
}

const password = env.APP_PASSWORD;

if (!password) {
  console.error('REQUIRE_PASSWORD is "true" but APP_PASSWORD is not set in .env. Aborting build.');
  process.exit(1);
}

await encrypt('dist/index.html', 'dist/index.html', password);
console.log('dist/index.html is now password-protected (pagecrypt).');
