import { terser } from 'rollup-plugin-terser';

export default {
  input: 'src/index.js',
  output: {
    file: 'dist/spicy.min.js',
    format: 'iife',
    plugins: [terser()],
  },
};
