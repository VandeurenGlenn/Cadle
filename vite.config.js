import {defineConfig} from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'www',
    assetsInlineLimit: 6000,
    emptyOutDir: false,
    minify: 'terser',
    terserOptions: {
      format: {
        comments: false,
      },
    },
  },
  plugins: [],
});
