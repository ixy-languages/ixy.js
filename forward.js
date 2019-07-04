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

function forwardProgram(pciAddr1, pciAddr2, batchSize) {
  if (!(pciAddr1 && pciAddr2)) {
    throw new Error('no pci adresses supplied. please use: node ixy.js forward xxxx:xx:xx.x xxxx:xx:xx.x optionalBatchSize');
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

  let last_stats_printed = process.hrtime();
  // /*
  let i = 0;
  while (true) {
    forward(dev1, 0, dev2, 0);
    forward(dev2, 0, dev1, 0);
    if (i++ > 50000) {
      i = 0;
      const time = process.hrtime(last_stats_printed);
      last_stats_printed = process.hrtime();
      dev1.ixy.read_stats(stats1);
      stats.print(stats1, stats1_old, stats.convert(time));
      stats.copy(stats1_old, stats1);
      if (dev1.ixy.pci_addr !== dev2.ixy.pci_addr) {
        dev2.ixy.read_stats(stats2);
        stats.print(stats2, stats2_old, stats.convert(time));
        stats.copy(stats2_old, stats2);
      }
    }
  }

  /* */
  /*
      // async
      setInterval(() => {
        process.nextTick(() => {
          const time = process.hrtime(last_stats_printed);
          last_stats_printed = process.hrtime();
          dev1.ixy.read_stats(dev1, stats1);
          stats.print(stats1, stats1_old, stats.convert(time));
          stats.copy(stats1_old, stats1);
          if (dev1.ixy.pci_addr !== dev2.ixy.pci_addr) {
            dev2.ixy.read_stats(dev2, stats2);
            stats.print(stats2, stats2_old, stats.convert(time));
            stats.copy(stats2_old, stats2);
          }
        });
      }, 1000);
      function forwardStuff() {
        forward(dev1, 0, dev2, 0);
        forward(dev2, 0, dev1, 0);
        setImmediate(forwardStuff);
      }
      forwardStuff();

      /* */
}


module.exports = forwardProgram;
