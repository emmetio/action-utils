import typescript from 'rollup-plugin-typescript2';
import nodeResolve from 'rollup-plugin-node-resolve';

export default {
    input: './src/index.ts',
    external: ['emmet', '@emmetio/html-matcher', '@emmetio/css-matcher'],
    plugins: [nodeResolve(), typescript({
        tsconfigOverride: {
            compilerOptions: { module: 'esnext' }
        }
    })],
    output: [{
        file: './dist/action-utils.es.js',
        format: 'es',
        sourcemap: true
    }, {
        file: './dist/action-utils.cjs.js',
        format: 'cjs',
        exports: 'named',
        sourcemap: true
    }]
};
