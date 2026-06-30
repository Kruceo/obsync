import esbuild from 'esbuild';
import process from 'process';
import fs from 'fs';
import path from 'path';

const prod = process.argv[2] === 'production';
const rootDir = process.cwd();

const checkAssetsPlugin = {
  name: 'check-assets',
  setup(build) {
    build.onEnd(() => {
      const manifestPath = path.join(rootDir, 'manifest.json');
      const stylesPath = path.join(rootDir, 'styles.css');

      if (!fs.existsSync(manifestPath)) {
        console.warn('[check-assets] manifest.json not found in root');
      } else {
        console.log('[check-assets] manifest.json found');
      }

      if (!fs.existsSync(stylesPath)) {
        console.warn('[check-assets] styles.css not found in root');
      } else {
        console.log('[check-assets] styles.css found');
      }
    });
  },
};

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  external: ['obsidian'],
  format: 'cjs',
  target: 'es2022',
  sourcemap: !prod,
  treeShaking: true,
  outfile: 'main.js',
  minify: prod,
  plugins: [checkAssetsPlugin],
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
