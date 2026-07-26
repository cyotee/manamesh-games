// snarkjs ships incomplete TypeScript declarations in some versions.
// We keep a minimal ambient module so consumers and tsc can typecheck.
declare module "snarkjs" {
  export const groth16: {
    fullProve: (
      input: unknown,
      wasmFile: string | Uint8Array,
      zkeyFileName: string | Uint8Array,
    ) => Promise<{ proof: unknown; publicSignals: unknown }>;
    verify: (
      vkey: unknown,
      publicSignals: unknown,
      proof: unknown,
    ) => Promise<boolean>;
    exportSolidityCallData?: (proof: unknown, publicSignals: unknown) => Promise<string>;
  };
}
