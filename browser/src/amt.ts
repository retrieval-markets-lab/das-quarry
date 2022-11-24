import { decode } from "@ipld/dag-cbor";
import type { CID } from "multiformats";

const MAX_UINT64 = 1n << (64n - 1n);

interface BlockGetter {
  get(cid: CID): Promise<Uint8Array>;
}

/**
 * Given height 'height', how many nodes in a maximally full tree can we
 * build? (bitWidth^2)^height = width^height. If we pass in height+1 we can work
 * out how many elements a maximally full tree can hold, width^(height+1).
 */
function nodesForHeight(bitWidth: number, height: bigint): bigint {
  const heightLogTwo = BigInt(bitWidth) * height;
  if (heightLogTwo >= 64) {
    // The max depth layer may not be full.
    return MAX_UINT64;
  }
  return 1n << heightLogTwo;
}

/**
 * the number of bytes required such that there is a single bit for each element
 * in the links or value array. This is (bitWidth^2)/8.
 */
// function bmapBytes(bitWidth: number): number {
//   if (bitWidth <= 3) return 1;
//   return 1 << (bitWidth - 3);
// }

class Node<T> {
  bmap: Uint8Array;
  links: CID[] = [];
  values: T[] = [];

  _bg: BlockGetter;

  constructor(bmap: Uint8Array, bg: BlockGetter) {
    this.bmap = bmap;
    this._bg = bg;
  }

  async get(
    bitWidth: number,
    height: bigint,
    i: bigint
  ): Promise<T | undefined> {
    // height=0 means we're operating on a leaf node where the entries themselves
    // are stores, we have a `set` so it must exist if the node is correctly
    // formed
    if (height === 0n) {
      const d = this.values[Number(i)];
      return d;
    }

    // Non-leaf case where we need to navigate further down toward the correct
    // leaf by consuming some of the provided index to form the index at this
    // height and passing the remainder down.
    // The calculation performed is to divide the addressible indexes of each
    // child node such that each child has the ability to contain that range of
    // indexes somewhere in its graph. e.g. at height=1 for bitWidth=3, the total
    // addressible index space we can contain is in the range of 0 to
    // `(bitWidth^2) ^ (height+1) = 8^2 = 64`. Where each child node can contain
    // 64/8 of indexes. This is true regardless of the position in the overall
    // AMT and original index from the Get() operation because we modify the index
    // before passing it to lower nodes to remove the bits relevant to higher
    // addressing. e.g. at height=1, a call to any child's get() will receive an
    // index in the range of 0 to bitWidth^2.
    const nfh = nodesForHeight(bitWidth, height);
    const ln = this.links[Number(i / nfh)];
    if (ln == null) {
      // This can occur at any point in the traversal, not just height=0, it just
      // means that the higher up it occurs that a larger range of indexes in this
      // region don't exist.
      return ln;
    }

    const subn = await Node.load<T>(ln, bitWidth, height - 1n, this._bg);

    // `i%nfh` discards index information for this height so the child only gets
    // the part of the index that is relevant for it.
    // e.g. get(50) at height=1 for width=8 would be 50%8=2, i.e. the child will
    // be asked to get(2) and it will have leaf nodes (because it's height=0) so
    // the actual value will be at index=2 of its values array.
    return subn.get(bitWidth, height - 1n, i % nfh);
  }

  async *entries(
    bitWidth: number,
    height: bigint,
    start: bigint = 0n,
    offset: bigint = 0n
  ): AsyncGenerator<[bigint, T]> {
    if (height === 0n) {
      // height=0 means we're at leaf nodes and get to use our callback
      for (const [i, v] of this.values.entries()) {
        if (!v) {
          continue;
        }

        const ix = offset + BigInt(i);
        if (ix < start) {
          // if we're here, 'start' is probably somewhere in the
          // middle of this node's elements
          continue;
        }

        // use 'offset' to determine the actual index for this element, it
        // tells us how distant we are from the left-most leaf node
        yield [ix, v];
      }
      return;
    }

    const subCount = nodesForHeight(bitWidth, height);
    for (const [i, ln] of this.links.entries()) {
      if (!ln) {
        continue;
      }

      // 'offs' tells us the index of the left-most element of the subtree defined
      // by 'sub'
      const offs = offset + BigInt(i) * subCount;
      const nextOffs = offs + subCount;
      if (start >= nextOffs) {
        // if we're here, 'start' lets us skip this entire sub-tree
        continue;
      }

      const subn = await Node.load<T>(ln, bitWidth, height - 1n, this._bg);

      // recurse into the child node, providing 'offs' to tell it where it's
      // located in the tree
      yield* subn.entries(bitWidth, height - 1n, start, offs);
    }
  }

  static async load<T>(
    ln: CID,
    bitWidth: number,
    height: bigint,
    bg: BlockGetter
  ): Promise<Node<T>> {
    const blk = await bg.get(ln);
    const data: any = decode(blk);

    return newNode(data, bitWidth, bg);
  }
}

// hacky minimal AMT reader based on https://github.com/eifil/amt-ipld
export class AMT<T> {
  bitWidth: number;
  height: bigint;
  count: bigint;
  node: Node<T>;

  constructor(bitWidth: number, height: bigint, count: bigint, node: Node<T>) {
    this.bitWidth = bitWidth;
    this.height = height;
    this.count = count;
    this.node = node;
  }

  static async load<T>(root: CID, bg: BlockGetter): Promise<AMT<T>> {
    const data = await bg.get(root);
    const obj: any = decode(data);

    const ndinput = obj[3];

    const node = newNode<T>(ndinput, obj[0], bg);

    return new AMT(obj[0], BigInt(obj[1]), BigInt(obj[2]), node);
  }

  static async loadAdt0<T>(root: CID, bg: BlockGetter): Promise<AMT<T>> {
    const data = await bg.get(root);
    const obj: any = decode(data);

    const ndinput = obj[2];
    const node = newNode<T>(ndinput, 8, bg);

    return new AMT(8, BigInt(obj[0]), BigInt(obj[1]), node);
  }

  async get(i: bigint): Promise<T | undefined> {
    // easy shortcut case, index is too large for our height, don't bother
    // looking further
    if (i >= nodesForHeight(this.bitWidth, this.height + 1n)) {
      return;
    }
    return this.node.get(this.bitWidth, this.height, i);
  }

  entries() {
    return this.node.entries(this.bitWidth, this.height);
  }

  async *values() {
    for await (const kv of this.entries()) {
      yield kv[1];
    }
  }

  [Symbol.asyncIterator]() {
    return this.values();
  }
}

function newNode<T>(raw: any, bitWidth: number, bg: BlockGetter): Node<T> {
  const node = new Node<T>(raw[0], bg);
  const links = raw[1] || [];
  const values = raw[2] || [];

  if (node.links.length && node.values.length) {
    // malformed AMT, a node cannot be both leaf and non-leaf
    throw new Error("node cannot be both leaf and non-leaf");
  }

  // strictly require the bitmap to be the correct size for the given bitWidth
  // it may not be the case for adt0 so we'll skip this check for now
  // const expWidth = bmapBytes(bitWidth);
  // if (expWidth !== node.bmap.length) {
  //   throw new Error(
  //     `expected bitfield to be ${expWidth} bytes long, found bitfield with ${node.bmap.length} bytes`
  //   );
  // }

  const width = 1 << bitWidth;
  let i = 0;
  if (values.length) {
    // leaf node, height=0
    for (let x = 0; x < width; x++) {
      // check if this value exists in the bitmap, pull it out of the compacted
      // list if it does
      if ((node.bmap[Math.floor(x / 8)] & (1 << x % 8)) > 0) {
        if (i >= values.length) {
          // too many bits were set in the bitmap for the number of values
          // available
          throw new Error(
            `expected at least ${i + 1} values, found ${values.length}`
          );
        }
        node.values[x] = values[i];
        i++;
      }
    }
    if (i !== Object.keys(values).length) {
      // the number of bits set in the bitmap was not the same as the number of
      // values in the array
      throw new Error(
        `expected ${i} values, got ${Object.keys(values).length}`
      );
    }
  } else if (links.length) {
    // non-leaf node, height>0
    for (let x = 0; x < width; x++) {
      // check if this child link exists in the bitmap, pull it out of the
      // compacted list if it does
      if ((node.bmap[Math.floor(x / 8)] & (1 << x % 8)) > 0) {
        if (i >= links.length) {
          // too many bits were set in the bitmap for the number of values
          // available
          throw new Error(
            `expected at least ${i + 1} links, found ${links.length}`
          );
        }
        const c = links[i];
        if (c == null) {
          throw new Error("CID undefined");
        }
        // TODO: check link hash function.
        if (c.code !== 0x71) {
          throw new Error(`internal amt nodes must be cbor, found ${c.code}`);
        }
        node.links[x] = c;
        i++;
      }
    }
    if (i !== Object.keys(links).length) {
      // the number of bits set in the bitmap was not the same as the number of
      // values in the array
      throw new Error(`expected ${i} links, got ${Object.keys(links).length}`);
    }
  }
  return node;
}
