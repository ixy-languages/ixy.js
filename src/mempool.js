const addon = require('../build/Release/exported_module'); // eslint-disable-line import/no-unresolved
const packets = require('./packets');
const defines = require('./constants');

class Mempool {
  constructor(mem, num_entries, entry_size) {
    this.num_entries = num_entries;
    this.buf_size = entry_size;
    this.base_addr = mem; // buffer that holds mempool
    this.free_stack_top = num_entries;
    this.free_stack = new Array(num_entries);
    this.pkt_buffers = new Array(num_entries);
  }
}

function memory_allocate_mempool_js(num_entries, entry_size) {
  entry_size = entry_size || 2048;
  // require entries that neatly fit into the page size, this makes the memory pool much easier
  // otherwise our base_addr + index * size formula would be wrong
  // because we can't cross a page-boundary
  if (defines.HUGE_PAGE_SIZE % entry_size) {
    console.error(`entry size must be a divisor of the huge page size ${defines.HUGE_PAGE_SIZE}`);
  }
  const mem = addon.getDmaMem(num_entries * entry_size, false);
  const mempool = new Mempool(mem, num_entries, entry_size);

  for (let i = 0; i < num_entries; i++) {
    // this is the creation of all the bufs
    // physical addresses are not contiguous within a pool, we need to get the mapping
    // minor optimization opportunity: this only needs to be done once per page
    mempool.free_stack[i] = i;
    const buf = packets.create(mempool, i, entry_size);
    buf.mempool_idx = i;
    buf.size = 0;
    packets.set(buf, new Array(entry_size).fill(0));
    buf.buf_addr_phy = addon.dataviewToPhys(buf.mem);
    mempool.pkt_buffers[i] = buf;
  }
  return mempool;
}


const PKT_SIZE = 60;
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
    const buf = packets.alloc(mempool);
    buf.size = PKT_SIZE;
    packets.set(buf, pkt_data);
    const data = new Array(20);
    for (let i = 0; i < 20; i++) {
      data[i] = buf.mem8[i];
    }
    buf.mem32[6] = calc_ip_checksum(data, 20, 14);
    bufs[buf_id] = buf;
  }
  // return them all to the mempool, all future allocations will return bufs with the data set above
  for (let buf_id = 0; buf_id < NUM_BUFS; buf_id++) {
    packets.free(bufs[buf_id]);
  }
  return mempool;
}


module.exports = { init: init_mempool, alloc: memory_allocate_mempool_js };
