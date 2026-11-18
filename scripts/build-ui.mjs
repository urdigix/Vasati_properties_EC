import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'public/component-demos');
await mkdir(output, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['src/demos/rainbow-button/main.tsx'],
  outfile: path.join(output, 'rainbow-button.js'),
  bundle: true,
  minify: true,
  jsx: 'automatic',
  platform: 'browser',
  target: ['es2020'],
  define: { 'process.env.NODE_ENV': '"production"' },
});
const styles = await postcss([
  tailwindcss({
    content: [path.join(root, 'src/components/ui/rainbow-borders-button.tsx')],
    theme: { extend: {} },
    plugins: [],
  }),
  autoprefixer,
]).process('@tailwind base;\n@tailwind components;\n@tailwind utilities;', { from: undefined });
await writeFile(path.join(output, 'rainbow-button.css'), styles.css);
console.log('Built React rainbow button demo in public/component-demos');
