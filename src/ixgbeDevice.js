const addon = require('../build/Release/exported_module'); // eslint-disable-line import/no-unresolved
const { IXY } = require('./IXYclass');
const init = require('./init');

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
}
const MAX_QUEUES = 64;

function ixgbe_init(pci_addr, num_rx_queues, num_tx_queues) {
  // TODO warn if not running on root?
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
