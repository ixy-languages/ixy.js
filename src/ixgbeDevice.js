const addon = require('../build/Release/exported_module'); // eslint-disable-line import/no-unresolved
const { IXY } = require('./IXYclass');
const init = require('./init');
const wait = require('./wait');

class IxgbeDevice {
  constructor(pci_addr, num_rx_queues, num_tx_queues) {
    this.rx_queues = new Array(num_rx_queues);
    this.tx_queues = new Array(num_rx_queues);
    // get IXY memory
    this.addr = addon.getIXYAddr(pci_addr);
    this.pkts_sent = 0;
    this.pkts_rec = 0;
    // create a View on the IXY memory
    this.mem32 = new Uint32Array(this.addr);
    this.ixy = new IXY(pci_addr, num_rx_queues, num_tx_queues, this);
  }

  get_reg_js(reg) {
    return this.mem32[reg / 4];
  }

  set_reg_js(reg, val) {
    this.mem32[reg / 4] = val;
  }

  clear_flags_js(reg, flags) {
    this.set_reg_js(reg, this.get_reg_js(reg) & ~flags);
  }

  set_flags_js(reg, flags) {
    this.set_reg_js(reg, this.get_reg_js(reg) | flags);
  }

  wait_set_reg_js(reg, val) {
    while ((this.get_reg_js(reg) & val) !== val) {
      this.set_reg_js(reg, val);
      wait(100);
    }
  }

  wait_clear_reg_js(reg, val) {
    while ((this.get_reg_js(reg) & val) !== 0) {
      this.clear_flags_js(reg, val);
      wait(100);
    }
  }
}
const MAX_QUEUES = 64;

function ixgbe_init(pci_addr, num_rx_queues, num_tx_queues) {
  // potential addition for later: warn if not running on root
  if (num_rx_queues > MAX_QUEUES) {
    throw new Error(`cannot configure ${num_rx_queues} rx queues: limit is ${MAX_QUEUES}`);
  }
  if (num_tx_queues > MAX_QUEUES) {
    throw new Error(`cannot configure ${num_tx_queues} tx queues: limit is ${MAX_QUEUES}`);
  }
  const ixgbeDev = new IxgbeDevice(pci_addr, num_rx_queues, num_tx_queues);
  init(ixgbeDev);
  return ixgbeDev;
}

module.exports = {
  init: ixgbe_init,
};
