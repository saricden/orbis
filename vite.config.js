import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Allow access through the temporary Cloudflare quick tunnel
    // (hostname changes each run, so all *.trycloudflare.com hosts are allowed).
    allowedHosts: ['.trycloudflare.com'],
  },
});
