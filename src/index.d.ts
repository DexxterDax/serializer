declare function Decode(encoded: string, compressed: boolean): unknown;
declare function Encode(decoded: unknown, shouldCompress: boolean): string;
export { Decode, Encode };
