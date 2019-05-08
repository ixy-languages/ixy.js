const addon = require('./build/Release/exported_module');
const Long = require('long'); // bigint is annoying http://thecodebarbarian.com/an-overview-of-bigint-in-node-js.html
const util = require('util');
const bigInt = require('big-integer');

// const jstruct = require('js-struct');

// check if little or big endian
const littleEndian = (function lE() {
  const buffer = new ArrayBuffer(2);
  new DataView(buffer).setInt16(0, 256, true /* littleEndian */);
  // Int16Array benutzt die Plattform Byte-Reihenfolge.
  return new Int16Array(buffer)[0] === 256;
})();

const currentHost = 'narva'; // adjust this part before deploy on machine
let pciAddr;
let pciAddr2;
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

/*
lets build following in JS:
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
	uint32_t (*rx_batch) (struct ixy_device* dev, uint16_t queue_id, struct pkt_buf* bufs[], uint32_t num_bufs);
	uint32_t (*tx_batch) (struct ixy_device* dev, uint16_t queue_id, struct pkt_buf* bufs[], uint32_t num_bufs);
	void (*read_stats) (struct ixy_device* dev, struct device_stats* stats);
	void (*set_promisc) (struct ixy_device* dev, bool enabled);
	uint32_t (*get_link_speed) (const struct ixy_device* dev);
};
*/
const ixgbe_device = {
  ixy: {
    pci_addr: pciAddr,
    driver_name: 'ixy.js',
    num_rx_queues: 4,
    num_tx_queues: 4,
    rx_batch: () => { },
    tx_batch: () => { },
    read_stats: () => { },
    set_promisc: () => { },
    get_link_speed: () => { }
  },
  addr: null,
  dataView: null,
  phAddr: null,
  rx_queues: [],
  tx_queues: []
};

// get IXY memory
ixgbe_device.addr = addon.getIXYAddr(ixgbe_device.ixy.pci_addr);
const IXYDevice = ixgbe_device.addr;
// create a View on the IXY memory, which is RO
ixgbe_device.dataView = new DataView(IXYDevice);
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

// we want to initialize rx queues, and change functions to the JS equivalent

function clear_flags_js(addr, reg, flags) {
  addon.set_reg_js(addr, reg, addon.get_reg_js(addr, reg) & ~flags);
}
function set_flags_js(addr, reg, flags) {
  addon.set_reg_js(addr, reg, addon.get_reg_js(addr, reg) | flags);
}

const defines = {
  IXGBE_RXCTRL: 0x03000,
  IXGBE_RXCTRL_RXEN: 0x00000001,
  IXGBE_RXPBSIZE_128KB: 0x00020000,
  IXGBE_RXPBSIZE: i => 0x03C00 + (i * 4),
  IXGBE_HLREG0: 0x04240,
  IXGBE_HLREG0_RXCRCSTRP: 0x00000002,
  IXGBE_RDRXCTL: 0x02F00,
  IXGBE_RDRXCTL_CRCSTRIP: 0x00000002, IXGBE_FCTRL: 0x05080,
  IXGBE_FCTRL_BAM: 0x00000400,
  IXGBE_SRRCTL: i => (i <= 15 ? 0x02100 + (i * 4) : (i) < 64 ? 0x01014 + ((i) * 0x40) : 0x0D014 + (((i) - 64) * 0x40)),
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
  IXGBE_DCA_RXCTRL: i => (i <= 15 ? 0x02200 + (i * 4) : (i) < 64 ? 0x0100C + ((i) * 0x40) : 0x0D00C + (((i) - 64) * 0x40)),
  SIZE_PKT_BUF_HEADROOM: 40
};

const getDescriptorFromVirt = (virtMem, index = 0) => {
  const offset = index * 16; // offset in bytes, depending on index
  const descriptor = {};
  const dataView = new DataView(virtMem);
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
  descriptor.pkt_addr = dataView.getFloat64(0 + offset, littleEndian);
  descriptor.hdr_addr = dataView.getFloat64(8 + offset, littleEndian);
  descriptor.lower = {};
  descriptor.lower.lo_dword = {};
  descriptor.lower.lo_dword.data = dataView.getUint32(0 + offset, littleEndian);
  descriptor.lower.lo_dword.hs_rss = {};
  descriptor.lower.lo_dword.hs_rss.pkt_info = dataView.getUint16(0 + offset, littleEndian);
  descriptor.lower.lo_dword.hs_rss.hdr_info = dataView.getUint16(2 + offset, littleEndian);
  descriptor.lower.hi_dword = {};
  descriptor.lower.hi_dword.rss = dataView.getUint32(4 + offset, littleEndian);
  descriptor.lower.hi_dword.ip_id = dataView.getUint16(4 + offset, littleEndian);
  descriptor.lower.hi_dword.csum = dataView.getUint16(6 + offset, littleEndian);
  descriptor.upper = {};
  descriptor.upper.status_error = dataView.getUint32(8 + offset, littleEndian);
  descriptor.upper.length = dataView.getUint16(12 + offset, littleEndian);
  descriptor.upper.vlan = dataView.getUint16(14 + offset, littleEndian);
  descriptor.memView = dataView;

  // TODO check if upper/lower is wrong because we supply the littleEndian when reading (so double-correct lE)

  return descriptor;
};

// see section 4.6.7
// it looks quite complicated in the data sheet, but it's actually really easy because we don't need fancy features
function init_rx(ixgbe_device) {
  const IXYDevice = ixgbe_device.addr;
  const num_of_queues = ixgbe_device.ixy.num_rx_queues;
  // make sure that rx is disabled while re-configuring it
  // the datasheet also wants us to disable some crypto-offloading related rx paths (but we don't care about them)
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
    // enable advanced rx descriptors, we could also get away with legacy descriptors, but they aren't really easier
    addon.set_reg_js(IXYDevice, defines.IXGBE_SRRCTL(i), (addon.get_reg_js(IXYDevice, defines.IXGBE_SRRCTL(i)) & ~defines.IXGBE_SRRCTL_DESCTYPE_MASK) | defines.IXGBE_SRRCTL_DESCTYPE_ADV_ONEBUF);
    // drop_en causes the nic to drop packets if no rx descriptors are available instead of buffering them
    // a single overflowing queue can fill up the whole buffer and impact operations if not setting this flag
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
    // neat trick from Snabb: initialize to 0xFF to prevent rogue memory accesses on premature DMA activation
    const virtMemView = new DataView(mem.virt);
    for (let count = 0; count < ring_size_bytes; count++) {
      virtMemView.setUint32(count / 4, 0xFFFFFFFF, littleEndian);
    }
    // for now there is no obvious way to use bigint in a smart way, even within the long library
    const shortenedPhys = addon.shortenPhys(mem.phy);
    const shortenedPhysLatter = addon.shortenPhysLatter(mem.phy);
    addon.set_reg_js(IXYDevice, defines.IXGBE_RDBAL(i), shortenedPhys);
    addon.set_reg_js(IXYDevice, defines.IXGBE_RDBAH(i), shortenedPhysLatter);
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
      descriptors: mem.virt
    };
    ixgbe_device.rx_queues.push(queue);
  }

  // last step is to set some magic bits mentioned in the last sentence in 4.6.7
  set_flags_js(IXYDevice, defines.IXGBE_CTRL_EXT, defines.IXGBE_CTRL_EXT_NS_DIS);
  // this flag probably refers to a broken feature: it's reserved and initialized as '1' but it must be set to '0'
  // there isn't even a constant in 'defines' for this flag
  for (let i = 0; i < num_of_queues; i++) {
    clear_flags_js(IXYDevice, defines.IXGBE_DCA_RXCTRL(i), 1 << 12);
  }

  // start RX
  set_flags_js(IXYDevice, defines.IXGBE_RXCTRL, defines.IXGBE_RXCTRL_RXEN);
}

console.log('running init_rx...');
init_rx(ixgbe_device);

console.log(util.inspect(ixgbe_device, false, null, true /* enable colors */));
console.log('printing rx_queues read from buffer we saved:');
for (const index in ixgbe_device.rx_queues) {
  const queueDescriptor = getDescriptorFromVirt(ixgbe_device.rx_queues[index].descriptors);
  console.log(util.inspect(queueDescriptor, false, null, true /* enable colors */));
}


/* let's port mempool allocation first:
*/

function memory_allocate_mempool_js(num_entries, entry_size) {
  entry_size = entry_size ? entry_size : 2048;
  // require entries that neatly fit into the page size, this makes the memory pool much easier
  // otherwise our base_addr + index * size formula would be wrong because we can't cross a page-boundary
  if (defines.HUGE_PAGE_SIZE % entry_size) {
    console.error(`entry size must be a divisor of the huge page size ${defines.HUGE_PAGE_SIZE}`);
  }
  const mem = addon.getDmaMem(num_entries * entry_size, false);
  const mempool = {};
  mempool.num_entries = num_entries;
  mempool.buf_size = entry_size;
  mempool.base_addr = mem; // buffer that holds mempool
  mempool.free_stack_top = num_entries;
  mempool.free_stack = [];

  for (let i = 0; i < num_entries; i++) {
    mempool.free_stack.push(i);
    const buf = new DataView(mem, i * entry_size); // this should do the trick?
    // TODO get buffer correctly!
    /*
    struct pkt_buf * buf = (struct pkt_buf *) (((uint8_t *) mempool -> base_addr) + i * entry_size);
    // this is what a pkt buff has saved:
    struct pkt_buf {
      // physical address to pass a buffer to a nic
      uintptr_t buf_addr_phy; // 8 bytes
      struct mempool* mempool; // 8 bytes????
      uint32_t mempool_idx; // 4 bytes
      uint32_t size; //4 bytes
      uint8_t head_room[SIZE_PKT_BUF_HEADROOM]; // 40 bytes, does this mean the rest above is 24 bytes?
      uint8_t data[] __attribute__((aligned(64))); // min size of 64 bytes
    };
    // end of buf
*/
    // physical addresses are not contiguous within a pool, we need to get the mapping
    // minor optimization opportunity: this only needs to be done once per page

    // i think these should be done on the view, not variables /sighs
    const buff = {};
    buff.buf_addr_phy = addon.virtToPhys(buf.buffer); // this should get the correct physical adress to the part of the mem of the mempool the buffer should be in
    buff.mempool_idx = i;
    buff.mempool = mempool;
    buff.size = 0;

    buf.setBigUint64(0, buff.buf_addr_phy, littleEndian);
    // let's skip mempool 8 bytes for now?
    // buf.setBigUint64(8, bigInt(), littleEndian); // without a real bigint we cant write a bigint
    buf.setUint32(8, 0);
    buf.setUint32(12, 0);

    buf.setUint32(16, buff.mempool_idx, littleEndian);
    buf.setUint32(20, buff.size, littleEndian);
    // same problem as above, cannot write bigint without real bigint input
    /*
    buf.setBigUint64(24, bigInt(), littleEndian);
    buf.setBigUint64(32, bigInt(), littleEndian);
    buf.setBigUint64(40, bigInt(), littleEndian);
    buf.setBigUint64(48, bigInt(), littleEndian);
    buf.setBigUint64(56, bigInt(), littleEndian);
    */
    buf.setUint32(24, 0);
    buf.setUint32(28, 0);
    buf.setUint32(32, 0);
    buf.setUint32(36, 0);
    buf.setUint32(40, 0);
    buf.setUint32(44, 0);
    buf.setUint32(48, 0);
    buf.setUint32(52, 0);
    buf.setUint32(56, 0);
    buf.setUint32(60, 0);

    // now we filled the first 64 bytes

    // the rest can be data, but we dont give access via a variable
  }
  return mempool;
}
// another function to port
function pkt_buf_alloc_batch_js(mempool, num_bufs) {
  const bufs = [];
  if (mempool.free_stack_top < num_bufs) {
    console.warn(`memory pool ${mempool} only has ${mempool.free_stack_top} free bufs, requested ${num_bufs}`);
    num_bufs = mempool.free_stack_top;
  }
  for (let i = 0; i < num_bufs; i++) {
    const entry_id = mempool.free_stack[--mempool.free_stack_top];
    bufs.push(new DataView(mempool.base_addr, entry_id * mempool.buf_size, mempool.buf_size));
  }
  return bufs;
}

function pkt_buf_alloc_js(mempool) {
  const buf = pkt_buf_alloc_batch_js(mempool, 1);
  return buf/* [0]*/;
}

/*
now lets port this:
*/
// /* // remove the leftmost comment slashes to deactivate

function start_rx_queue(ixgbe_device, queue_id) {
  console.log(`starting rx queue ${queue_id}`);
  const queue = ixgbe_device.rx_queues[queue_id];
  // 2048 as pktbuf size is strictly speaking incorrect:
  // we need a few headers (1 cacheline), so there's only 1984 bytes left for the device
  // but the 82599 can only handle sizes in increments of 1 kb; but this is fine since our max packet size
  // is the default MTU of 1518
  // this has to be fixed if jumbo frames are to be supported
  // mempool should be >= the number of rx and tx descriptors for a forwarding application
  const mempool_size = defines.NUM_RX_QUEUE_ENTRIES + defines.NUM_TX_QUEUE_ENTRIES;
  queue.mempool = memory_allocate_mempool_js(mempool_size < 4096 ? 4096 : mempool_size, 2048);
  if (queue.num_entries % 2 !== 0) {
    throw new Error('number of queue entries must be a power of 2');
  }
  for (let i = 0; i < queue.num_entries; i++) {
    const rxd = getDescriptorFromVirt(queue.descriptors, i);
    const buf = pkt_buf_alloc_js(queue.mempool);
    if (!buf) {
      console.error('failed to allocate rx descriptor');
    }
    console.log(util.inspect(buf, false, null, true /* enable colors */));
    // missing the offset value of this, would it be 64 bytes?
    // set pkt addr
    console.log(`type of mem phy addr: ${typeof buf.buf_addr_phy}`);
    rxd.memView.setBigUint64(0, addon.addBigInts(buf.buf_addr_phy, 64)/* offsetof(struct pkt_buf, data)*/, littleEndian);
    // set hdr addr
    rxd.memView.setBigUint64(8, 0, littleEndian);
    // we need to return the virtual address in the rx function which the descriptor doesn't know by default
    queue.virtual_addresses[i] = buf;
  }
  // enable queue and wait if necessary
  set_flags_js(ixgbe_device.addr, defines.IXGBE_RXDCTL(queue_id), defines.IXGBE_RXDCTL_ENABLE);
  addon.wait_set_reg32(ixgbe_device.addr, defines.IXGBE_RXDCTL(queue_id), defines.IXGBE_RXDCTL_ENABLE);
  // rx queue starts out full
  addon.set_reg_js(ixgbe_device.addr, defines.IXGBE_RDH(queue_id), 0);
  // was set to 0 before in the init function
  addon.set_reg_js(ixgbe_device.addr, defines.IXGBE_RDT(queue_id), queue.num_entries - 1);
}
/**/

console.log('starting rx_queue....');
for (const i in ixgbe_device.rx_queues) {
  start_rx_queue(ixgbe_device, i);
}
