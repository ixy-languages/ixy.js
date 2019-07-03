function getPktBuffer(mempool, index) {
  const ret = mempool.pkt_buffers[index];
  return ret;
}

class Packet {
  constructor(mempool, index, entry_size) {
    this.mempool = mempool;
    this.mem = new DataView(mempool.base_addr, index * entry_size, entry_size);
    this.mem8 = new Uint8Array(mempool.base_addr, index * entry_size, entry_size);
    this.mem32 = new Uint32Array(mempool.base_addr, index * entry_size, entry_size / 4);
    // if we could assume entry_size % 8 == 0 we could add 64-bit as well, but we can't
  }
}

// This is only called during setup , so we can use constructors etc.
function createPktBuffer(mempool, index, entry_size) {
  return new Packet(mempool, index, entry_size);
}


function setPktBufData(buffer, data) {
  // data is an 8bit array
  for (let i = 0; i < data.length; i++) {
    buffer.mem8[i] = data[i];
    if (i > 2048) {
      throw new Error('Too large data provided.');
    }
  }
}

function pkt_buf_alloc_batch_js(mempool, bufs, num_bufs) {
  if (mempool.free_stack_top < num_bufs) {
    console.warn(`memory pool ${mempool} only has ${mempool.free_stack_top} free bufs, requested ${num_bufs}`);
    num_bufs = mempool.free_stack_top;
  }
  for (let i = 0; i < num_bufs; i++) {
    const entry_id = mempool.free_stack[--mempool.free_stack_top];
    const buf = getPktBuffer(mempool, entry_id);
    bufs[i] = buf;
  }
  return bufs;
}

function pkt_buf_alloc_js(mempool) {
  const bufs = new Array(1);
  const buf = pkt_buf_alloc_batch_js(mempool, bufs, 1);
  return buf[0];
}

function pkt_buf_free(buf) {
  const { mempool } = buf;
  mempool.free_stack[mempool.free_stack_top++] = buf.mempool_idx;
}

module.exports = {
  create: createPktBuffer,
  set: setPktBufData,
  alloc: pkt_buf_alloc_js,
  allocBatch: pkt_buf_alloc_batch_js,
  free: pkt_buf_free,
};
