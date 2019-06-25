const addon = require('./build/Release/exported_module'); // eslint-disable-line import/no-unresolved
const profiler = require('v8-profiler-node8');


// check if little or big endian
const littleEndian = (function lE() {
  const buffer = new ArrayBuffer(2);
  new DataView(buffer).setInt16(0, 256, true /* littleEndian */);
  // Int16Array benutzt die Plattform Byte-Reihenfolge.
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

// we want to initialize rx queues, and change functions to the JS equivalent

function clear_flags_js(addr, reg, flags) {
  addon.set_reg_js(addr, reg, addon.get_reg_js(addr, reg) & ~flags);
}
function set_flags_js(addr, reg, flags) {
  addon.set_reg_js(addr, reg, addon.get_reg_js(addr, reg) | flags);
}

function wait_set_reg_js(addr, reg, val) {
  while ((addon.get_reg_js(addr, reg) & val) !== val) {
    addon.set_reg_js(addr, reg, val);
    wait(100); // TODO change this to non blocking interval
  }
}

function wait_clear_reg_js(addr, reg, val) {
  while ((addon.get_reg_js(addr, reg) & val) !== 0) {
    clear_flags_js(addr, reg, val);
    wait(100); // TODO change this to non blocking interval
  }
}


const defines = {
  IXGBE_RXCTRL: 0x03000,
  IXGBE_RXCTRL_RXEN: 0x00000001,
  IXGBE_RXPBSIZE_128KB: 0x00020000,
  IXGBE_RXPBSIZE: i => 0x03C00 + (i * 4),
  IXGBE_HLREG0: 0x04240,
  IXGBE_HLREG0_RXCRCSTRP: 0x00000002,
  IXGBE_RDRXCTL: 0x02F00,
  IXGBE_RDRXCTL_CRCSTRIP: 0x00000002,
  IXGBE_FCTRL: 0x05080,
  IXGBE_FCTRL_BAM: 0x00000400,
  // eslint-disable-next-line no-nested-ternary
  IXGBE_SRRCTL: i => (i <= 15 ? 0x02100 + (i * 4) : (i) < 64 ? 0x01014
    + ((i) * 0x40) : 0x0D014 + (((i) - 64) * 0x40)),
  IXGBE_SRRCTL_DESCTYPE_MASK: 0x0E000000,
  IXGBE_SRRCTL_DESCTYPE_ADV_ONEBUF: 0x02000000,
  IXGBE_SRRCTL_DROP_EN: 0x10000000,
  NUM_RX_QUEUE_ENTRIES: 512,
  NUM_TX_QUEUE_ENTRIES: 512,
  IXGBE_RDBAL: i => (i < 64 ? 0x01000 + (i * 0x40) : 0x0D000 + ((i - 64) * 0x40)),
  IXGBE_RDBAH: i => (i < 64 ? 0x01004 + (i * 0x40) : 0x0D004 + ((i - 64) * 0x40)),
  IXGBE_RDLEN: i => (i < 64 ? 0x01008 + (i * 0x40) : 0x0D008 + ((i - 64) * 0x40)),
  IXGBE_RDH: i => (i < 64 ? 0x01010 + (i * 0x40) : 0x0D010 + ((i - 64) * 0x40)),
  IXGBE_RDT: i => (i < 64 ? 0x01018 + (i * 0x40) : 0x0D018 + ((i - 64) * 0x40)),
  IXGBE_CTRL_EXT: 0x00018,
  IXGBE_CTRL_EXT_NS_DIS: 0x00010000,
  // eslint-disable-next-line no-nested-ternary
  IXGBE_DCA_RXCTRL: i => (i <= 15 ? 0x02200 + (i * 4) : (i) < 64 ? 0x0100C
      + ((i) * 0x40) : 0x0D00C + (((i) - 64) * 0x40)),
  SIZE_PKT_BUF_HEADROOM: 40,
  IXGBE_RXDCTL: i => (i < 64 ? 0x01028 + (i * 0x40) : 0x0D028 + ((i - 64) * 0x40)),
  IXGBE_RXDCTL_ENABLE: 0x02000000,
  IXGBE_RXDADV_STAT_DD: 0x01 /* Done */,
  IXGBE_RXDADV_STAT_EOP: 0x02 /* End of Packet */,
  IXGBE_GPRC: 0x04074,
  IXGBE_GPTC: 0x04080,
  IXGBE_GORCL: 0x04088,
  IXGBE_GOTCL: 0x04090,
  IXGBE_GORCH: 0x0408C,
  IXGBE_GOTCH: 0x04094,
  FCCRC: 0x05118,
  CRCERRS: 0x04000, // crc error
  ILLERRC: 0x04004, // illegal byte
  ERRBC: 0x04008, // error byte
  RXMPC: i => 0x03FA0 + (4 * i), // missed packets count (0-7)
  Link_Status_Register: 0xB2, // first 4 bits are relevant!
  IXGBE_LINKS: 0x042A4,
  IXGBE_LINKS_UP: 0x40000000,
  IXGBE_LINKS_SPEED_82599: 0x30000000,
  IXGBE_LINKS_SPEED_100_82599: 0x10000000,
  IXGBE_LINKS_SPEED_1G_82599: 0x20000000,
  IXGBE_LINKS_SPEED_10G_82599: 0x30000000,
  IXGBE_AUTOC: 0x042A0,
  IXGBE_AUTOC_LMS_MASK: 0x7 << 13,
  IXGBE_AUTOC_LMS_10G_SERIAL: 0x3 << 13,
  IXGBE_AUTOC_10G_PMA_PMD_MASK: 0x00000180,
  IXGBE_AUTOC_10G_XAUI: 0x0 << 7,
  IXGBE_AUTOC_AN_RESTART: 0x00001000,
  IXGBE_EIMC: 0x00888,
  IXGBE_EEC: 0x10010,
  IXGBE_EEC_ARD: 0x00000200,
  IXGBE_CTRL: 0x00000,
  IXGBE_CTRL_RST_MASK: 0x00000008 | 0x04000000,
  IXGBE_RDRXCTL_DMAIDONE: 0x00000008,
  IXGBE_FCTRL_MPE: 0x00000100,
  IXGBE_FCTRL_UPE: 0x00000200,
  IXGBE_ADVTXD_STAT_DD: 0x00000001,
  IXGBE_HLREG0_TXCRCEN: 0x00000001,
  IXGBE_HLREG0_TXPADEN: 0x00000400,
  IXGBE_TXPBSIZE: i => 0x0CC00 + (i * 4),
  IXGBE_TXPBSIZE_40KB: 0x0000A000,
  IXGBE_DTXMXSZRQ: 0x08100,
  IXGBE_RTTDCS: 0x04900,
  IXGBE_RTTDCS_ARBDIS: 0x00000040,
  IXGBE_TDBAL: i => 0x06000 + (i * 0x40),
  IXGBE_TDBAH: i => 0x06004 + (i * 0x40),
  IXGBE_TDLEN: i => 0x06008 + (i * 0x40),
  IXGBE_TXDCTL: i => 0x06028 + (i * 0x40),
  IXGBE_DMATXCTL: 0x04A80,
  IXGBE_DMATXCTL_TE: 0x1,
  IXGBE_TDT: i => 0x06018 + (i * 0x40),
  IXGBE_ADVTXD_PAYLEN_SHIFT: 14,
  IXGBE_ADVTXD_DCMD_EOP: 0x01000000,
  IXGBE_ADVTXD_DCMD_RS: 0x08000000,
  IXGBE_ADVTXD_DCMD_IFCS: 0x02000000,
  IXGBE_ADVTXD_DCMD_DEXT: 0x20000000,
  IXGBE_ADVTXD_DTYP_DATA: 0x00300000,
  IXGBE_TDH: i => (0x06010 + ((i) * 0x40)),
  IXGBE_TXDCTL_ENABLE: 0x02000000, // Ena specific Tx Queue


};

const getRxDescriptorFromVirt = (virtMem, index = 0) => {
  const descriptor = {};
  const dataView = new DataView(virtMem, index * 16, 16);
  /* ixgbe_adv_rx_desc:
union ixgbe_adv_rx_desc {
  struct
  {
    __le64 pkt_addr; // Packet buffer address
    __le64 hdr_addr; // Header buffer address
  } read;
  struct
  {
    struct
    {
      union {
        __le32 data;
        struct
        {
          __le16 pkt_info; // RSS, Pkt type
          __le16 hdr_info; // Splithdr, hdrlen
        } hs_rss;
      } lo_dword;
      union {
        __le32 rss; // RSS Hash
        struct
        {
          __le16 ip_id; // IP id
          __le16 csum;  // Packet Checksum
        } csum_ip;
      } hi_dword;
    } lower;
    struct
    {
      __le32 status_error; // ext status/error
      __le16 length;       // Packet length
      __le16 vlan;         // VLAN tag
    } upper;
  } wb; // writeback
};
  */
  descriptor.pkt_addr = dataView.getBigUint64(0, littleEndian);
  descriptor.hdr_addr = dataView.getBigUint64(8, littleEndian);
  descriptor.lower = {};
  descriptor.lower.lo_dword = {};
  descriptor.lower.lo_dword.data = dataView.getUint32(0, littleEndian);
  descriptor.lower.lo_dword.hs_rss = {};
  descriptor.lower.lo_dword.hs_rss.pkt_info = dataView.getUint16(0, littleEndian);
  descriptor.lower.lo_dword.hs_rss.hdr_info = dataView.getUint16(2, littleEndian);
  descriptor.lower.hi_dword = {};
  descriptor.lower.hi_dword.rss = dataView.getUint32(4, littleEndian);
  descriptor.lower.hi_dword.ip_id = dataView.getUint16(4, littleEndian);
  descriptor.lower.hi_dword.csum = dataView.getUint16(6, littleEndian);
  descriptor.upper = {};
  descriptor.upper.status_error = dataView.getUint32(8, littleEndian);
  descriptor.upper.length = dataView.getUint16(12, littleEndian);
  descriptor.upper.vlan = dataView.getUint16(14, littleEndian);
  descriptor.memView = dataView;
  return descriptor;
};

function getTxDescriptorFromVirt(virtMem, index = 0) {
  /*
  // Transmit Descriptor - Advanced
  union ixgbe_adv_tx_desc {
    struct {
      __le64 buffer_addr; // Address of descriptor's data buf
      __le32 cmd_type_len;
      __le32 olinfo_status;
    } read;
    struct {
      __le64 rsvd; // Reserved
      __le32 nxtseq_seed;
      __le32 status;
    } wb;
  };
  */
  const descriptor = {};
  const dataView = new DataView(virtMem, index * 16, 16);
  descriptor.read = {};
  descriptor.read.buffer_addr = dataView.getBigUint64(0, littleEndian);
  descriptor.read.cmd_type_len = dataView.getUint32(8, littleEndian);
  descriptor.read.olinfo_status = dataView.getUint32(12, littleEndian);
  descriptor.wb = {};
  descriptor.wb.rsvd = dataView.getBigUint64(0, littleEndian);
  descriptor.wb.nxtseq_seed = dataView.getUint32(8, littleEndian);
  descriptor.wb.status = dataView.getUint32(12, littleEndian);

  descriptor.memView = dataView;
  return descriptor;
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
  clear_flags_js(IXYDevice, defines.IXGBE_RXCTRL, defines.IXGBE_RXCTRL_RXEN);
  // no fancy dcb or vt, just a single 128kb packet buffer for us
  addon.set_reg_js(IXYDevice, defines.IXGBE_RXPBSIZE(0), defines.IXGBE_RXPBSIZE_128KB);
  for (let i = 1; i < 8; i++) {
    addon.set_reg_js(IXYDevice, defines.IXGBE_RXPBSIZE(i), 0);
  }
  // always enable CRC offloading
  set_flags_js(IXYDevice, defines.IXGBE_HLREG0, defines.IXGBE_HLREG0_RXCRCSTRP);
  set_flags_js(IXYDevice, defines.IXGBE_RDRXCTL, defines.IXGBE_RDRXCTL_CRCSTRIP);

  // accept broadcast packets
  set_flags_js(IXYDevice, defines.IXGBE_FCTRL, defines.IXGBE_FCTRL_BAM);

  // per-queue config, same for all queues
  for (let i = 0; i < num_of_queues; i++) {
    console.info(`initializing rx queue ${i}`);
    // enable advanced rx descriptors,
    // we could also get away with legacy descriptors, but they aren't really easier
    addon.set_reg_js(IXYDevice, defines.IXGBE_SRRCTL(i),
      (addon.get_reg_js(IXYDevice, defines.IXGBE_SRRCTL(i)) & ~defines.IXGBE_SRRCTL_DESCTYPE_MASK)
      | defines.IXGBE_SRRCTL_DESCTYPE_ADV_ONEBUF);
    // drop_en causes the nic to drop packets if no rx descriptors are available
    // instead of buffering them
    // a single overflowing queue can fill up the whole buffer
    // and impact operations if not setting this flag
    set_flags_js(IXYDevice, defines.IXGBE_SRRCTL(i), defines.IXGBE_SRRCTL_DROP_EN);
    // setup descriptor ring, see section 7.1.9
    const ring_size_bytes = defines.NUM_RX_QUEUE_ENTRIES * 16; // 128bit headers? -> 128/8 bytes
    const mem = {};
    mem.virt = addon.getDmaMem(ring_size_bytes, true);
    mem.phy = addon.virtToPhys(mem.virt);
    // neat trick from Snabb: initialize to 0xFF to prevent
    // rogue memory accesses on premature DMA activation
    const virtMemView = new DataView(mem.virt);
    for (let count = 0; count < ring_size_bytes; count++) {
      virtMemView.setBigUint64(count / 8, BigInt(0xFFFFFFFFFFFFFFFF), littleEndian);
    }
    const PhysBeginning = Number(mem.phy) & 0xFFFFFFFF;
    const PhysEnding = Number(mem.phy >> BigInt(32));
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
      descriptors: mem.virt,
      virtual_addresses: new Array(defines.NUM_RX_QUEUE_ENTRIES),
    };
    ixgbe_device.rx_queues[i] = queue;
  }

  // last step is to set some magic bits mentioned in the last sentence in 4.6.7
  set_flags_js(IXYDevice, defines.IXGBE_CTRL_EXT, defines.IXGBE_CTRL_EXT_NS_DIS);
  // this flag probably refers to a broken feature: it's reserved
  // and initialized as '1' but it must be set to '0'
  // there isn't even a constant in 'defines' for this flag
  for (let i = 0; i < num_of_queues; i++) {
    clear_flags_js(IXYDevice, defines.IXGBE_DCA_RXCTRL(i), 1 << 12);
  }

  // start RX
  set_flags_js(IXYDevice, defines.IXGBE_RXCTRL, defines.IXGBE_RXCTRL_RXEN);
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

function readDataViewData(dataView, length) {
  const ret = new Array(length);
  for (let i = 0; i < length; i++) {
    ret[i] = dataView.getUint8(i); // TODO optimize by reading larger?
  }
  return ret;
}


// TODO change how pkt_bufs extra info are saved, fully in JS!
function getPktBuffer(mempool, index, withBufferInfo = true) {
  const ret = mempool.pkt_buffers[index];
  if (withBufferInfo) {
    ret.data = readDataViewData(ret.mem, ret.size);
  }
  return ret;
}

function createPktBuffer(mempool, index, entry_size) {
  return { mem: new DataView(mempool.base_addr, index * entry_size, entry_size), mempool };
}


function setPktBufData(buffer, data) {
  // data is an 8bit array
  for (let i = 0; i < data.length; i++) {
    buffer.mem.setUint8(i, data[i]);
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
// another function to port
function pkt_buf_alloc_batch_js(mempool, bufs, num_bufs) {
  if (mempool.free_stack_top < num_bufs) {
    console.warn(`memory pool ${mempool} only has ${mempool.free_stack_top} free bufs, requested ${num_bufs}`);
    num_bufs = mempool.free_stack_top;
  }
  for (let i = 0; i < num_bufs; i++) {
    const entry_id = mempool.free_stack[--mempool.free_stack_top];
    // with buf_size of ${ mempool.buf_size }`);
    const buf = getPktBuffer(mempool, entry_id, false);
    /*
    buf.mem = new DataView(mempool.base_addr, entry_id * mempool.buf_size, mempool.buf_size);
    buf.buf_addr_phy = addon.dataviewToPhys(buf.mem);
    */
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
    const rxd = getRxDescriptorFromVirt(queue.descriptors, i);
    const buf = pkt_buf_alloc_js(queue.mempool);
    if (!buf) {
      throw new Error('failed to allocate rx descriptor');
    }
    // missing the offset value of this, would it be 64 bytes?
    // set pkt addr
    rxd.memView.setBigUint64(0, buf.buf_addr_phy, littleEndian);
    // set hdr addr
    rxd.memView.setBigUint64(8, BigInt(0), littleEndian);

    // we need to return the virtual address in the rx function
    // which the descriptor doesn't know by default
    queue.virtual_addresses[i] = buf;
  }
  // enable queue and wait if necessary
  set_flags_js(ixgbe_device.addr, defines.IXGBE_RXDCTL(queue_id), defines.IXGBE_RXDCTL_ENABLE);
  wait_set_reg_js(ixgbe_device.addr, defines.IXGBE_RXDCTL(queue_id), defines.IXGBE_RXDCTL_ENABLE);
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
  set_flags_js(dev.addr, defines.IXGBE_TXDCTL(queue_id), defines.IXGBE_TXDCTL_ENABLE);
  wait_set_reg_js(dev.addr, defines.IXGBE_TXDCTL(queue_id), defines.IXGBE_TXDCTL_ENABLE);
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
    const desc_ptr = getRxDescriptorFromVirt(queue.descriptors, rx_index);
    const status = desc_ptr.upper.status_error;
    if (status & defines.IXGBE_RXDADV_STAT_DD) {
      if (!(status & defines.IXGBE_RXDADV_STAT_EOP)) {
        throw new Error('multi-segment packets are not supported - increase buffer size or decrease MTU');
      }
      // got a packet, read and copy the whole descriptor
      const buf = queue.virtual_addresses[rx_index];
      buf.size = desc_ptr.upper.length;
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
      desc_ptr.memView.setBigUint64(0, new_buf.buf_addr_phy, littleEndian);
      // this resets the flags
      desc_ptr.memView.setBigUint64(8, BigInt(0), littleEndian);

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
  set_flags_js(dev.addr, defines.IXGBE_HLREG0, defines.IXGBE_HLREG0_TXCRCEN
    | defines.IXGBE_HLREG0_TXPADEN);

  // set default buffer size allocations
  // see also: section 4.6.11.3.4, no fancy features like DCB and VTd
  addon.set_reg_js(dev.addr, defines.IXGBE_TXPBSIZE(0), defines.IXGBE_TXPBSIZE_40KB);
  for (let i = 1; i < 8; i++) {
    addon.set_reg_js(dev.addr, defines.IXGBE_TXPBSIZE(i), 0);
  }
  // required when not using DCB/VTd
  addon.set_reg_js(dev.addr, defines.IXGBE_DTXMXSZRQ, 0xFFFF);
  clear_flags_js(dev.addr, defines.IXGBE_RTTDCS, defines.IXGBE_RTTDCS_ARBDIS);

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
    const virtMemView = new DataView(mem.virt);
    for (let count = 0; count < ring_size_bytes; count++) {
      virtMemView.setBigUint64(count / 8, BigInt(0xFFFFFFFFFFFFFFFF), littleEndian);
    }
    const PhysBeginning = Number(mem.phy) & 0xFFFFFFFF;
    const PhysEnding = Number(mem.phy >> BigInt(32));
    addon.set_reg_js(dev.addr, defines.IXGBE_TDBAL(i), PhysBeginning);
    addon.set_reg_js(dev.addr, defines.IXGBE_TDBAH(i), PhysEnding);

    addon.set_reg_js(dev.addr, defines.IXGBE_TDLEN(i), ring_size_bytes);

    // descriptor writeback magic values, important to get good performance and low PCIe overhead
    // see 7.2.3.4.1 and 7.2.3.5 for an explanation of these values and how to find good ones
    // we just use the defaults from DPDK here,
    // but this is a potentially interesting point for optimizations
    let txdctl = addon.get_reg_js(dev.addr, defines.IXGBE_TXDCTL(i));
    // there are no defines for this in ixgbe_type.h for some reason
    // pthresh: 6:0, hthresh: 14:8, wthresh: 22:16
    txdctl &= ~(0x3F | (0x3F << 8) | (0x3F << 16)); // clear bits
    txdctl |= 36 | (8 << 8) | (4 << 16); // from DPDK
    addon.set_reg_js(dev.addr, defines.IXGBE_TXDCTL(i), txdctl);

    // private data for the driver, 0-initialized
    const queue = {
      num_entries: defines.NUM_TX_QUEUE_ENTRIES,
      descriptors: mem.virt,
      // position to clean up descriptors that where sent out by the nic
      clean_index: 0,
      // position to insert packets for transmission
      tx_index: 0,
      // virtual addresses to map descriptors back to their mbuf for freeing
      virtual_addresses: new Array(defines.NUM_TX_QUEUE_ENTRIES),
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
    const txd = getTxDescriptorFromVirt(queue.descriptors, cleanup_to);

    const { status } = txd.wb;
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
    const txd = getTxDescriptorFromVirt(queue.descriptors, cur_index);

    // NIC reads from here
    txd.memView.setBigUint64(0, buf.buf_addr_phy, littleEndian);

    // always the same flags: one buffer (EOP), advanced data descriptor, CRC offload, data length
    txd.memView.setUint32(8, (defines.IXGBE_ADVTXD_DCMD_EOP | defines.IXGBE_ADVTXD_DCMD_RS
      | defines.IXGBE_ADVTXD_DCMD_IFCS | defines.IXGBE_ADVTXD_DCMD_DEXT
      | defines.IXGBE_ADVTXD_DTYP_DATA | buf.size), littleEndian);

    // no fancy offloading stuff - only the total payload length
    // implement offloading flags here:
    // * ip checksum offloading is trivial: just set the offset
    // * tcp/udp checksum offloading is more annoying,
    // you have to precalculate the pseudo - header checksum
    txd.memView.setUint32(12, buf.size << defines.IXGBE_ADVTXD_PAYLEN_SHIFT, littleEndian);
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
  const links = addon.get_reg_js(dev.addr, defines.IXGBE_LINKS);
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

function printRXErrors(dev) {
  console.info(`Error counter: ${addon.get_reg_js(dev.addr, defines.FCCRC)}`);
  console.info(`CRC Error counter: ${addon.get_reg_js(dev.addr, defines.CRCERRS)}`);
  console.info(`Illegal byte Error counter: ${addon.get_reg_js(dev.addr, defines.ILLERRC)}`);
  console.info(`Error Byte counter: ${addon.get_reg_js(dev.addr, defines.ERRBC)}`);
  for (let i = 0; i < 8; i++) {
    console.info(`Missed Packets Error counter(${i}): ${addon.get_reg_js(dev.addr, defines.RXMPC(i))}`);
  }
}

// read stat counters and accumulate in stats
// stats may be NULL to just reset the counters
function ixgbe_read_stats(dev, stats) {
  // const dev = IXY_TO_IXGBE(ixy); // do we want to do this?
  const rx_pkts = addon.get_reg_js(dev.addr, defines.IXGBE_GPRC);
  const tx_pkts = addon.get_reg_js(dev.addr, defines.IXGBE_GPTC);
  const rx_bytes = addon.get_reg_js(dev.addr, defines.IXGBE_GORCL);
  // const rx_bytes_first32bits = addon.get_reg_js(dev.addr, defines.IXGBE_GORCH);
  const tx_bytes = addon.get_reg_js(dev.addr, defines.IXGBE_GOTCL);
  // const tx_bytes_first32bits = addon.get_reg_js(dev.addr, defines.IXGBE_GOTCH);
  let rx_dropped_pkts = 0;
  for (let i = 0; i < 2/* 8 */; i++) { // we can only have 64bit numbers anyways
    rx_dropped_pkts += addon.get_reg_js(dev.addr,
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
    stats.pkts_sent = dev.pkts_sent,
    stats.pkts_rec = dev.pkts_rec;
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
    (addon.get_reg_js(dev.addr, defines.IXGBE_AUTOC) & ~defines.IXGBE_AUTOC_LMS_MASK)
    | defines.IXGBE_AUTOC_LMS_10G_SERIAL);
  addon.set_reg_js(dev.addr, defines.IXGBE_AUTOC,
    (addon.get_reg_js(dev.addr, defines.IXGBE_AUTOC) & ~defines.IXGBE_AUTOC_10G_PMA_PMD_MASK)
    | defines.IXGBE_AUTOC_10G_XAUI);
  // negotiate link
  set_flags_js(dev.addr, defines.IXGBE_AUTOC, defines.IXGBE_AUTOC_AN_RESTART);
  // datasheet wants us to wait for the link here, but we can continue and wait afterwards
}

// init_rx(ixgbe_device); // we want to do this in the reset and init

function ixgbe_set_promisc(dev, enabled) {
  if (enabled) {
    console.info('enabling promisc mode');
    set_flags_js(dev.addr, defines.IXGBE_FCTRL, defines.IXGBE_FCTRL_MPE | defines.IXGBE_FCTRL_UPE);
  } else {
    console.info('disabling promisc mode');
    clear_flags_js(dev.addr, defines.IXGBE_FCTRL, defines.IXGBE_FCTRL_MPE
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
  wait_clear_reg_js(dev.addr, defines.IXGBE_CTRL, defines.IXGBE_CTRL_RST_MASK);
  wait(100); // why do we do this?
  // section 4.6.3.1 - disable interrupts again after reset
  addon.set_reg_js(dev.addr, defines.IXGBE_EIMC, 0x7FFFFFFF);

  console.info(`Initializing device ${dev.ixy.pci_addr}`);

  // section 4.6.3 - Wait for EEPROM auto read completion
  wait_set_reg_js(dev.addr, defines.IXGBE_EEC, defines.IXGBE_EEC_ARD);

  // section 4.6.3 - Wait for DMA initialization done (RDRXCTL.DMAIDONE)
  wait_set_reg_js(dev.addr, defines.IXGBE_RDRXCTL, defines.IXGBE_RDRXCTL_DMAIDONE);

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
      const val = bufs[i].mem.getUint8(6) + 1;
      bufs[i].mem.setUint8(6, val);
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

  const ixgbe_dev = {
    ixy: {
      pci_addr,
      driver_name: 'ixy.js',
      num_rx_queues,
      num_tx_queues,
      rx_batch: ixgbe_rx_batch,
      tx_batch: ixgbe_tx_batch,
      get_link_speed: ixgbe_get_link_speed,
      read_stats: ixgbe_read_stats,
      set_promisc: ixgbe_set_promisc,
    },
    addr: null,
    dataView: null,
    phAddr: null,
    rx_queues: [],
    tx_queues: [],
    pkts_sent: 0,
    pkts_rec: 0,
  };

  ixgbe_dev.rx_queues = new Array(ixgbe_dev.ixy.num_rx_queues);
  ixgbe_dev.tx_queues = new Array(ixgbe_dev.ixy.num_rx_queues);

  // get IXY memory
  ixgbe_dev.addr = addon.getIXYAddr(ixgbe_dev.ixy.pci_addr);
  const IXYDev = ixgbe_dev.addr;
  // create a View on the IXY memory, which is RO
  ixgbe_dev.dataView = new DataView(IXYDev);

  reset_and_init(ixgbe_dev);
  return ixgbe_dev;
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

function print_stats_diff(stats_new, stats_old, nanos) {
// v8 profiler stuff
const snapshot = profiler.takeSnapshot();
console.log(snapshot.getHeader());
  
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
    /* pkt_data.REWRITE TO FOR OF/IN((v, i) => {
      buf.mem.setUint8(i + 64, v); // data starts at offset 64?
    }); */
    setPktBufData(buf, pkt_data);
    // TODO find a nice way to read the package data and write it
    // TODO double check the offset because above
    // * (uint16_t *)(buf -> data + 24) = calc_ip_checksum(buf -> data + 14, 20);// TODO
    // TODO double check if this is doing what it's supposed to be doing
    const data = new Array(20);
    for (let i = 0; i < 20; i++) {
      data[i] = buf.mem.getUint8(i);
    }
    buf.mem.setUint32(24, calc_ip_checksum(data, 20, 14), littleEndian);

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
  /*
    let counter = 0;
  // tx loop
  while (true) {
    // we cannot immediately recycle packets, we need to allocate new packets every time
    // the old packets might still be used by the NIC: tx is async
    pkt_buf_alloc_batch_js(mempool, bufs, BATCH_SIZE);
    bufs.REWRITE TO FOR OF/IN((buf, i) => {
      buf.mem.setUint32(PKT_SIZE - 4, i, littleEndian);
    });

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

  // /*
  // non blocking part 2
  // TX 1000!
  // tx loop
  // TODO look at process.nextTick() for async
  // every second
  let seq_num = 0;
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
      buf.mem.setBigUint64(PKT_SIZE - 8, BigInt(seq_num++), littleEndian); // TODO BIGINT?
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
  /*
  let i = 0;
  while (true) {
    forward(dev1, 0, dev2, 0);
    forward(dev2, 0, dev1, 0);
    // because it is not non blocking anymore:
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
  // /*
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

  /**/
}


const programToRun = 1;
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
