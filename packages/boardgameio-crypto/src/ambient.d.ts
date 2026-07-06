// `snarkjs` and `elliptic` ship no TypeScript declarations. The frontend that
// originally hosted this code never ran `tsc` (it transpiles via esbuild), so
// both were effectively `any`. These ambient shims preserve that reality so the
// package's `typecheck` script reflects the standard the code was written against.
declare module 'snarkjs';
declare module 'elliptic';
