const fs = require('fs');
const addon = require('./build/Release/exported_module'); // eslint-disable-line import/no-unresolved
const defines = require('./constants');


// check if little or big endian
const littleEndian = (function lE() {
  const buffer = new ArrayBuffer(2);
  new DataView(buffer).setInt16(0, 256, true /* littleEndian */);
  // Int16Array uses the correct byte-order for the platform.
  return new Int16Array(buffer)[0] === 256;
}());

//  synchronous wait function for testing
function wait(ms) {
  const start = Date.now();
  let now = start;
  while (now - start < ms) {
    now = Date.now();
  }
}

const currentHost = 'narva'; // adjust this part before deploy on machine
let pciAddr;
let pciAddr2; // eslint-disable-line no-unused-vars
switch (currentHost) {
case 'narva':
  pciAddr = '0000:03:00.0';
  pciAddr2 = '0000:01:00.0';
  break;
case 'riga':
  pciAddr = '0000:04:00.0';
  pciAddr2 = '0000:06:00.0';
  break;
default:
  pciAddr = null;
  pciAddr2 = null;
}

function get_reg_js(dev, reg) {
  /*
  // first dv.get then c seems to break c as well, dv and c seem to differ at times, but not always...
  const ret = dev.dataView.getUint32(reg, littleEndian);
  const cRet = addon.get_reg_js(dev.addr, reg);

  if (ret != cRet) {
    console.log(`---------------------------------------------------------------we got ${ret} but C gave us ${cRet}`);
    return cRet;
  }
  console.log(`C and JS agree: ${ret}`);
  return ret;
  */

  // TODO test typed array here
  return addon.get_reg_js(dev.addr, reg);
}

function clear_flags_js(dev, reg, flags) {
  addon.set_reg_js(dev.addr, reg, get_reg_js(dev, reg) & ~flags);
}
function set_flags_js(dev, reg, flags) {
  addon.set_reg_js(dev.addr, reg, get_reg_js(dev, reg) | flags);
}

function wait_set_reg_js(dev, reg, val) {
  while ((get_reg_js(dev, reg) & val) !== val) {
    addon.set_reg_js(dev.addr, reg, val);
    wait(100); // TODO change this to non blocking interval
  }
}

function wait_clear_reg_js(dev, reg, val) {
  while ((get_reg_js(dev, reg) & val) !== 0) {
    clear_flags_js(dev.addr, reg, val);
    wait(100); // TODO change this to non blocking interval
  }
}

class RxDescriptor {
  constructor(virtMem, index = 0) {
    this.memView = virtMem;
    this.offset = index * 16;
  }

  pkt_addr() { return this.memView.d64[0 + this.offset / 8]; }

  hdr_addr() { return this.memView.d64[1 + this.offset / 8]; }

  lower() {
    return {
      lo_dword: {
        data: () => this.memView.d32[0 + this.offset / 4],
        hs_rss: {
          pkt_info: () => this.memView.d16[0 + this.offset / 2],
          hdr_info: () => this.memView.d16[1 + this.offset / 2],
        },
      },
      hi_dword: {
        rss: () => this.memView.d32[1 + this.offset / 4],
        ip_id: () => this.memView.d16[2 + this.offset / 2],
        csum: () => this.memView.d16[3 + this.offset / 2],
      },
    };
  }

  upper() {
    return {
      status_error: () => this.memView.d32[2 + this.offset / 4],
      length: () => this.memView.d16[6 + this.offset / 2],
      vlan: () => this.memView.d16[7 + this.offset / 2],
    };
  }
}
class TxDescriptor {
  constructor(virtMem, index = 0) {
    this.memView = virtMem;
    this.offset = index * 16;
  }


  read() {
    return {
      buffer_addr: () => this.memView.d64[0 + this.offset / 8],
      cmd_type_len: () => this.memView.d32[2 + this.offset / 4],
      olinfo_status: () => this.memView.d32[3 + this.offset / 4],
    };
  }


  wb() {
    return {
      rsvd: () => this.memView.d64[0 + this.offset / 8],
      nxtseq_seed: () => this.memView.d32[2 + this.offset / 4],
      status: () => this.memView.d32[3 + this.offset / 4],
    };
  }
}

// see section 4.6.7
// it looks quite complicated in the data sheet, but it's actually
// really easy because we don't need fancy features
function init_rx(ixgbe_device) {
  const IXYDevice = ixgbe_device.addr;
  const num_of_queues = ixgbe_device.ixy.num_rx_queues;
  // make sure that rx is disabled while re-configuring it
  // the datasheet also wants us to disable some crypto-offloading
  // related rx paths(but we don't care about them)
  clear_flags_js(ixgbe_device, defines.IXGBE_RXCTRL, defines.IXGBE_RXCTRL_RXEN);
  // no fancy dcb or vt, just a single 128kb packet buffer for us
  addon.set_reg_js(IXYDevice, defines.IXGBE_RXPBSIZE(0), defines.IXGBE_RXPBSIZE_128KB);
  for (let i = 1; i < 8; i++) {
    addon.set_reg_js(IXYDevice, defines.IXGBE_RXPBSIZE(i), 0);
  }
  // always enable CRC offloading
  set_flags_js(ixgbe_device, defines.IXGBE_HLREG0, defines.IXGBE_HLREG0_RXCRCSTRP);
  set_flags_js(ixgbe_device, defines.IXGBE_RDRXCTL, defines.IXGBE_RDRXCTL_CRCSTRIP);

  // accept broadcast packets
  set_flags_js(ixgbe_device, defines.IXGBE_FCTRL, defines.IXGBE_FCTRL_BAM);

  // per-queue config, same for all queues
  for (let i = 0; i < num_of_queues; i++) {
    console.info(`initializing rx queue ${i}`);
    // enable advanced rx descriptors,
    // we could also get away with legacy descriptors, but they aren't really easier
    addon.set_reg_js(IXYDevice, defines.IXGBE_SRRCTL(i),
      (get_reg_js(ixgbe_device, defines.IXGBE_SRRCTL(i)) & ~defines.IXGBE_SRRCTL_DESCTYPE_MASK)
      | defines.IXGBE_SRRCTL_DESCTYPE_ADV_ONEBUF);
    // drop_en causes the nic to drop packets if no rx descriptors are available
    // instead of buffering them
    // a single overflowing queue can fill up the whole buffer
    // and impact operations if not setting this flag
    set_flags_js(ixgbe_device, defines.IXGBE_SRRCTL(i), defines.IXGBE_SRRCTL_DROP_EN);
    // setup descriptor ring, see section 7.1.9
    const ring_size_bytes = defines.NUM_RX_QUEUE_ENTRIES * 16; // 128bit headers? -> 128/8 bytes
    const mem = {};
    mem.virt = addon.getDmaMem(ring_size_bytes, true);
    mem.phy = addon.virtToPhys(mem.virt);
    // neat trick from Snabb: initialize to 0xFF to prevent
    // rogue memory accesses on premature DMA activation
    const virtMemView = new Uint32Array(mem.virt);
    for (let count = 0; count < ring_size_bytes; count++) {
      virtMemView[count / 4] = 0xFFFFFFFF;
    }
    const PhysBeginning = Number(mem.phy) & 0xFFFFFFFF;
    const PhysEnding = Number(mem.phy >> BigInt(32)/* 32n */); // TODO rewrite to 1n syntax before running, but keep at BigInt(1) syntax because otherwise eslint will not work
    addon.set_reg_js(IXYDevice, defines.IXGBE_RDBAL(i), PhysBeginning);
    addon.set_reg_js(IXYDevice, defines.IXGBE_RDBAH(i), PhysEnding);
    addon.set_reg_js(IXYDevice, defines.IXGBE_RDLEN(i), ring_size_bytes);
    console.info(`rx ring ${i} phy addr: ${mem.phy}`);
    console.info(`rx ring ${i} virt addr: ${mem.virt}`);
    // set ring to empty at start
    addon.set_reg_js(IXYDevice, defines.IXGBE_RDH(i), 0);
    addon.set_reg_js(IXYDevice, defines.IXGBE_RDT(i), 0);
    // private data for the driver, 0-initialized
    const queue = {
      num_entries: defines.NUM_RX_QUEUE_ENTRIES,
      rx_index: 0,
      virtual_addresses: new Array(defines.NUM_RX_QUEUE_ENTRIES),
      descriptors: {
        d16: new Uint16Array(mem.virt),
        d32: new Uint32Array(mem.virt),
        d64: new BigUint64Array(mem.virt),
      },
    };
    ixgbe_device.rx_queues[i] = queue;
  }

  // last step is to set some magic bits mentioned in the last sentence in 4.6.7
  set_flags_js(ixgbe_device, defines.IXGBE_CTRL_EXT, defines.IXGBE_CTRL_EXT_NS_DIS);
  // this flag probably refers to a broken feature: it's reserved
  // and initialized as '1' but it must be set to '0'
  // there isn't even a constant in 'defines' for this flag
  for (let i = 0; i < num_of_queues; i++) {
    clear_flags_js(ixgbe_device, defines.IXGBE_DCA_RXCTRL(i), 1 << 12);
  }

  // start RX
  set_flags_js(ixgbe_device, defines.IXGBE_RXCTRL, defines.IXGBE_RXCTRL_RXEN);
}

// create and read buffer methods
/*
struct pkt_buf {
  // physical address to pass a buffer to a nic
  uintptr_t buf_addr_phy;
  struct mempool* mempool;
  uint32_t mempool_idx;
  uint32_t size;
  uint8_t head_room[SIZE_PKT_BUF_HEADROOM];
  uint8_t data[] __attribute__((aligned(64)));
};
*/


// TODO change how pkt_bufs extra info are saved, fully in JS!
function getPktBuffer(mempool, index) {
  const ret = mempool.pkt_buffers[index];
  return ret;
}

// This is only called during setup , so we can use constructors etc.
function createPktBuffer(mempool, index, entry_size) {
  // return { mem: new DataView(mempool.base_addr, index * entry_size, entry_size), mempool };
  // TODO we could think about this, but we still set and read bigger than 8 bit values, and the performance is only about 20% better
  return {
    mem8: new Uint8Array(mempool.base_addr, index * entry_size, entry_size),
    mem32: new Uint32Array(mempool.base_addr, index * entry_size, entry_size / 4),
    mem64: new BigUint64Array(mempool.base_addr, (index + 1) * entry_size - 8, 1), // we only need this for a single case
    mempool,
    mem: new DataView(mempool.base_addr, index * entry_size, entry_size), // for C to phys addr, we can change this later to use our typed array
  };
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

/* let's port mempool allocation first:
*/

function memory_allocate_mempool_js(num_entries, entry_size) {
  entry_size = entry_size || 2048;
  // require entries that neatly fit into the page size, this makes the memory pool much easier
  // otherwise our base_addr + index * size formula would be wrong
  // because we can't cross a page-boundary
  if (defines.HUGE_PAGE_SIZE % entry_size) {
    console.error(`entry size must be a divisor of the huge page size ${defines.HUGE_PAGE_SIZE}`);
  }
  const mem = addon.getDmaMem(num_entries * entry_size, false);
  const mempool = {};
  mempool.num_entries = num_entries;
  mempool.buf_size = entry_size; // 2048
  mempool.base_addr = mem; // buffer that holds mempool
  mempool.free_stack_top = num_entries;
  mempool.free_stack = new Array(num_entries);
  mempool.pkt_buffers = new Array(num_entries);

  for (let i = 0; i < num_entries; i++) {
    // this is the creation of all the bufs
    // physical addresses are not contiguous within a pool, we need to get the mapping
    // minor optimization opportunity: this only needs to be done once per page
    mempool.free_stack[i] = i;
    const buf = createPktBuffer(mempool, i, entry_size);
    buf.mempool_idx = i;
    buf.size = 0;
    setPktBufData(buf, new Array(entry_size).fill(0));
    buf.buf_addr_phy = addon.dataviewToPhys(buf.mem);
    mempool.pkt_buffers[i] = buf;
  }
  return mempool;
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

function start_rx_queue(ixgbe_device, queue_id) {
  console.info(`starting rx queue ${queue_id}`);
  const queue = ixgbe_device.rx_queues[queue_id];
  // 2048 as pktbuf size is strictly speaking incorrect:
  // we need a few headers (1 cacheline), so there's only 1984 bytes left for the device
  // but the 82599 can only handle sizes in increments of 1 kb;
  // but this is fine since our max packet size
  // is the default MTU of 1518
  // this has to be fixed if jumbo frames are to be supported
  // mempool should be >= the number of rx and tx descriptors for a forwarding application
  const mempool_size = defines.NUM_RX_QUEUE_ENTRIES + defines.NUM_TX_QUEUE_ENTRIES;
  queue.mempool = memory_allocate_mempool_js(mempool_size < 4096 ? 4096 : mempool_size, 2048);
  if (queue.num_entries % 2 !== 0) {
    throw new Error('number of queue entries must be a power of 2');
  }
  for (let i = 0; i < queue.num_entries; i++) {
    // const rxd = getRxDescriptorFromVirt(queue.descriptors, i);
    const rxd = new RxDescriptor(queue.descriptors, i);
    const buf = pkt_buf_alloc_js(queue.mempool);
    if (!buf) {
      throw new Error('failed to allocate rx descriptor');
    }
    // set pkt addr
    rxd.memView.d64[0 + rxd.offset / 8] = buf.buf_addr_phy;
    // set hdr addr
    rxd.memView.d64[1 + rxd.offset / 8] = BigInt(0)/* 0n */; // TODO rewrite to 1n syntax before running, but keep at BigInt(1) syntax because otherwise eslint will not work

    // we need to return the virtual address in the rx function
    // which the descriptor doesn't know by default
    queue.virtual_addresses[i] = buf;
  }
  // enable queue and wait if necessary
  set_flags_js(ixgbe_device, defines.IXGBE_RXDCTL(queue_id), defines.IXGBE_RXDCTL_ENABLE);
  wait_set_reg_js(ixgbe_device, defines.IXGBE_RXDCTL(queue_id), defines.IXGBE_RXDCTL_ENABLE);
  // rx queue starts out full
  addon.set_reg_js(ixgbe_device.addr, defines.IXGBE_RDH(queue_id), 0);
  // was set to 0 before in the init function
  addon.set_reg_js(ixgbe_device.addr, defines.IXGBE_RDT(queue_id), queue.num_entries - 1);
}

function start_tx_queue(dev, queue_id) {
  console.info(`starting tx queue ${queue_id}`);
  const queue = dev.tx_queues[queue_id];
  if (queue.num_entries & (queue.num_entries - 1)) {
    throw new Error('number of queue entries must be a power of 2');
  }
  // tx queue starts out empty
  addon.set_reg_js(dev.addr, defines.IXGBE_TDH(queue_id), 0);
  addon.set_reg_js(dev.addr, defines.IXGBE_TDT(queue_id), 0);
  // enable queue and wait if necessary
  set_flags_js(dev, defines.IXGBE_TXDCTL(queue_id), defines.IXGBE_TXDCTL_ENABLE);
  wait_set_reg_js(dev, defines.IXGBE_TXDCTL(queue_id), defines.IXGBE_TXDCTL_ENABLE);
}

function wrap_ring(index, ring_size) {
  return (index + 1) & (ring_size - 1);
}

// section 1.8.2 and 7.1
// try to receive a single packet if one is available, non-blocking
// see datasheet section 7.1.9 for an explanation of the rx ring structure
// tl;dr: we control the tail of the queue, the hardware the head
function ixgbe_rx_batch(dev, queue_id, bufs, num_bufs) { // returns number
  const queue = dev.rx_queues[queue_id];
  // rx index we checked in the last run of this function
  let { rx_index } = queue;
  // index of the descriptor we checked in the last iteration of the loop
  let last_rx_index = rx_index;
  let buf_index;
  for (buf_index = 0; buf_index < num_bufs; buf_index++) {
    // rx descriptors are explained in 7.1.5
    // const desc_ptr = getRxDescriptorFromVirt(queue.descriptors, rx_index);
    const desc_ptr = new RxDescriptor(queue.descriptors, rx_index);
    const status = desc_ptr.upper().status_error();
    if (status & defines.IXGBE_RXDADV_STAT_DD) {
      if (!(status & defines.IXGBE_RXDADV_STAT_EOP)) {
        throw new Error('multi-segment packets are not supported - increase buffer size or decrease MTU');
      }
      // got a packet, read and copy the whole descriptor
      const buf = queue.virtual_addresses[rx_index];
      buf.size = desc_ptr.upper().length();
      // this would be the place to implement RX offloading by translating the device-specific flags
      // to an independent representation in the buf (similiar to how DPDK works)
      // need a new mbuf for the descriptor
      const new_buf = pkt_buf_alloc_js(queue.mempool); // this should work, but is a critical point
      if (!new_buf) {
        // we could handle empty mempools more gracefully here, but it would be quite messy...
        // make your mempools large enough
        throw new Error('failed to allocate new mbuf for rx, you are either leaking memory or your mempool is too small');
      }
      // reset the descriptor
      desc_ptr.memView.d64[0 + desc_ptr.offset / 8] = new_buf.buf_addr_phy;
      // this resets the flags
      desc_ptr.memView.d64[1 + desc_ptr.offset / 8] = BigInt(0)/* 0n */; // TODO rewrite to 1n syntax before running, but keep at BigInt(1) syntax because otherwise eslint will not work
      queue.virtual_addresses[rx_index] = new_buf;
      bufs[buf_index] = buf;
      // want to read the next one in the next iteration,
      // but we still need the last / current to update RDT later
      last_rx_index = rx_index;
      rx_index = wrap_ring(rx_index, queue.num_entries);
    } else {
      break;
    }
  }
  if (rx_index !== last_rx_index) {
    // tell hardware that we are done
    // this is intentionally off by one, otherwise we'd set RDT=RDH
    // if we are receiving faster than packets are coming in
    // RDT=RDH means queue is full
    addon.set_reg_js(dev.addr, defines.IXGBE_RDT(queue_id), last_rx_index);
    queue.rx_index = rx_index;
  }
  dev.pkts_rec += buf_index;
  return buf_index; // number of packets stored in bufs; buf_index points to the next index
}


// see section 4.6.8
function init_tx(dev) {
  // crc offload and small packet padding
  set_flags_js(dev, defines.IXGBE_HLREG0, defines.IXGBE_HLREG0_TXCRCEN
    | defines.IXGBE_HLREG0_TXPADEN);

  // set default buffer size allocations
  // see also: section 4.6.11.3.4, no fancy features like DCB and VTd
  addon.set_reg_js(dev.addr, defines.IXGBE_TXPBSIZE(0), defines.IXGBE_TXPBSIZE_40KB);
  for (let i = 1; i < 8; i++) {
    addon.set_reg_js(dev.addr, defines.IXGBE_TXPBSIZE(i), 0);
  }
  // required when not using DCB/VTd
  addon.set_reg_js(dev.addr, defines.IXGBE_DTXMXSZRQ, 0xFFFF);
  clear_flags_js(dev, defines.IXGBE_RTTDCS, defines.IXGBE_RTTDCS_ARBDIS);

  // per-queue config for all queues
  for (let i = 0; i < dev.ixy.num_tx_queues; i++) {
    console.info(`initializing tx queue ${i}`);

    // setup descriptor ring, see section 7.1.9
    const ring_size_bytes = defines.NUM_TX_QUEUE_ENTRIES * 16; // 128bit headers? -> 128/8 bytes
    const mem = {};
    mem.virt = addon.getDmaMem(ring_size_bytes, true);
    mem.phy = addon.virtToPhys(mem.virt);
    // neat trick from Snabb: initialize to 0xFF to prevent
    // rogue memory accesses on premature DMA activation
    const virtMemView = new Uint32Array(mem.virt);
    for (let count = 0; count < ring_size_bytes; count++) {
      virtMemView[count / 4] = 0xFFFFFFFF;
    }
    const PhysBeginning = Number(mem.phy) & 0xFFFFFFFF;
    const PhysEnding = Number(mem.phy >> BigInt(32)/* 32n */); // TODO rewrite to 1n syntax before running, but keep at BigInt(1) syntax because otherwise eslint will not work
    addon.set_reg_js(dev.addr, defines.IXGBE_TDBAL(i), PhysBeginning);
    addon.set_reg_js(dev.addr, defines.IXGBE_TDBAH(i), PhysEnding);

    addon.set_reg_js(dev.addr, defines.IXGBE_TDLEN(i), ring_size_bytes);

    // descriptor writeback magic values, important to get good performance and low PCIe overhead
    // see 7.2.3.4.1 and 7.2.3.5 for an explanation of these values and how to find good ones
    // we just use the defaults from DPDK here,
    // but this is a potentially interesting point for optimizations
    let txdctl = get_reg_js(dev, defines.IXGBE_TXDCTL(i));
    // there are no defines for this in ixgbe_type.h for some reason
    // pthresh: 6:0, hthresh: 14:8, wthresh: 22:16
    txdctl &= ~(0x3F | (0x3F << 8) | (0x3F << 16)); // clear bits
    txdctl |= 36 | (8 << 8) | (4 << 16); // from DPDK
    addon.set_reg_js(dev.addr, defines.IXGBE_TXDCTL(i), txdctl);

    // private data for the driver, 0-initialized
    const queue = {
      num_entries: defines.NUM_TX_QUEUE_ENTRIES,
      // position to clean up descriptors that where sent out by the nic
      clean_index: 0,
      // position to insert packets for transmission
      tx_index: 0,
      // virtual addresses to map descriptors back to their mbuf for freeing
      virtual_addresses: new Array(defines.NUM_TX_QUEUE_ENTRIES),
      descriptors: {
        d16: new Uint16Array(mem.virt),
        d32: new Uint32Array(mem.virt),
        d64: new BigUint64Array(mem.virt),
      },
    };
    dev.tx_queues[i] = queue;
  }
  // final step: enable DMA
  addon.set_reg_js(dev.addr, defines.IXGBE_DMATXCTL, defines.IXGBE_DMATXCTL_TE);
}

const TX_CLEAN_BATCH = 32;


/*
void pkt_buf_free(struct pkt_buf* buf) {
  struct mempool* mempool = buf->mempool;
  mempool->free_stack[mempool->free_stack_top++] = buf->mempool_idx;
}
*/

function pkt_buf_free(buf) {
  const { mempool } = buf;
  mempool.free_stack[mempool.free_stack_top++] = buf.mempool_idx;
}


// section 1.8.1 and 7.2
// we control the tail, hardware the head
// huge performance gains possible here by sending packets in batches
// - writing to TDT for every packet is not efficient
// returns the number of packets transmitted, will not block when the queue is full
function ixgbe_tx_batch(dev, queue_id, bufs, num_bufs) {
  const queue = dev.tx_queues[queue_id];
  // the descriptor is explained in section 7.2.3.2.4
  // we just use a struct copy & pasted from intel, but it basically has two formats:
  // 1. the write-back format which is written by the NIC once sending it is finished
  // ^this is used in step 1
  // 2. the read format which is read by the NIC and written by us, this is used in step 2

  let { clean_index } = queue; // next descriptor to clean up
  let cur_index = queue.tx_index; // next descriptor to use for tx

  // step 1: clean up descriptors that were sent out by the hardware and return them to the mempool
  // start by reading step 2 which is done first for each packet
  // cleaning up must be done in batches for performance reasons,
  // so this is unfortunately somewhat complicated
  while (true) {
    // figure out how many descriptors can be cleaned up
    // cur is always ahead of clean (invariant of our queue)
    let cleanable = cur_index - clean_index;
    if (cleanable < 0) { // handle wrap-around
      cleanable = queue.num_entries + cleanable;
    }
    if (cleanable < TX_CLEAN_BATCH) {
      break;
    }
    // calculcate the index of the last transcriptor in the clean batch
    // we can't check all descriptors for performance reasons
    let cleanup_to = clean_index + TX_CLEAN_BATCH - 1;
    if (cleanup_to >= queue.num_entries) {
      cleanup_to -= queue.num_entries;
    }
    const txd = new TxDescriptor(queue.descriptors, cleanup_to);

    const status = txd.wb().status();
    // hardware sets this flag as soon as it's sent out,
    // we can give back all bufs in the batch back to the mempool
    if (status & defines.IXGBE_ADVTXD_STAT_DD) {
      let i = clean_index;
      while (true) {
        const buf = queue.virtual_addresses[i];
        pkt_buf_free(buf);
        if (i === cleanup_to) {
          break;
        }
        i = wrap_ring(i, queue.num_entries);
      }
      // next descriptor to be cleaned up is one after the one we just cleaned
      clean_index = wrap_ring(cleanup_to, queue.num_entries);
    } else {
      // clean the whole batch or nothing; yes, this leaves some packets in
      // the queue forever if you stop transmitting, but that's not a real concern
      break;
    }
  }
  queue.clean_index = clean_index;
  // step 2: send out as many of our packets as possible
  let sent;
  for (sent = 0; sent < num_bufs; sent++) {
    const next_index = wrap_ring(cur_index, queue.num_entries);
    // we are full if the next index is the one we are trying to reclaim
    if (clean_index === next_index) {
      break;
    }
    const buf = bufs[sent];
    // remember virtual address to clean it up later
    queue.virtual_addresses[cur_index] = buf;
    queue.tx_index = wrap_ring(queue.tx_index, queue.num_entries);
    const txd = new TxDescriptor(queue.descriptors, cur_index);

    // NIC reads from here
    txd.memView.d64[0 + txd.offset / 8] = buf.buf_addr_phy;

    // always the same flags: one buffer (EOP), advanced data descriptor, CRC offload, data length
    txd.memView.d32[2 + txd.offset / 4] = (defines.IXGBE_ADVTXD_DCMD_EOP | defines.IXGBE_ADVTXD_DCMD_RS
      | defines.IXGBE_ADVTXD_DCMD_IFCS | defines.IXGBE_ADVTXD_DCMD_DEXT
      | defines.IXGBE_ADVTXD_DTYP_DATA | buf.size);

    // no fancy offloading stuff - only the total payload length
    // implement offloading flags here:
    // * ip checksum offloading is trivial: just set the offset
    // * tcp/udp checksum offloading is more annoying,
    // you have to precalculate the pseudo - header checksum
    txd.memView.d32[3 + txd.offset / 4] = buf.size << defines.IXGBE_ADVTXD_PAYLEN_SHIFT;
    cur_index = next_index;
  }
  // send out by advancing tail, i.e., pass control of the bufs to the nic
  // this seems like a textbook case for a release memory order,
  // but Intel's driver doesn't even use a compiler barrier here
  addon.set_reg_js(dev.addr, defines.IXGBE_TDT(queue_id), queue.tx_index);
  dev.pkts_sent += sent;
  return sent;
}

function ixgbe_get_link_speed(dev) {
  const links = get_reg_js(dev, defines.IXGBE_LINKS);
  if (!(links & defines.IXGBE_LINKS_UP)) {
    return 0;
  }
  switch (links & defines.IXGBE_LINKS_SPEED_82599) {
  case defines.IXGBE_LINKS_SPEED_100_82599:
    return 100;
  case defines.IXGBE_LINKS_SPEED_1G_82599:
    return 1000;
  case defines.IXGBE_LINKS_SPEED_10G_82599:
    return 10000;
  default:
    return 0;
  }
}

// read stat counters and accumulate in stats
// stats may be NULL to just reset the counters
function ixgbe_read_stats(dev, stats) {
  // const dev = IXY_TO_IXGBE(ixy); // do we want to do this?
  const rx_pkts = get_reg_js(dev, defines.IXGBE_GPRC);
  const tx_pkts = get_reg_js(dev, defines.IXGBE_GPTC);
  const rx_bytes = get_reg_js(dev, defines.IXGBE_GORCL);
  // const rx_bytes_first32bits = get_reg_js(dev.addr, defines.IXGBE_GORCH);
  const tx_bytes = get_reg_js(dev, defines.IXGBE_GOTCL);
  // const tx_bytes_first32bits = get_reg_js(dev.addr, defines.IXGBE_GOTCH);
  let rx_dropped_pkts = 0;
  for (let i = 0; i < 2/* 8 */; i++) { // we can only have 64bit numbers anyways
    rx_dropped_pkts += get_reg_js(dev,
      defines.RXMPC(i));//* (4294967296/* 2^32 aka. 32 bit number */ ** i); // ** is exponential
  }
  // console.info(`${dev.ixy.pci_addr} stats:\nrx_pkts: ${rx_pkts} | tx_pkts: ${tx_pkts}
  // | rx_bytes: ${ rx_bytes } | rx_bytes_first32bits: ${ rx_bytes_first32bits }
  // | tx_bytes: ${ tx_bytes } | tx_bytes_first32bits: ${ tx_bytes_first32bits }`);
  // console.info(`link speed: ${ixgbe_device.ixy.get_link_speed(ixgbe_device)}`);
  // printRXErrors(dev);
  if (stats) {
    stats.rx_pkts += rx_pkts;
    stats.tx_pkts += tx_pkts;
    stats.rx_bytes += rx_bytes;
    stats.tx_bytes += tx_bytes;
    stats.rx_dropped_pkts += rx_dropped_pkts;
    stats.pkts_sent += dev.pkts_sent;
    stats.pkts_rec += dev.pkts_rec;
    dev.pkts_rec = 0;
    dev.pkts_sent = 0;
  }
}

// initializes a stat struct and clears the stats on the device
function stats_init(stats, dev) {
  // might require device-specific initialization
  stats.rx_pkts = 0;
  stats.tx_pkts = 0;
  stats.rx_bytes = 0;
  stats.tx_bytes = 0;
  stats.rx_dropped_pkts = 0;
  stats.pkts_rec = 0;
  stats.pkts_sent = 0;
  stats.device = dev;
  if (dev) {
    // reset stats
    dev.ixy.read_stats(dev);
  }
}
function copyStats(to, from) {
  to.rx_pkts = from.rx_pkts;
  to.tx_pkts = from.tx_pkts;
  to.rx_bytes = from.rx_bytes;
  to.tx_bytes = from.tx_bytes;
  to.rx_dropped_pkts = from.rx_dropped_pkts;
  to.device = from.device;
  to.pkts_sent = from.pkts_sent;
  to.pkts_rec = from.pkts_rec;
}

// see section 4.6.4
function init_link(dev) {
  // should already be set by the eeprom config,
  // maybe we shouldn't override it here to support weirdo nics?
  addon.set_reg_js(dev.addr, defines.IXGBE_AUTOC,
    (get_reg_js(dev, defines.IXGBE_AUTOC) & ~defines.IXGBE_AUTOC_LMS_MASK)
    | defines.IXGBE_AUTOC_LMS_10G_SERIAL);
  addon.set_reg_js(dev.addr, defines.IXGBE_AUTOC,
    (get_reg_js(dev, defines.IXGBE_AUTOC) & ~defines.IXGBE_AUTOC_10G_PMA_PMD_MASK)
    | defines.IXGBE_AUTOC_10G_XAUI);
  // negotiate link
  set_flags_js(dev, defines.IXGBE_AUTOC, defines.IXGBE_AUTOC_AN_RESTART);
  // datasheet wants us to wait for the link here, but we can continue and wait afterwards
}

// init_rx(ixgbe_device); // we want to do this in the reset and init

function ixgbe_set_promisc(dev, enabled) {
  if (enabled) {
    console.info('enabling promisc mode');
    set_flags_js(dev, defines.IXGBE_FCTRL, defines.IXGBE_FCTRL_MPE | defines.IXGBE_FCTRL_UPE);
  } else {
    console.info('disabling promisc mode');
    clear_flags_js(dev, defines.IXGBE_FCTRL, defines.IXGBE_FCTRL_MPE
      | defines.IXGBE_FCTRL_UPE);
  }
}

function wait_for_link(dev) {
  console.info('Waiting for link...');
  let max_wait = 1000; // 10 seconds in ms
  const poll_interval = 10; // 10 ms in ms
  while (!(dev.ixy.get_link_speed(dev)) && max_wait > 0) {
    wait(poll_interval);
    max_wait -= poll_interval;
  }
  console.info(`Link speed is ${dev.ixy.get_link_speed(dev)} Mbit/s`);
}


// see section 4.6.3
function reset_and_init(dev) {
  console.info(`Resetting device ${dev.ixy.pci_addr}`);
  // section 4.6.3.1 - disable all interrupts
  addon.set_reg_js(dev.addr, defines.IXGBE_EIMC, 0x7FFFFFFF);

  // section 4.6.3.2
  addon.set_reg_js(dev.addr, defines.IXGBE_CTRL, defines.IXGBE_CTRL_RST_MASK);
  wait_clear_reg_js(dev, defines.IXGBE_CTRL, defines.IXGBE_CTRL_RST_MASK);
  wait(100); // why do we do this?
  // section 4.6.3.1 - disable interrupts again after reset
  addon.set_reg_js(dev.addr, defines.IXGBE_EIMC, 0x7FFFFFFF);

  console.info(`Initializing device ${dev.ixy.pci_addr}`);

  // section 4.6.3 - Wait for EEPROM auto read completion
  wait_set_reg_js(dev, defines.IXGBE_EEC, defines.IXGBE_EEC_ARD);

  // section 4.6.3 - Wait for DMA initialization done (RDRXCTL.DMAIDONE)
  wait_set_reg_js(dev, defines.IXGBE_RDRXCTL, defines.IXGBE_RDRXCTL_DMAIDONE);

  // section 4.6.4 - initialize link (auto negotiation)
  init_link(dev);

  // section 4.6.5 - statistical counters
  // reset-on-read registers, just read them once
  // ixgbe_read_stats(&dev->ixy, NULL);
  dev.ixy.read_stats(dev);

  // section 4.6.7 - init rx
  init_rx(dev);

  // section 4.6.8 - init tx
  init_tx(dev);

  // enables queues after initializing everything
  for (let i = 0; i < dev.ixy.num_rx_queues; i++) {
    start_rx_queue(dev, i);
  }
  for (let i = 0; i < dev.ixy.num_tx_queues; i++) {
    start_tx_queue(dev, i);
  }

  // skip last step from 4.6.3 - don't want interrupts
  // finally, enable promisc mode by default, it makes testing less annoying
  ixgbe_set_promisc(dev, true);

  // wait for some time for the link to come up
  wait_for_link(dev);
}

const BATCH_SIZE = 32;

function forward(rx_dev, rx_queue, tx_dev, tx_queue) {
  const bufs = new Array(BATCH_SIZE);
  const num_rx = rx_dev.ixy.rx_batch(rx_dev, rx_queue, bufs, BATCH_SIZE);
  if (num_rx > 0) {
    // touch all packets, otherwise it's a completely unrealistic workload
    // if the packet just stays in L3
    for (let i = 0; i < num_rx; i++) {
      bufs[i].mem8[6] += 1;
    }
    const num_tx = tx_dev.ixy.tx_batch(tx_dev, tx_queue, bufs, num_rx);
    // there are two ways to handle the case that packets are not being sent out:
    // either wait on tx or drop them; in this case it's better to drop them,
    // otherwise we accumulate latency
    // TODO double check the correctnes of this slice
    for (const buf of bufs.slice(num_tx, num_rx /* - 1 /* ? */)) {
      pkt_buf_free(buf);
    }
  }
}
const MAX_QUEUES = 64;

class IXY {
  constructor(pci_addr, num_rx_queues, num_tx_queues) {
    this.pci_addr = pci_addr;
    this.driver_name = 'ixy.js';
    this.num_rx_queues = num_rx_queues;
    this.num_tx_queues = num_tx_queues;
  }

  // eslint-disable class-methods-use-this
  rx_batch(dev, queue_id, bufs, num_bufs) { return ixgbe_rx_batch(dev, queue_id, bufs, num_bufs); }

  tx_batch(dev, queue_id, bufs, num_bufs) { return ixgbe_tx_batch(dev, queue_id, bufs, num_bufs); }

  get_link_speed(dev) { return ixgbe_get_link_speed(dev); }

  read_stats(dev, stats) { return ixgbe_read_stats(dev, stats); }

  set_promisc(dev, enabled) { return ixgbe_set_promisc(dev, enabled); }
  // eslint-enable class-methods-use-this
}

class ixgbeDevice {
  constructor(pci_addr, num_rx_queues, num_tx_queues) {
    this.rx_queues = new Array(num_rx_queues);
    this.tx_queues = new Array(num_rx_queues);
    // get IXY memory
    this.addr = addon.getIXYAddr(pci_addr);
    // create a View on the IXY memory, which is RO (and seems to not work??)
    this.dataView = new DataView(this.addr);
    this.ixy = new IXY(pci_addr, num_rx_queues, num_tx_queues);
    this.pkts_sent = 0;
    this.pkts_rec = 0;
  }
}

function ixgbe_init(pci_addr, num_rx_queues, num_tx_queues) {
  /* TODO add own root check?
  if (getuid()) {
    warn("Not running as root, this will probably fail");
  }
  */
  if (num_rx_queues > MAX_QUEUES) {
    throw new Error(`cannot configure ${num_rx_queues} rx queues: limit is ${MAX_QUEUES}`);
  }
  if (num_tx_queues > MAX_QUEUES) {
    throw new Error(`cannot configure ${num_tx_queues} tx queues: limit is ${MAX_QUEUES}`);
  }

  const ixgbeDev = new ixgbeDevice(pci_addr, num_rx_queues, num_tx_queues);

  reset_and_init(ixgbeDev);
  return ixgbeDev;
}

function diff_mpps(pkts_new, pkts_old, nanos) {
  return (pkts_new - pkts_old) / 1000000.0 / (nanos / 1000000000.0);
}

function diff_mbit(bytes_new, bytes_old, pkts_new, pkts_old, nanos) {
  // take stuff on the wire into account, i.e., the preamble, SFD and IFG (20 bytes)
  // otherwise it won't show up as 10000 mbit/s with small packets which is confusing
  return (((bytes_new - bytes_old) / 1000000.0 / (nanos / 1000000000.0)) * 8
    + diff_mpps(pkts_new, pkts_old, nanos) * 20 * 8);
}
// v8 profiler stuff

/*
let profile;
profiler.startProfiling('1', true);
/* */
// endof v8 profiler stuff
function print_stats_diff(stats_new, stats_old, nanos) {
  // v8 profiler stuff
  /*
  profile = profiler.stopProfiling('1');
  console.log(JSON.stringify(profile, null, 2));
    profile.delete();
  profiler.startProfiling('1', true);

  /* */
  // endof v8 profiler stuff
  const rxMbits = diff_mbit(stats_new.rx_bytes, stats_old.rx_bytes,
    stats_new.rx_pkts, stats_old.rx_pkts, nanos);
  const rxMpps = diff_mpps(stats_new.rx_pkts, stats_old.rx_pkts, nanos);
  const recRate = (stats_new.pkts_rec - stats_old.pkts_rec)
    / (stats_new.rx_pkts - stats_old.rx_pkts);
  console.info(`[${stats_new.device ? stats_new.device.ixy.pci_addr : '???'}] RX: ${rxMbits * recRate} Mbits/s ${rxMpps * recRate} Mpps`);
  console.info(`[${stats_new.device ? stats_new.device.ixy.pci_addr : '???'}] TX: ${diff_mbit(stats_new.tx_bytes, stats_old.tx_bytes, stats_new.tx_pkts, stats_old.tx_pkts, nanos)} Mbit/s ${diff_mpps(stats_new.tx_pkts, stats_old.tx_pkts, nanos)} Mpps`);
  console.info(`[${stats_new.device ? stats_new.device.ixy.pci_addr : '???'}] RX packets : ${stats_new.pkts_rec - stats_old.pkts_rec}`);
  console.info(`[${stats_new.device ? stats_new.device.ixy.pci_addr : '???'}] TX packets : ${stats_new.pkts_sent - stats_old.pkts_sent}`);
  console.info(`[${stats_new.device ? stats_new.device.ixy.pci_addr : '???'}] according to NIC: RX: ${rxMbits} Mbit/s ${rxMpps} Mpps`);
  console.info(`[${stats_new.device ? stats_new.device.ixy.pci_addr : '???'}] according to NIC: RX_pkts: ${stats_new.rx_pkts - stats_old.rx_pkts} ; TX_pkts: ${stats_new.tx_pkts - stats_old.tx_pkts}`);
  console.info(`[${stats_new.device ? stats_new.device.ixy.pci_addr : '???'}] Packages actually getting received: ${recRate * 100}% ; droprate: ${(1 - recRate) * 100}%`);
  console.info('----- ----- ----- -----');
}
const PKT_SIZE = 60;
// /*
const pkt_data = [
  0x01, 0x02, 0x03, 0x04, 0x05, 0x06, // dst MAC
  0x11, 0x12, 0x13, 0x14, 0x15, 0x16, // src MAC
  0x08, 0x00, // ether type: IPv4
  0x45, 0x00, // Version, IHL, TOS
  (PKT_SIZE - 14) >> 8, // ip len excluding ethernet, high byte
  (PKT_SIZE - 14) & 0xFF, // ip len exlucding ethernet, low byte
  0x00, 0x00, 0x00, 0x00, // id, flags, fragmentation
  0x40, 0x11, 0x00, 0x00, // TTL (64), protocol (UDP), checksum
  0x0A, 0x00, 0x00, 0x01, // src ip (10.0.0.1)
  0x0A, 0x00, 0x00, 0x02, // dst ip (10.0.0.2)
  0x00, 0x2A, 0x05, 0x39, // src and dst ports (42 -> 1337)
  (PKT_SIZE - 20 - 14) >> 8, // udp len excluding ip & ethernet, high byte
  (PKT_SIZE - 20 - 14) & 0xFF, // udp len exlucding ip & ethernet, low byte
  0x00, 0x00, // udp checksum, optional
  'i', 'x', 'y', // payload
  // rest of the payload is zero-filled because mempools guarantee empty bufs
];

// calculate a IP/TCP/UDP checksum
function calc_ip_checksum(data, len, offset = 0) {
  if (len % 1) throw new Error('odd-sized checksums NYI'); // we don't need that
  let cs = 0;
  for (let i = offset; i < (len / 2) + offset; i += 2) {
    cs += (((data[i] & 0xFF) << 8) | (data[i + 1] & 0xFF));
    if (cs > 0xFFFF) {
      cs = (cs & 0xFFFF) + 1; // 16 bit one's complement
    }
  }
  return ~(cs); // this is 16bit
}

function init_mempool() {
  const NUM_BUFS = 2048;
  const mempool = memory_allocate_mempool_js(NUM_BUFS, 0);
  // pre-fill all our packet buffers with some templates that can be modified later
  // we have to do it like this because sending is async in the hardware;
  // we cannot re - use a buffer immediately
  const bufs = new Array(NUM_BUFS);
  for (let buf_id = 0; buf_id < NUM_BUFS; buf_id++) {
    const buf = pkt_buf_alloc_js(mempool);
    buf.size = PKT_SIZE;

    // we just do this with single bytes, as this is not relevant for performance?
    setPktBufData(buf, pkt_data);
    // TODO find a nice way to read the package data and write it
    // TODO double check the offset because above
    // * (uint16_t *)(buf -> data + 24) = calc_ip_checksum(buf -> data + 14, 20);// TODO
    // TODO double check if this is doing what it's supposed to be doing
    const data = new Array(20);
    for (let i = 0; i < 20; i++) {
      data[i] = buf.mem8[i];
    }
    buf.mem32[6/* was 24 */] = calc_ip_checksum(data, 20, 14);

    bufs[buf_id] = buf;
  }
  // return them all to the mempool, all future allocations will return bufs with the data set above
  for (let buf_id = 0; buf_id < NUM_BUFS; buf_id++) {
    pkt_buf_free(bufs[buf_id]);
  }

  return mempool;
}

function convertHRTimeToNano(time) {
  return time[0] * 1000000000 + time[1];
}

// calls ixy_tx_batch until all packets are queued with busy waiting
function ixy_tx_batch_busy_wait_js(dev, queue_id, bufs, num_bufs) {
  let num_sent = 0;
  while (num_sent !== num_bufs) {
    // busy wait
    num_sent += dev.ixy.tx_batch(dev, queue_id, bufs.slice(num_sent), num_bufs - num_sent);
  }
}

function packet_generator_program(argc, argv) {
  if (argc !== 2) {
    console.error(`Usage: ${argv[0]} <pci bus id>`);
    return;
  }

  const mempool = init_mempool();
  const dev = ixgbe_init(argv[1], 1, 1);

  let last_stats_printed = convertHRTimeToNano(process.hrtime());
  const stats_old = {};
  const stats = {};
  stats_init(stats, dev);
  stats_init(stats_old, dev);

  // array of bufs sent out in a batch
  const bufs = new Array(BATCH_SIZE);
  let seq_num = BigInt(0)/* 0n */; // TODO rewrite to 1n syntax before running, but keep at BigInt(1) syntax because otherwise eslint will not work

  // /*
  let counter = 0;
  // tx loop
  while (true) {
    // we cannot immediately recycle packets, we need to allocate new packets every time
    // the old packets might still be used by the NIC: tx is async
    pkt_buf_alloc_batch_js(mempool, bufs, BATCH_SIZE);
    for (const buf of bufs) {
      // PKT_SIZE is not guaranteed to be dividable by 8, so we cannot use a typed array here
      buf.mem64[0] = seq_num++;
    }
    // the packets could be modified here to generate multiple flows
    ixy_tx_batch_busy_wait_js(dev, 0, bufs, BATCH_SIZE);

    // don't check time for every packet, this yields +10% performance :)
    // TODO check if we can get even higher performance by using non blocking
    if ((counter++ & 0xFFF) === 0) {
      const time = convertHRTimeToNano(process.hrtime());
      if (time - last_stats_printed > 1000 * 1000 * 1000) {
        // every second
        dev.ixy.read_stats(dev, stats);
        print_stats_diff(stats, stats_old, time - last_stats_printed);
        copyStats(stats_old, stats);
        last_stats_printed = time;
      }
    }
    // track stats
  }
  /* */
  // non blocking

  // tx loop
  // TODO look at process.nextTick() for async
  // every second
  /*
  setInterval(() => {
    const time = convertHRTimeToNano(process.hrtime());
      dev.ixy.read_stats(dev, stats);
      print_stats_diff(stats, stats_old, time - last_stats_printed);
      copyStats(stats_old, stats);
      last_stats_printed = time;
  }, 1000);
  setInterval(() => {
    // we cannot immediately recycle packets, we need to allocate new packets every time
    // the old packets might still be used by the NIC: tx is async
    pkt_buf_alloc_batch_js(mempool, bufs, BATCH_SIZE);
    bufs.REWRITE TO FOR OF/IN((buf, i) => {
      buf.mem.setUint32(PKT_SIZE - 4, i, littleEndian);
    });

    // the packets could be modified here to generate multiple flows
    ixy_tx_batch_busy_wait_js(dev, 0, bufs, BATCH_SIZE);
    // TODO check if this can be done async as well!
  }, 0);
  /* */

  // non blocking part 2
  // TX 1000!
  // tx loop
  // TODO look at process.nextTick() for async
  // every second
  /*
  let old_seq_num = -1;
  setInterval(() => {
    const time = convertHRTimeToNano(process.hrtime());
    dev.ixy.read_stats(dev, stats);
    print_stats_diff(stats, stats_old, time - last_stats_printed);
    copyStats(stats_old, stats);
    last_stats_printed = time;
  }, 1000);
  function sendstuff() {
    // we cannot immediately recycle packets, we need to allocate new packets every time
    // the old packets might still be used by the NIC: tx is async
    pkt_buf_alloc_batch_js(mempool, bufs, BATCH_SIZE);
    for (const buf of bufs) {
      buf.mem.setBigUint64(PKT_SIZE - 8, seq_num++, littleEndian);
      // TODO theres errors are not thrown
      if (old_seq_num > seq_num) {
        throw new Error(`We sent packages ordered wrong: seq_num ${seq_num}; old: ${old_seq_num}`);
      } else if (old_seq_num === seq_num) {
        throw new Error(`We sent multiple packages with the smae seq_num: ${seq_num}`);
      }
      old_seq_num = seq_num;
    }
    // the packets could be modified here to generate multiple flows
    ixy_tx_batch_busy_wait_js(dev, 0, bufs, BATCH_SIZE);
    // TODO check if this can be done async as well!

    setImmediate(sendstuff);
  }

  sendstuff();
  /* */
}

/* */
function forwardProgram(argc, argv) {
  if (argc !== 3) {
    console.error(`${argv[0]} forwards packets between two ports.`);
    console.error(`Usage: ${argv[0]} <pci bus id2> <pci bus id1>`);
    return;
  }

  const dev1 = ixgbe_init(argv[1], 1, 1);
  const dev2 = ixgbe_init(argv[2], 1, 1);

  const stats1 = {};
  const stats1_old = {};
  const stats2 = {};
  const stats2_old = {};
  stats_init(stats1, dev1);
  stats_init(stats1_old, dev1);
  stats_init(stats2, dev2);
  stats_init(stats2_old, dev2);


  let last_stats_printed = process.hrtime();
  /*
// TX 18
  // every second
  setInterval(() => {
    const time = process.hrtime(last_stats_printed);
    last_stats_printed = process.hrtime();
    dev1.ixy.read_stats(dev1, stats1);
    print_stats_diff(stats1, stats1_old, convertHRTimeToNano(time));
    copyStats(stats1_old, stats1);
    if (dev1.ixy.pci_addr !== dev2.ixy.pci_addr) {
      dev2.ixy.read_stats(dev2, stats2);
      print_stats_diff(stats2, stats2_old, convertHRTimeToNano(time));
      copyStats(stats2_old, stats2);
    }
  }, 1000);

  // TODO remember this is called every 10ms,
  // so maybe an infinite loop would be better ?
  // this is non blocking though, if that does any good


  setInterval(() => {
    forward(dev1, 0, dev2, 0);
    forward(dev2, 0, dev1, 0);
  }, 0);
  /* */

  // is this faster?
  // yes, from 61.8% packet caught to 62.9 % ,
  // TX 270
  // so its probably not worth all the extra work with printing times
  // /*
  let i = 0;
  while (true) {
    forward(dev1, 0, dev2, 0);
    forward(dev2, 0, dev1, 0);
    // because it is not non blocking anymore:
    if (i++ > 50000) {
      i = 0;
      const time = process.hrtime(last_stats_printed);
      last_stats_printed = process.hrtime();
      dev1.ixy.read_stats(dev1, stats1);
      print_stats_diff(stats1, stats1_old, convertHRTimeToNano(time));
      copyStats(stats1_old, stats1);
      if (dev1.ixy.pci_addr !== dev2.ixy.pci_addr) {
        dev2.ixy.read_stats(dev2, stats2);
        print_stats_diff(stats2, stats2_old, convertHRTimeToNano(time));
        copyStats(stats2_old, stats2);
      }
    }
  }
  /* */

  /*
  // second async try
  // seems to perform just like a while loop
  setInterval(() => {
    process.nextTick(() => {
      const time = process.hrtime(last_stats_printed);
      last_stats_printed = process.hrtime();
      dev1.ixy.read_stats(dev1, stats1);
      print_stats_diff(stats1, stats1_old, convertHRTimeToNano(time));
      copyStats(stats1_old, stats1);
      if (dev1.ixy.pci_addr !== dev2.ixy.pci_addr) {
        dev2.ixy.read_stats(dev2, stats2);
        print_stats_diff(stats2, stats2_old, convertHRTimeToNano(time));
        copyStats(stats2_old, stats2);
      }
    });
  }, 1000);
  let i = 0;
  function forwardStuff() {
    forward(dev1, 0, dev2, 0);
    forward(dev2, 0, dev1, 0);
    // temporary
    i++;
    if (i++ > 20000) {
      i = 0;
      const time = process.hrtime(last_stats_printed);
      last_stats_printed = process.hrtime();
      dev1.ixy.read_stats(dev1, stats1);
      print_stats_diff(stats1, stats1_old, time[0] * 1000000000 + time[1]);
      copyStats(stats1_old, stats1);
      if (dev1.ixy.pci_addr !== dev2.ixy.pci_addr) {
        dev2.ixy.read_stats(dev2, stats2);
        print_stats_diff(stats2, stats2_old, time[0] * 1000000000 + time[1]);
        copyStats(stats2_old, stats2);
      }
    }
    process.nextTick(forwardStuff);
  }
  forwardStuff();

  /* */
  /*
  // third async try
  // TX 260, but uses real async!!!
  setInterval(() => {
    process.nextTick(() => {
      const time = process.hrtime(last_stats_printed);
      last_stats_printed = process.hrtime();
      dev1.ixy.read_stats(dev1, stats1);
      print_stats_diff(stats1, stats1_old, convertHRTimeToNano(time));
      copyStats(stats1_old, stats1);
      if (dev1.ixy.pci_addr !== dev2.ixy.pci_addr) {
        dev2.ixy.read_stats(dev2, stats2);
        print_stats_diff(stats2, stats2_old, convertHRTimeToNano(time));
        copyStats(stats2_old, stats2);
      }
    });
  }, 1000);
  function forwardStuff() {
    forward(dev1, 0, dev2, 0);
    forward(dev2, 0, dev1, 0);
    setImmediate(forwardStuff);
  }
  forwardStuff();

  /* */
}


const programToRun = 0;
switch (programToRun) {
case 0:
  forwardProgram(3, ['', pciAddr, pciAddr2]);
  break;
case 1:
  packet_generator_program(2, ['', pciAddr]);
  break;
default:
  throw new Error('running no program...');
}
