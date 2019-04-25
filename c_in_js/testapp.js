const addon = require('./build/Release/exported_module');
const Long = require('long');
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
// get IXY memory
const IXYDevice = addon.getIXYAddr(pciAddr);
// create a View on the IXY memory, which is RO
const IXYView = new DataView(IXYDevice);
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
  IXGBE_RDBAL: i => (i < 64 ? 0x01000 + (i * 0x40) : 0x0D000 + ((i - 64) * 0x40)),
  IXGBE_RDBAH: i => (i < 64 ? 0x01004 + (i * 0x40) : 0x0D004 + ((i - 64) * 0x40)),
  IXGBE_RDLEN: i => (i < 64 ? 0x01008 + (i * 0x40) : 0x0D008 + ((i - 64) * 0x40)),
  IXGBE_RDH: i => (i < 64 ? 0x01010 + (i * 0x40) : 0x0D010 + ((i - 64) * 0x40)),
  IXGBE_RDT: i => (i < 64 ? 0x01018 + (i * 0x40) : 0x0D018 + ((i - 64) * 0x40)),
  IXGBE_CTRL_EXT: 0x00018,
  IXGBE_CTRL_EXT_NS_DIS: 0x00010000,
  IXGBE_DCA_RXCTRL: i => (i <= 15 ? 0x02200 + (i * 4) : (i) < 64 ? 0x0100C + ((i) * 0x40) : 0x0D00C + (((i) - 64) * 0x40))
};

// /* // remove the leftmost comment slashes to deactivate


// see section 4.6.7
// it looks quite complicated in the data sheet, but it's actually really easy because we don't need fancy features
function init_rx(IXYDevice, num_of_queues) {
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
    mem.virt = addon.getDmaMem(ring_size_bytes, true);
    mem.phy = addon.virtToPhys(mem.virt);
    // neat trick from Snabb: initialize to 0xFF to prevent rogue memory accesses on premature DMA activation
    /*
    TODO memset
    memset(mem.virt, -1, ring_size_bytes);
    */

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
TODO create this buffer (might need to call C for this?)
    struct ixgbe_rx_queue *queue = ((struct ixgbe_rx_queue *)(dev->rx_queues)) + i;
    queue->num_entries = NUM_RX_QUEUE_ENTRIES;
    queue->rx_index = 0;
    queue->descriptors = (union ixgbe_adv_rx_desc *)mem.virt;
    */
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
init_rx(IXYDevice, 20);

/*
*/
