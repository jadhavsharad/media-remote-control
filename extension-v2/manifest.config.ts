import { defineManifest } from '@crxjs/vite-plugin'


export default defineManifest({
  manifest_version: 3,
  name: "Media Remote Control",
  version: "0.2",
  permissions: ["tabs", "storage", "offscreen", "scripting"],
  host_permissions:["*://*.youtube.com/*"],
  background: {
    "service_worker": "src/background/background.tsx",
    "type": "module"
  },
  content_scripts: [{
    matches: ["<all_urls>"],
    js: ["src/content/content.tsx"],
    run_at: "document_idle",
  }],
})
