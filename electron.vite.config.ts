import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Three builds: main (Node), preload (bridge) and renderer (React).
// Packages in "dependencies" stay external in main; everything the renderer imports is bundled.
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react()]
  }
})
