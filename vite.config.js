import { defineConfig, loadEnv } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const requirePassword = env.REQUIRE_PASSWORD === 'true';

  return {
    server: {
      // Allow access through the temporary Cloudflare quick tunnel
      // (hostname changes each run, so all *.trycloudflare.com hosts are allowed).
      allowedHosts: ['.trycloudflare.com'],
    },
    // pagecrypt (see scripts/protect-build.mjs) only encrypts the built
    // index.html, so when password protection is on, everything it
    // references needs to be inlined into that one file for the protection
    // to actually cover the app rather than just its markup shell.
    plugins:
      command === 'build' && requirePassword
        ? // useRecommendedBuildConfig also force-inlines every asset project-wide
          // as base64 (assetsInlineLimit), which would bloat the separate ASR
          // worker chunk with its ~23MB onnxruntime WASM dependency. We only
          // need this plugin's HTML/CSS inlining, so that option stays off.
          [viteSingleFile({ useRecommendedBuildConfig: false })]
        : [],
  };
});
