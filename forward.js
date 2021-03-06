const IxgbeDevice = require('./src/ixgbeDevice');
const stats = require('./src/stats');

let BATCH_SIZE = 32;


function forward(rx_dev, rx_queue, tx_dev, tx_queue) {
  const bufs = new Array(BATCH_SIZE);
  const num_rx = rx_dev.ixy.rx_batch(rx_queue, bufs, BATCH_SIZE);
  if (num_rx > 0) {
    // touch all packets, otherwise it's a completely unrealistic workload
    // if the packet just stays in L3
    for (let i = 0; i < num_rx; i++) {
      bufs[i].mem8[6] += 1;
    }
    const num_tx = tx_dev.ixy.tx_batch(tx_queue, bufs, num_rx);
    // there are two ways to handle the case that packets are not being sent out:
    // either wait on tx or drop them; in this case it's better to drop them,
    // otherwise we accumulate latency
    for (const buf of bufs.slice(num_tx, num_rx)) {
      buf.free();
    }
  }
}

function forwardProgram(pciAddr1, pciAddr2, batchSize, trackPerformance = false) {
  if (!(pciAddr1 && pciAddr2)) {
    throw new Error('no pci adresses supplied. please use: node ixy.js forward xxxx:xx:xx.x xxxx:xx:xx.x optionalBatchSize optionalTrackPerformance');
  }
  if (batchSize) {
    BATCH_SIZE = batchSize;
  }

  const dev1 = IxgbeDevice.init(pciAddr1, 1, 1);
  const dev2 = IxgbeDevice.init(pciAddr2, 1, 1);

  const stats1 = {};
  const stats1_old = {};
  const stats2 = {};
  const stats2_old = {};
  stats.init(stats1, dev1);
  stats.init(stats1_old, dev1);
  stats.init(stats2, dev2);
  stats.init(stats2_old, dev2);

  let last_stats_printed = stats.convert(process.hrtime());
  let counter = 0;
  while (true) {
    forward(dev1, 0, dev2, 0);
    forward(dev2, 0, dev1, 0);
    if ((counter++ & 0xFFF) === 0) {
      const time = stats.convert(process.hrtime());
      const timeDifference = time - last_stats_printed;
      if (timeDifference > 1000 * 1000 * 1000) { // every second
        last_stats_printed = time;
        dev1.ixy.read_stats(stats1);
        stats.print(stats1, stats1_old, timeDifference, trackPerformance);
        stats.copy(stats1_old, stats1);
        if (dev1.ixy.pci_addr !== dev2.ixy.pci_addr) {
          dev2.ixy.read_stats(stats2);
          stats.print(stats2, stats2_old, timeDifference, trackPerformance);
          stats.copy(stats2_old, stats2);
        }
      }
    }
  }
}


module.exports = forwardProgram;
