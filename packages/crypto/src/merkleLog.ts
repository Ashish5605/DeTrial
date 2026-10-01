import { keccak256, getBytes, concat, toUtf8Bytes } from "ethers";

export function hashLeaf(leafBytes: Uint8Array | string): string {
    let bytes: Uint8Array;
    if (typeof leafBytes === "string") {
        if (leafBytes.startsWith("0x")) {
            bytes = getBytes(leafBytes);
        } else {
            bytes = toUtf8Bytes(leafBytes);
        }
    } else {
        bytes = leafBytes;
    }
    return keccak256(concat([new Uint8Array([0x00]), bytes]));
}

export function hashNode(left: string, right: string): string {
    return keccak256(concat([new Uint8Array([0x01]), getBytes(left), getBytes(right)]));
}

export function largestPowerOfTwoLessThan(n: number): number {
    let k = 1;
    while (k * 2 < n) k *= 2;
    return k;
}

export class MerkleLog {
    private leafHashes: string[] = [];

    constructor(leaves: (Uint8Array | string)[] = []) {
        for (const leaf of leaves) {
            this.append(leaf);
        }
    }

    append(leafBytes: Uint8Array | string): number {
        this.leafHashes.push(hashLeaf(leafBytes));
        return this.leafHashes.length;
    }

    getSize(): number {
        return this.leafHashes.length;
    }

    getRoot(treeSize: number = this.leafHashes.length): string {
        if (treeSize === 0) return keccak256(new Uint8Array(0));
        return this.mth(this.leafHashes.slice(0, treeSize));
    }

    private mth(entries: string[]): string {
        const n = entries.length;
        if (n === 1) return entries[0];
        const k = largestPowerOfTwoLessThan(n);
        return hashNode(this.mth(entries.slice(0, k)), this.mth(entries.slice(k, n)));
    }

    getInclusionProof(index: number, treeSize: number = this.leafHashes.length): string[] {
        if (index >= treeSize || index < 0) throw new Error("Index out of bounds");
        return this.path(index, this.leafHashes.slice(0, treeSize));
    }

    private path(m: number, entries: string[]): string[] {
        const n = entries.length;
        if (n === 1) return [];
        const k = largestPowerOfTwoLessThan(n);
        if (m < k) {
            return [...this.path(m, entries.slice(0, k)), this.mth(entries.slice(k, n))];
        } else {
            return [...this.path(m - k, entries.slice(k, n)), this.mth(entries.slice(0, k))];
        }
    }

    getConsistencyProof(oldSize: number, newSize: number): string[] {
        if (oldSize < 1 || oldSize > newSize || newSize > this.leafHashes.length) {
            throw new Error("Invalid sizes for consistency proof");
        }
        return this.subproof(oldSize, this.leafHashes.slice(0, newSize), true);
    }

    private subproof(m: number, entries: string[], b: boolean): string[] {
        const n = entries.length;
        if (m === n) {
            if (b) return [];
            return [this.mth(entries)];
        }
        const k = largestPowerOfTwoLessThan(n);
        if (m <= k) {
            return [...this.subproof(m, entries.slice(0, k), b), this.mth(entries.slice(k, n))];
        } else {
            return [...this.subproof(m - k, entries.slice(k, n), false), this.mth(entries.slice(0, k))];
        }
    }
}

export function verifyInclusion(
    leafHash: string,
    index: number,
    treeSize: number,
    proof: string[],
    expectedRoot: string
): boolean {
    if (index >= treeSize || index < 0) return false;
    let pIdx = proof.length - 1;

    function evalProof(idx: number, size: number): string {
        if (size === 1) return leafHash;
        const k = largestPowerOfTwoLessThan(size);
        if (idx < k) {
            const right = proof[pIdx--];
            const left = evalProof(idx, k);
            return hashNode(left, right);
        } else {
            const left = proof[pIdx--];
            const right = evalProof(idx - k, size - k);
            return hashNode(left, right);
        }
    }

    try {
        const computed = evalProof(index, treeSize);
        return computed === expectedRoot && pIdx === -1;
    } catch {
        return false;
    }
}

export function verifyConsistency(
    oldSize: number,
    newSize: number,
    oldRoot: string,
    newRoot: string,
    proof: string[]
): boolean {
    if (oldSize === newSize) return oldRoot === newRoot && proof.length === 0;
    if (oldSize === 0 || oldSize > newSize) return false;

    let pIdx = proof.length - 1;

    function evalConsistency(m: number, n: number, b: boolean): [string, string] {
        if (m === n) {
            if (b) return [oldRoot, oldRoot];
            const node = proof[pIdx--];
            return [node, node];
        }
        const k = largestPowerOfTwoLessThan(n);
        if (m <= k) {
            const right = proof[pIdx--];
            const [leftOld, leftNew] = evalConsistency(m, k, b);
            return [leftOld, hashNode(leftNew, right)];
        } else {
            const left = proof[pIdx--];
            const [rightOld, rightNew] = evalConsistency(m - k, n - k, false);
            return [hashNode(left, rightOld), hashNode(left, rightNew)];
        }
    }

    try {
        const [computedOld, computedNew] = evalConsistency(oldSize, newSize, true);
        return computedOld === oldRoot && computedNew === newRoot && pIdx === -1;
    } catch {
        return false;
    }
}
