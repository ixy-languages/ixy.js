class IxgbeDevice {
    constructor(pci_addr, num_rx_queues, num_tx_queues) {
      this.rx_queues = new Array(num_rx_queues);
      this.tx_queues = new Array(num_rx_queues);
      // get IXY memory
      this.addr = addon.getIXYAddr(pci_addr);
      this.ixy = new IXY(pci_addr, num_rx_queues, num_tx_queues);
      this.pkts_sent = 0;
      this.pkts_rec = 0;
      // create a View on the IXY memory
      this.mem32 = new Uint32Array(this.addr);
    }
}
module.exports = {
    IxgbeDevice
}