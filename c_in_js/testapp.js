const util = require('util');
// const { StringDecoder } = require('string_decoder');
const addon = require('./build/Release/exported_module'); // eslint-disable-line import/no-unresolved


// const jstruct = require('js-struct');

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
    wait(100); // TODO make real waiting, not dumb timeouts
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

  descriptor.read.buffer_addr = dataView.getBigUint64(0, littleEndian);
  descriptor.read.cmd_type_len = dataView.getUint32(8, littleEndian);
  descriptor.read.olinfo_status = dataView.getUint32(12, littleEndian);

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
    console.log(`initializing rx queue ${i}`);
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
    /* TODO get ringsize
    uint32_t ring_size_bytes = defines.NUM_RX_QUEUE_ENTRIES * sizeof(union ixgbe_adv_rx_desc);
    */
    const ring_size_bytes = defines.NUM_RX_QUEUE_ENTRIES * 16; // 128bit headers? -> 128/8 bytes
    const mem = {};
    console.log('-----------cstart------------');
    mem.virt = addon.getDmaMem(ring_size_bytes, true);
    mem.phy = addon.virtToPhys(mem.virt);
    console.log('-----------c--end------------');
    // neat trick from Snabb: initialize to 0xFF to prevent
    // rogue memory accesses on premature DMA activation
    const virtMemView = new DataView(mem.virt);
    for (let count = 0; count < ring_size_bytes; count++) {
      virtMemView.setUint32(count / 4, 0xFFFFFFFF, littleEndian);
    }
    // for now there is no obvious way to use bigint in a smart way, even within the long library
    console.log('-----------cstart------------');
    const shortenedPhys = addon.shortenPhys(mem.phy);
    const shortenedPhysLatter = addon.shortenPhysLatter(mem.phy);
    console.log('-----------c--end------------');
    // switch order, little endian has this confused?
    addon.set_reg_js(IXYDevice, defines.IXGBE_RDBAL(i), shortenedPhys);
    addon.set_reg_js(IXYDevice, defines.IXGBE_RDBAH(i), shortenedPhysLatter);
    /*
    addon.set_reg_js(IXYDevice, defines.IXGBE_RDBAL(i), shortenedPhysLatter);
    addon.set_reg_js(IXYDevice, defines.IXGBE_RDBAH(i), shortenedPhys);
    */
    addon.set_reg_js(IXYDevice, defines.IXGBE_RDLEN(i), ring_size_bytes);
    console.log(`rx ring ${i} phy addr: ${mem.phy}`);
    console.log(`rx ring ${i} virt addr: ${mem.virt}`);
    // set ring to empty at start
    addon.set_reg_js(IXYDevice, defines.IXGBE_RDH(i), 0);
    addon.set_reg_js(IXYDevice, defines.IXGBE_RDT(i), 0);
    // private data for the driver, 0-initialized
    /*
    TODO: check if we need this to be readable for hardware, because then just reading the values
    TODO: this might be enough and we dont need create_rx_queue in module.c
    struct ixgbe_rx_queue *queue = ((struct ixgbe_rx_queue *)(dev->rx_queues)) + i;
    queue->num_entries = NUM_RX_QUEUE_ENTRIES;
    queue->rx_index = 0;
    queue->descriptors = (union ixgbe_adv_rx_desc *)mem.virt;
    */
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

function getBuffer(mempool, index, entry_size) {
  // this should do the trick, returns {mem:dataView,mempool}
  return { mem: new DataView(mempool.base_addr, index * entry_size, entry_size), mempool };
}

function readBufferValues(buffer, mempool) {
  const ret = { mem: buffer };

  ret.buf_addr_phy = buffer.getBigUint64(0, littleEndian);
  // let's skip mempool 8 bytes for now?
  // buf.setUint32(8, 0);
  // buf.setUint32(12, 0);
  ret.mempool = mempool;
  ret.mempool_idx = buffer.getUint32(16, littleEndian);
  ret.size = buffer.getUint32(20, littleEndian);

  // rest of first 64 bytes is empty

  // the rest can be data, but we dont give access via a variable

  // TODO read data
  // const decoder = new StringDecoder('utf8');
  // ret.data = decoder.end(buffer);
  // ^this also includes the first bytes, we will adjust this later TODO

  return ret;
}

// i don't think we need mempool at all TODO double check this
function setBufferValues(buffer, mempool, mempool_idx, size, data, phys = false) {
  // const vmem = mempool.base_addr;
  if (phys) { // addon.dataviewToPhys(buffer.mem)
    // maybe we dont need to do this every time, so only on getBuffer ? TODO validate
    buffer.setBigUint64(0, phys, littleEndian);
  }
  // let's skip mempool 8 bytes for now?
  // buf.setUint32(8, 0);
  // buf.setUint32(12, 0);

  buffer.setUint32(16, mempool_idx, littleEndian);
  buffer.setUint32(20, size, littleEndian);

  // TODO write data
  // data is an 8bit array
  for (let i = 0; i < data.length; i++) {
    buffer.setUint8(64 + i, data[i], littleEndian);
    if (i > 2048 - 64) {
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

  for (let i = 0; i < num_entries; i++) {
    mempool.free_stack[i] = i;
    const buf = getBuffer(mempool, i, entry_size); // this should do the trick?

    // physical addresses are not contiguous within a pool, we need to get the mapping
    // minor optimization opportunity: this only needs to be done once per page
    // TODO we should move these into creation later?
    setBufferValues(buf.mem, mempool, i, 0, 0, addon.dataviewToPhys(buf.mem));
  }
  return mempool;
}
// another function to port
function pkt_buf_alloc_batch_js(mempool, num_bufs) {
  const bufs = new Array(num_bufs);
  if (mempool.free_stack_top < num_bufs) {
    console.warn(`memory pool ${mempool} only has ${mempool.free_stack_top} free bufs, requested ${num_bufs}`);
    num_bufs = mempool.free_stack_top;
  }
  for (let i = 0; i < num_bufs; i++) {
    const entry_id = mempool.free_stack[--mempool.free_stack_top];
    // console.log(`entry id: ${entry_id}, offset: ${entry_id * mempool.buf_size}
    // with buf_size of ${ mempool.buf_size }`);
    // console.log(`phys addr in JS: ${addon.virtToPhys(mempool.base_addr)}`);
    const buf = readBufferValues(getBuffer(mempool, entry_id, mempool.buf_size).mem, mempool);
    /*
    buf.mem = new DataView(mempool.base_addr, entry_id * mempool.buf_size, mempool.buf_size);
    buf.buf_addr_phy = addon.dataviewToPhys(buf.mem);
    */
    bufs[i] = buf;
  }
  return bufs;
}

function pkt_buf_alloc_js(mempool) {
  const buf = pkt_buf_alloc_batch_js(mempool, 1);
  return buf[0];
}

function start_rx_queue(ixgbe_device, queue_id) {
  console.log(`starting rx queue ${queue_id}`);
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
    rxd.memView.setBigUint64(0, addon.addBigInts(buf.buf_addr_phy, 64), littleEndian);
    // set hdr addr
    // because of bigint
    // rxd.memView.setBigUint64(8, 0, littleEndian);
    rxd.memView.setUint32(8, 0, littleEndian);
    rxd.memView.setUint32(12, 0, littleEndian);

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
  console.log(`at start_rx_queue:\nRDT register: ${addon.get_reg_js(ixgbe_device.addr, defines.IXGBE_RDT(queue_id))}\nRDH register: ${addon.get_reg_js(ixgbe_device.addr, defines.IXGBE_RDH(queue_id))}`);
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
      const desc = desc_ptr;
      const buf = queue.virtual_addresses[rx_index];
      buf.mem.size = desc.upper.length; // check how we can get size of dataView TODO
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
      // TODO add the set functions
      desc_ptr.memView.setBigUint64(0, addon.addBigInts(new_buf.buf_addr_phy, 64), littleEndian);
      // this resets the flags
      desc_ptr.memView.setUint32(8, 0, littleEndian);
      desc_ptr.memView.setUint32(12, 0, littleEndian);

      queue.virtual_addresses[rx_index] = new_buf;
      bufs[buf_index] = buf;
      // want to read the next one in the next iteration,
      // but we still need the last / current to update RDT later
      last_rx_index = rx_index;
      rx_index = wrap_ring(rx_index, queue.num_entries);
    } else {
      // console.log('status & defines.IXGBE_RXDADV_STAT_DD is FALSE');
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
  return buf_index; // number of packets stored in bufs; buf_index points to the next index
}


/*
now lets port this:
*/
// /* // remove the leftmost comment slashes to deactivate


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
    console.log(`initializing tx queue ${i}`);

    // setup descriptor ring, see section 7.1.9
    const ring_size_bytes = defines.NUM_RX_QUEUE_ENTRIES * 16; // 128bit headers? -> 128/8 bytes
    const mem = {};
    console.log('-----------cstart------------');
    mem.virt = addon.getDmaMem(ring_size_bytes, true);
    mem.phy = addon.virtToPhys(mem.virt);
    console.log('-----------c--end------------');
    // neat trick from Snabb: initialize to 0xFF to prevent
    // rogue memory accesses on premature DMA activation
    const virtMemView = new DataView(mem.virt);
    for (let count = 0; count < ring_size_bytes; count++) {
      virtMemView.setUint32(count / 4, 0xFFFFFFFF, littleEndian);
    }

    // for now there is no obvious way to use bigint in a smart way, even within the long library
    console.log('-----------cstart------------');
    const shortenedPhys = addon.shortenPhys(mem.phy);
    const shortenedPhysLatter = addon.shortenPhysLatter(mem.phy);
    console.log('-----------c--end------------');
    // switch order, little endian has this confused?
    addon.set_reg_js(dev.addr, defines.IXGBE_TDBAL(i), shortenedPhys);
    addon.set_reg_js(dev.addr, defines.IXGBE_TDBAH(i), shortenedPhysLatter);

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
      num_entries: defines.NUM_RX_QUEUE_ENTRIES,
      descriptors: mem.virt,
      // position to clean up descriptors that where sent out by the nic
      clean_index: 0,
      // position to insert packets for transmission
      tx_index: 0,
      // virtual addresses to map descriptors back to their mbuf for freeing
      virtual_addresses: new Array(defines.NUM_RX_QUEUE_ENTRIES),
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

function pkt_buf_free(buf) { // TODO check if this works
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
    const txd = getRxDescriptorFromVirt(queue.descriptors, cleanup_to);

    const { status } = txd;
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
    txd.memView.setBigUint64(0, addon.addBigInts(buf.buf_addr_phy, 64), littleEndian);

    // always the same flags: one buffer (EOP), advanced data descriptor, CRC offload, data length
    txd.memView.setUint32(8, defines.IXGBE_ADVTXD_DCMD_EOP | defines.IXGBE_ADVTXD_DCMD_RS
      | defines.IXGBE_ADVTXD_DCMD_IFCS | defines.IXGBE_ADVTXD_DCMD_DEXT
      | defines.IXGBE_ADVTXD_DTYP_DATA | buf.size, littleEndian);

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
  return sent;
}


/**/

// TODO port ixy-fwd-c as well, then we should be able to get the receive packet part running?


// -------------------------------------starting the actual code:--------------------------


/*
struct ixgbe_device {
    struct ixy_device ixy;
    uint8_t* addr;
    void* rx_queues;
    void* tx_queues;
};
struct ixy_device {
  const char* pci_addr;
  const char* driver_name;
  uint16_t num_rx_queues;
  uint16_t num_tx_queues;
  uint32_t (*rx_batch) (struct ixy_device* dev, uint16_t queue_id,
    struct pkt_buf* bufs[], uint32_t num_bufs);
  uint32_t (*tx_batch) (struct ixy_device* dev, uint16_t queue_id,
    struct pkt_buf* bufs[], uint32_t num_bufs);
  void (*read_stats) (struct ixy_device* dev, struct device_stats* stats);
  void (*set_promisc) (struct ixy_device* dev, bool enabled);
  uint32_t (*get_link_speed) (const struct ixy_device* dev);
};
*/
const ixgbe_device = {
  ixy: {
    pci_addr: pciAddr,
    driver_name: 'ixy.js',
    num_rx_queues: 1,
    num_tx_queues: 1,
    rx_batch: ixgbe_rx_batch,
    tx_batch: ixgbe_tx_batch,
    read_stats: () => { },
    set_promisc: () => { },
    get_link_speed: () => { },
  },
  addr: null,
  dataView: null,
  phAddr: null,
  rx_queues: [],
  tx_queues: [],
};

ixgbe_device.rx_queues = new Array(ixgbe_device.ixy.num_rx_queues);
ixgbe_device.tx_queues = new Array(ixgbe_device.ixy.num_rx_queues);


// get IXY memory
ixgbe_device.addr = addon.getIXYAddr(ixgbe_device.ixy.pci_addr);
const IXYDevice = ixgbe_device.addr;
// create a View on the IXY memory, which is RO
ixgbe_device.dataView = new DataView(IXYDevice);
/*
const IXYView = ixgbe_device.dataView;
console.log(`The 32bit before changing: ${IXYView.getUint32(0x200, littleEndian)}`);
console.log('-----------cstart------------');
// we need to call a C function to actually write to this memory
addon.set_reg_js(IXYDevice, 0x200, 2542);
console.log('-----------c--end------------');
console.log(`The 32bit after changing: ${IXYView.getUint32(0x200, littleEndian)}`);
console.log('trying to change value to 20 via JS..');
IXYView.setUint32(0x200, 20, littleEndian);
console.log(`The 32bit after JS changing: ${IXYView.getUint32(0x200, littleEndian)}`);


const dmaMem = addon.getDmaMem(20, true);
const dmaView = new DataView(dmaMem);
console.log(`dma at byte 0 : ${dmaView.getUint32(0, littleEndian)}`);
console.log('trying to change value to 20 via JS..');
dmaView.setUint32(0, 20, littleEndian);
console.log(`dma at byte 0 after JS change : ${dmaView.getUint32(0, littleEndian)}`);
const physicalAddress = addon.virtToPhys(dmaMem);
console.log(`Physical address: ${physicalAddress}`);
*/

function print_stats(stats) {
  console.log(`rx_pkts: ${stats.rx_pkts} | tx_pkts: ${stats.tx_pkts} | rx_bytes: ${stats.rx_bytes} | tx_bytes: ${stats.tx_bytes}`);
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

ixgbe_device.ixy.get_link_speed = ixgbe_get_link_speed;

function printRXErrors(dev) {
  console.log(`Error counter: ${addon.get_reg_js(dev.addr, defines.FCCRC)}`);
  console.log(`CRC Error counter: ${addon.get_reg_js(dev.addr, defines.CRCERRS)}`);
  console.log(`Illegal byte Error counter: ${addon.get_reg_js(dev.addr, defines.ILLERRC)}`);
  console.log(`Error Byte counter: ${addon.get_reg_js(dev.addr, defines.ERRBC)}`);
  for (let i = 0; i < 8; i++) {
    console.log(`Missed Packets Error counter(${i}): ${addon.get_reg_js(dev.addr, defines.RXMPC(i))}`);
  }
}

// read stat counters and accumulate in stats
// stats may be NULL to just reset the counters
function ixgbe_read_stats(dev, stats) {
  // const dev = IXY_TO_IXGBE(ixy); // do we want to do this?
  const rx_pkts = addon.get_reg_js(dev.addr, defines.IXGBE_GPRC);
  const tx_pkts = addon.get_reg_js(dev.addr, defines.IXGBE_GPTC);
  const rx_bytes = addon.get_reg_js(dev.addr, defines.IXGBE_GORCL);
  const rx_bytes_first32bits = addon.get_reg_js(dev.addr, defines.IXGBE_GORCH);
  const tx_bytes = addon.get_reg_js(dev.addr, defines.IXGBE_GOTCL);
  const tx_bytes_first32bits = addon.get_reg_js(dev.addr, defines.IXGBE_GOTCH);
  console.log(`reading stats... rx_pkts: ${rx_pkts} | tx_pkts: ${tx_pkts} | rx_bytes: ${rx_bytes} | rx_bytes_first32bits: ${rx_bytes_first32bits} | tx_bytes: ${tx_bytes} | tx_bytes_first32bits: ${tx_bytes_first32bits}`);
  console.log(`link speed: ${ixgbe_device.ixy.get_link_speed(ixgbe_device)}`);
  printRXErrors(dev);
  if (stats) {
    stats.rx_pkts += rx_pkts;
    stats.tx_pkts += tx_pkts;
    stats.rx_bytes += rx_bytes;
    stats.tx_bytes += tx_bytes;
    print_stats(stats);
  }
}
ixgbe_device.ixy.read_stats = ixgbe_read_stats;

// initializes a stat struct and clears the stats on the device
function stats_init(stats, dev) {
  // might require device-specific initialization
  stats.rx_pkts = 0;
  stats.tx_pkts = 0;
  stats.rx_bytes = 0;
  stats.tx_bytes = 0;
  stats.device = dev;
  if (dev) {
    // reset stats
    dev.ixy.read_stats(dev);
  }
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

// console.log('running init_rx...');
// init_rx(ixgbe_device); // we want to do this in the reset and init

function ixgbe_set_promisc(dev, enabled) {
  if (enabled) {
    console.log('enabling promisc mode');
    set_flags_js(dev.addr, defines.IXGBE_FCTRL, defines.IXGBE_FCTRL_MPE | defines.IXGBE_FCTRL_UPE);
  } else {
    console.log('disabling promisc mode');
    clear_flags_js(dev.addr, defines.IXGBE_FCTRL, defines.IXGBE_FCTRL_MPE
      | defines.IXGBE_FCTRL_UPE);
  }
}

function wait_for_link(dev) {
  console.log('Waiting for link...');
  let max_wait = 1000; // 10 seconds in ms
  const poll_interval = 10; // 10 ms in ms
  while (!(dev.ixy.get_link_speed(dev)) && max_wait > 0) {
    wait(poll_interval);
    max_wait -= poll_interval;
  }
  console.log(`Link speed is ${dev.ixy.get_link_speed(dev)} Mbit/s`);
}


// see section 4.6.3
function reset_and_init(dev) {
  console.log(`Resetting device ${dev.ixy.pci_addr}`);
  // section 4.6.3.1 - disable all interrupts
  addon.set_reg_js(dev.addr, defines.IXGBE_EIMC, 0x7FFFFFFF);

  // section 4.6.3.2
  addon.set_reg_js(dev.addr, defines.IXGBE_CTRL, defines.IXGBE_CTRL_RST_MASK);
  addon.wait_clear_reg_js(dev.addr, defines.IXGBE_CTRL, defines.IXGBE_CTRL_RST_MASK);
  wait(100); // why do we do this?
  // section 4.6.3.1 - disable interrupts again after reset
  addon.set_reg_js(dev.addr, defines.IXGBE_EIMC, 0x7FFFFFFF);

  console.log(`Initializing device ${dev.ixy.pci_addr}`);

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
    // TODO not yet implemented
    // start_tx_queue(dev, i);
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
      const val = bufs[i].mem.getUint8(70, littleEndian) + 1;
      bufs[i].mem.setUint8(70, val, littleEndian);
    }
    const num_tx = rx_dev.ixy.tx_batch(tx_dev, tx_queue, bufs, num_rx);
    // there are two ways to handle the case that packets are not being sent out:
    // either wait on tx or drop them; in this case it's better to drop them, otherwise we accumulate latency
    // TODO double check the correctnes of this slice
    bufs.slice(num_tx, num_rx).forEach((buf) => {
      pkt_buf_free(buf);
    });
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
/*
function forwardProgram( argc,  argv) {
	if (argc != 3) {
		printf("%s forwards packets between two ports.\n", argv[0]);
		printf("Usage: %s <pci bus id2> <pci bus id1>\n", argv[0]);
		return 1;
	}

	const dev1 = ixgbe_init(argv[1], 1, 1);
	const dev2 = ixgbe_init(argv[2], 1, 1);

	uint64_t last_stats_printed = monotonic_time();
	struct device_stats stats1, stats1_old;
	struct device_stats stats2, stats2_old;
	stats_init(&stats1, dev1);
	stats_init(&stats1_old, dev1);
	stats_init(&stats2, dev2);
	stats_init(&stats2_old, dev2);

	uint64_t counter = 0;
	while (true) {
		forward(dev1, 0, dev2, 0);
		forward(dev2, 0, dev1, 0);

		// don't poll the time unnecessarily
		if ((counter++ & 0xFFF) == 0) {
			uint64_t time = monotonic_time();
			if (time - last_stats_printed > 1000 * 1000 * 1000) {
				// every second
				ixy_read_stats(dev1, &stats1);
				print_stats_diff(&stats1, &stats1_old, time - last_stats_printed);
				stats1_old = stats1;
				if (dev1 != dev2) {
					ixy_read_stats(dev2, &stats2);
					print_stats_diff(&stats2, &stats2_old, time - last_stats_printed);
					stats2_old = stats2;
				}
				last_stats_printed = time;
			}
		}
	}
}
/* */

console.log('reset and init...');
reset_and_init(ixgbe_device);

console.log(util.inspect(ixgbe_device, false, 2, true /* enable colors */));
console.log('printing rx_queue descriptors read from buffer we saved:');
for (const index in ixgbe_device.rx_queues) {
  const queueDescriptor = getRxDescriptorFromVirt(ixgbe_device.rx_queues[index].descriptors);
  console.log(util.inspect(queueDescriptor, false, null, true /* enable colors */));
}


// console.log('ixgbe_device now:');
// console.log(util.inspect(ixgbe_device, false, null, true));
const stats = {};

function buf2hex(buffer) { // buffer is an ArrayBuffer
  return Array.prototype.map.call(new Uint8Array(buffer), x => `00${x.toString(16)}`.slice(-2)).join('');
}

function printPackage(index) {
  console.log(`package at index ${index} :`);
  const buf = bufferArray[index];
  console.log(util.inspect(buf, false, 1, true));
  if (buf) {
    console.log('content:');
    let str = '';
    for (let i = 0; i < buf.mem.byteLength; i++) {
      str += `00${buf.mem.getUint8(i).toString(16)}`.slice(-2);
    }
    console.log(str);
    // const decoder = new StringDecoder('utf8');
    // console.log(decoder.write(bufferArray[0].mem));
    // console.log('content as hex (sliced at 60 Byte because currently all buffers):');
    // console.log(buf2hex(buf.mem.buffer).slice(0, 60 * 2));
  }
}
const queue_id = 0;

function printOurPackages() {
  ixgbe_device.ixy.read_stats(ixgbe_device, stats);
  console.log('buffer array, should be packages we got:');
  // console.log(util.inspect(bufferArray, false, null, true));
  printPackage(0);
  // printPackage(4);

  console.log(`RDT register: ${addon.get_reg_js(ixgbe_device.addr, defines.IXGBE_RDT(queue_id))}\nRDH register: ${addon.get_reg_js(ixgbe_device.addr, defines.IXGBE_RDH(queue_id))}`);


  console.log('our rx_queues:');
  console.log(util.inspect(ixgbe_device.rx_queues[queue_id].mempool, false, 0, true));
}
stats_init(stats, ixgbe_device);

// setInterval(printOurPackages, 5000);

function lifeSignal() {
  console.log('.');
}
let timer = 0;
const timerVal = 3000;
const tmpRDT = -1;
const tmpRDH = -1;
const tmpPkgDrops = -1;
const bufferArrayLength = 512;

function receivePackets() {
  const bufferArray = new Array(bufferArrayLength);
  const numBufs = ixgbe_device.ixy.rx_batch(ixgbe_device, 0, bufferArray, bufferArrayLength);
  bufferArray.forEach((buf, index) => {
    if (index <= numBufs) {
      pkt_buf_free(buf);
    }
  });
  /*
  const newRDT = addon.get_reg_js(ixgbe_device.addr, defines.IXGBE_RDT(queue_id));
  const newRDH = addon.get_reg_js(ixgbe_device.addr, defines.IXGBE_RDH(queue_id));

  if (tmpRDH !== newRDH || tmpRDT !== newRDT) {
    tmpRDH = newRDH;
    tmpRDT = newRDT;
    console.log(`RDT register: ${tmpRDT}\nRDH register: ${tmpRDH}`);
  }
  */
  /*
  const pkgDrops = addon.get_reg_js(ixgbe_device.addr, defines.RXMPC(0));
  if (pkgDrops !== tmpPkgDrops) {
    tmpPkgDrops = pkgDrops;
    console.log(`Missed Packets Error counter: ${tmpPkgDrops}`);
  }
  */

  timer += 1;
  if (timer >= timerVal) {
    // printOurPackages();
    ixgbe_read_stats(ixgbe_device);
    timer = 0;
  }
}

// setInterval(lifeSignal, 1000);
setInterval(receivePackets, 0);
