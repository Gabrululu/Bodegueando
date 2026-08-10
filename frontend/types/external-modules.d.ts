// snarkjs and circomlibjs ship no TypeScript types and no "types"/"typings" export condition,
// so under moduleResolution "bundler" TS can't resolve them at all (not even as implicit
// `any`) without this. Both are only used server-side (API routes / lib/zkOracle.ts) — this
// is a deliberate `any` boundary at the edge of the ZK toolchain, not a shortcut we'd take
// for our own code.
declare module "snarkjs";
declare module "circomlibjs";
