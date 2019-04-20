const addon = require('./build/Release/exported_module');
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
// dev->addr is the pci address

// see section 4.6.7
// it looks quite complicated in the data sheet, but it's actually really easy because we don't need fancy features
function init_rx(pci_addr, num_of_queues)
{
  // make sure that rx is disabled while re-configuring it
  // the datasheet also wants us to disable some crypto-offloading related rx paths (but we don't care about them)
  clear_flags32(dev->addr, IXGBE_RXCTRL, IXGBE_RXCTRL_RXEN);
  // no fancy dcb or vt, just a single 128kb packet buffer for us
  set_reg32(dev->addr, IXGBE_RXPBSIZE(0), IXGBE_RXPBSIZE_128KB);
  for (int i = 1; i < 8; i++)
  {
    set_reg32(dev->addr, IXGBE_RXPBSIZE(i), 0);
  }

  // always enable CRC offloading
  set_flags32(dev->addr, IXGBE_HLREG0, IXGBE_HLREG0_RXCRCSTRP);
  set_flags32(dev->addr, IXGBE_RDRXCTL, IXGBE_RDRXCTL_CRCSTRIP);

  // accept broadcast packets
  set_flags32(dev->addr, IXGBE_FCTRL, IXGBE_FCTRL_BAM);

  // per-queue config, same for all queues
  for (uint16_t i = 0; i < dev->ixy.num_rx_queues; i++)
  {
    debug("initializing rx queue %d", i);
    // enable advanced rx descriptors, we could also get away with legacy descriptors, but they aren't really easier
    set_reg32(dev->addr, IXGBE_SRRCTL(i), (get_reg32(dev->addr, IXGBE_SRRCTL(i)) & ~IXGBE_SRRCTL_DESCTYPE_MASK) | IXGBE_SRRCTL_DESCTYPE_ADV_ONEBUF);
    // drop_en causes the nic to drop packets if no rx descriptors are available instead of buffering them
    // a single overflowing queue can fill up the whole buffer and impact operations if not setting this flag
    set_flags32(dev->addr, IXGBE_SRRCTL(i), IXGBE_SRRCTL_DROP_EN);
    // setup descriptor ring, see section 7.1.9
    uint32_t ring_size_bytes = NUM_RX_QUEUE_ENTRIES * sizeof(union ixgbe_adv_rx_desc);
    struct dma_memory mem = memory_allocate_dma(ring_size_bytes, true);
    // neat trick from Snabb: initialize to 0xFF to prevent rogue memory accesses on premature DMA activation
    memset(mem.virt, -1, ring_size_bytes);
    set_reg32(dev->addr, IXGBE_RDBAL(i), (uint32_t)(mem.phy & 0xFFFFFFFFull));
    set_reg32(dev->addr, IXGBE_RDBAH(i), (uint32_t)(mem.phy >> 32));
    set_reg32(dev->addr, IXGBE_RDLEN(i), ring_size_bytes);
    debug("rx ring %d phy addr:  0x%012lX", i, mem.phy);
    debug("rx ring %d virt addr: 0x%012lX", i, (uintptr_t)mem.virt);
    // set ring to empty at start
    set_reg32(dev->addr, IXGBE_RDH(i), 0);
    set_reg32(dev->addr, IXGBE_RDT(i), 0);
    // private data for the driver, 0-initialized
    struct ixgbe_rx_queue *queue = ((struct ixgbe_rx_queue *)(dev->rx_queues)) + i;
    queue->num_entries = NUM_RX_QUEUE_ENTRIES;
    queue->rx_index = 0;
    queue->descriptors = (union ixgbe_adv_rx_desc *)mem.virt;
  }

  // last step is to set some magic bits mentioned in the last sentence in 4.6.7
  set_flags32(dev->addr, IXGBE_CTRL_EXT, IXGBE_CTRL_EXT_NS_DIS);
  // this flag probably refers to a broken feature: it's reserved and initialized as '1' but it must be set to '0'
  // there isn't even a constant in ixgbe_types.h for this flag
  for (uint16_t i = 0; i < dev->ixy.num_rx_queues; i++)
  {
    clear_flags32(dev->addr, IXGBE_DCA_RXCTRL(i), 1 << 12);
  }

  // start RX
  set_flags32(dev->addr, IXGBE_RXCTRL, IXGBE_RXCTRL_RXEN);
}
