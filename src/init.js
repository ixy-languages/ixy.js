const addon = require('../build/Release/exported_module'); // eslint-disable-line import/no-unresolved
const defines = require('./constants');
const queues = require('./queues');
const wait = require('./wait');


// see section 4.6.7
// it looks quite complicated in the data sheet, but it's actually
// really easy because we don't need fancy features
function init_rx(ixgbe_device) {
  const num_of_queues = ixgbe_device.ixy.num_rx_queues;
  // make sure that rx is disabled while re-configuring it
  // the datasheet also wants us to disable some crypto-offloading
  // related rx paths(but we don't care about them)
  ixgbe_device.clear_flags_js(defines.IXGBE_RXCTRL, defines.IXGBE_RXCTRL_RXEN);
  // no fancy dcb or vt, just a single 128kb packet buffer for us
  ixgbe_device.set_reg_js(defines.IXGBE_RXPBSIZE(0), defines.IXGBE_RXPBSIZE_128KB);
  for (let i = 1; i < 8; i++) {
    ixgbe_device.set_reg_js(defines.IXGBE_RXPBSIZE(i), 0);
  }
  // always enable CRC offloading
  ixgbe_device.set_flags_js(defines.IXGBE_HLREG0, defines.IXGBE_HLREG0_RXCRCSTRP);
  ixgbe_device.set_flags_js(defines.IXGBE_RDRXCTL, defines.IXGBE_RDRXCTL_CRCSTRIP);

  // accept broadcast packets
  ixgbe_device.set_flags_js(defines.IXGBE_FCTRL, defines.IXGBE_FCTRL_BAM);

  // per-queue config, same for all queues
  for (let i = 0; i < num_of_queues; i++) {
    console.info(`initializing rx queue ${i}`);
    // enable advanced rx descriptors,
    // we could also get away with legacy descriptors, but they aren't really easier
    ixgbe_device.set_reg_js(defines.IXGBE_SRRCTL(i),
      (ixgbe_device.get_reg_js(defines.IXGBE_SRRCTL(i)) & ~defines.IXGBE_SRRCTL_DESCTYPE_MASK)
        | defines.IXGBE_SRRCTL_DESCTYPE_ADV_ONEBUF);
    // drop_en causes the nic to drop packets if no rx descriptors are available
    // instead of buffering them
    // a single overflowing queue can fill up the whole buffer
    // and impact operations if not setting this flag
    ixgbe_device.set_flags_js(defines.IXGBE_SRRCTL(i), defines.IXGBE_SRRCTL_DROP_EN);
    // setup descriptor ring, see section 7.1.9
    const ring_size_bytes = defines.NUM_RX_QUEUE_ENTRIES * 16;
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
    const PhysEnding = Number(mem.phy >> 32n);
    // BigInt(32)/* 32n */); // rewrite to 1n syntax before running, but keep at BigInt(1) syntax because otherwise eslint will not work
    ixgbe_device.set_reg_js(defines.IXGBE_RDBAL(i), PhysBeginning);
    ixgbe_device.set_reg_js(defines.IXGBE_RDBAH(i), PhysEnding);
    ixgbe_device.set_reg_js(defines.IXGBE_RDLEN(i), ring_size_bytes);
    // set ring to empty at start
    ixgbe_device.set_reg_js(defines.IXGBE_RDH(i), 0);
    ixgbe_device.set_reg_js(defines.IXGBE_RDT(i), 0);
    // private data for the driver
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
  ixgbe_device.set_flags_js(defines.IXGBE_CTRL_EXT, defines.IXGBE_CTRL_EXT_NS_DIS);
  // this flag probably refers to a broken feature: it's reserved
  // and initialized as '1' but it must be set to '0'
  // there isn't even a constant in 'defines' for this flag
  for (let i = 0; i < num_of_queues; i++) {
    ixgbe_device.clear_flags_js(defines.IXGBE_DCA_RXCTRL(i), 1 << 12);
  }
  // start RX
  ixgbe_device.set_flags_js(defines.IXGBE_RXCTRL, defines.IXGBE_RXCTRL_RXEN);
}

// see section 4.6.8
function init_tx(dev) {
  // crc offload and small packet padding
  dev.set_flags_js(defines.IXGBE_HLREG0, defines.IXGBE_HLREG0_TXCRCEN
      | defines.IXGBE_HLREG0_TXPADEN);
  // set default buffer size allocations
  // see also: section 4.6.11.3.4, no fancy features like DCB and VTd
  dev.set_reg_js(defines.IXGBE_TXPBSIZE(0), defines.IXGBE_TXPBSIZE_40KB);
  for (let i = 1; i < 8; i++) {
    dev.set_reg_js(defines.IXGBE_TXPBSIZE(i), 0);
  }
  // required when not using DCB/VTd
  dev.set_reg_js(defines.IXGBE_DTXMXSZRQ, 0xFFFF);
  dev.clear_flags_js(defines.IXGBE_RTTDCS, defines.IXGBE_RTTDCS_ARBDIS);
  // per-queue config for all queues
  for (let i = 0; i < dev.ixy.num_tx_queues; i++) {
    console.info(`initializing tx queue ${i}`);
    // setup descriptor ring, see section 7.1.9
    const ring_size_bytes = defines.NUM_TX_QUEUE_ENTRIES * 16;
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
    const PhysEnding = Number(mem.phy >> 32n);
    // BigInt(32)/* 32n */); // rewrite to 1n syntax before running, but keep at BigInt(1) syntax because otherwise eslint will not work
    dev.set_reg_js(defines.IXGBE_TDBAL(i), PhysBeginning);
    dev.set_reg_js(defines.IXGBE_TDBAH(i), PhysEnding);
    dev.set_reg_js(defines.IXGBE_TDLEN(i), ring_size_bytes);
    // descriptor writeback magic values, important to get good performance and low PCIe overhead
    // see 7.2.3.4.1 and 7.2.3.5 for an explanation of these values and how to find good ones
    // we just use the defaults from DPDK here,
    // but this is a potentially interesting point for optimizations
    let txdctl = dev.get_reg_js(defines.IXGBE_TXDCTL(i));
    // there are no defines for this in ixgbe_type.h for some reason
    // pthresh: 6:0, hthresh: 14:8, wthresh: 22:16
    txdctl &= ~(0x7F | (0x7F << 8) | (0x7F << 16)); // clear bits
    txdctl |= 36 | (8 << 8) | (4 << 16); // from DPDK
    dev.set_reg_js(defines.IXGBE_TXDCTL(i), txdctl);

    // private data for the driver
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
  dev.set_reg_js(defines.IXGBE_DMATXCTL, defines.IXGBE_DMATXCTL_TE);
}

// see section 4.6.4
function init_link(dev) {
  // should already be set by the eeprom config,
  // maybe we shouldn't override it here to support weirdo nics?
  dev.set_reg_js(defines.IXGBE_AUTOC,
    (dev.get_reg_js(defines.IXGBE_AUTOC) & ~defines.IXGBE_AUTOC_LMS_MASK)
      | defines.IXGBE_AUTOC_LMS_10G_SERIAL);
  dev.set_reg_js(defines.IXGBE_AUTOC,
    (dev.get_reg_js(defines.IXGBE_AUTOC) & ~defines.IXGBE_AUTOC_10G_PMA_PMD_MASK)
      | defines.IXGBE_AUTOC_10G_XAUI);
  // negotiate link
  dev.set_flags_js(defines.IXGBE_AUTOC, defines.IXGBE_AUTOC_AN_RESTART);
  // datasheet wants us to wait for the link here, but we can continue and wait afterwards
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
  dev.set_reg_js(defines.IXGBE_EIMC, 0x7FFFFFFF);
  // section 4.6.3.2
  dev.set_reg_js(defines.IXGBE_CTRL, defines.IXGBE_CTRL_RST_MASK);
  dev.wait_clear_reg_js(defines.IXGBE_CTRL, defines.IXGBE_CTRL_RST_MASK);
  wait(100);
  // section 4.6.3.1 - disable interrupts again after reset
  dev.set_reg_js(defines.IXGBE_EIMC, 0x7FFFFFFF);
  console.info(`Initializing device ${dev.ixy.pci_addr}`);
  // section 4.6.3 - Wait for EEPROM auto read completion
  dev.wait_set_reg_js(defines.IXGBE_EEC, defines.IXGBE_EEC_ARD);
  // section 4.6.3 - Wait for DMA initialization done (RDRXCTL.DMAIDONE)
  dev.wait_set_reg_js(defines.IXGBE_RDRXCTL, defines.IXGBE_RDRXCTL_DMAIDONE);
  // section 4.6.4 - initialize link (auto negotiation)
  init_link(dev);
  // section 4.6.5 - statistical counters
  // reset-on-read registers, just read them once
  dev.ixy.read_stats(dev);
  // section 4.6.7 - init rx
  init_rx(dev);
  // section 4.6.8 - init tx
  init_tx(dev);
  // enables queues after initializing everything
  for (let i = 0; i < dev.ixy.num_rx_queues; i++) {
    queues.startRX(dev, i);
  }
  for (let i = 0; i < dev.ixy.num_tx_queues; i++) {
    queues.startTX(dev, i);
  }
  // skip last step from 4.6.3 - don't want interrupts
  // finally, enable promisc mode by default, it makes testing less annoying
  dev.ixy.set_promisc(true);
  // wait for some time for the link to come up
  wait_for_link(dev);
}

module.exports = reset_and_init;
