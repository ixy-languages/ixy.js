const IxgbeDevice = require('./ixgbeDevice');
const packets = require('./packets');
const memPool = require('./mempool');
const stats = require('./stats');

// check if little or big endian
const littleEndian = (function lE() {
  const buffer = new ArrayBuffer(2);
  new DataView(buffer).setInt16(0, 256, true /* littleEndian */);
  // Int16Array uses the correct byte-order for the platform.
  return new Int16Array(buffer)[0] === 256;
}());


let BATCH_SIZE = 32;


function packet_generator_program(pciAddr, batchSize) {
  if (!pciAddr) {
    throw new Error('no pci adress supplied. please use: ixy.js generate xxxx:xx:xx.x optionalBatchSize');
  }
  if (batchSize) {
    BATCH_SIZE = batchSize;
  }
  const mempool = memPool.init();
  const dev = IxgbeDevice.init(pciAddr, 1, 1);
  let last_stats_printed = stats.convert(process.hrtime());
  const stat_old = {};
  const stat = {};
  stats.init(stat, dev);
  stats.init(stat_old, dev);
  // array of bufs sent out in a batch
  const bufs = new Array(BATCH_SIZE);
  let seq_num = BigInt(0)/* 0n */; // TODO rewrite to 1n syntax before running, but keep at BigInt(1) syntax because otherwise eslint will not work
  // /*
  let counter = 0;
  // tx loop
  while (true) {
    // we cannot immediately recycle packets, we need to allocate new packets every time
    // the old packets might still be used by the NIC: tx is async
    packets.allocBatch(mempool, bufs, BATCH_SIZE);
    for (const buf of bufs) {
      // bufs[i].mem64[0] = seq_num++;
      // this has a huge performance impact,
      // but if we want pkt size to not be limited to % 8, we need it
      buf.mem.setBigUint64(buf.size - 8, seq_num++, littleEndian);
    }
    // the packets could be modified here to generate multiple flows
    dev.ixy.tx_batch_busy_wait(0, bufs, BATCH_SIZE);

    // don't check time for every packet
    if ((counter++ & 0xFFF) === 0) {
      const time = stats.convert(process.hrtime());
      if (time - last_stats_printed > 1000 * 1000 * 1000) {
        // every second
        dev.ixy.read_stats(dev, stat);
        stats.print(stat, stat_old, time - last_stats_printed);
        stats.copy(stat_old, stat);
        last_stats_printed = time;
      }
    }
  }
  /**/
  // non blocking test
  // TX 1000!
  // tx loop
  // TODO look at process.nextTick() for async
  // every second
  /*
  let old_seq_num = -1;
  setInterval(() => {
    const time = stats.convert(process.hrtime());
    dev.ixy.read_stats(dev, stats);
    stats.print(stats, stats_old, time - last_stats_printed);
    stats.copy(stats_old, stats);
    last_stats_printed = time;
  }, 1000);
  function sendstuff() {
    // we cannot immediately recycle packets, we need to allocate new packets every time
    // the old packets might still be used by the NIC: tx is async
    packets.allocBatch(mempool, bufs, BATCH_SIZE);
    for (const buf of bufs) {
      buf.mem.setBigUint64(buf.size - 8, seq_num++, littleEndian);
      // TODO theres errors are not thrown
      if (old_seq_num > seq_num) {
        throw new Error(`We sent packages ordered wrong: seq_num ${seq_num}; old: ${old_seq_num}`);
      } else if (old_seq_num === seq_num) {
        throw new Error(`We sent multiple packages with the smae seq_num: ${seq_num}`);
      }
      old_seq_num = seq_num;
    }
    // the packets could be modified here to generate multiple flows
    dev.ixy.tx_batch_busy_wait( 0, bufs, BATCH_SIZE);
    // TODO check if this can be done async as well!

    setImmediate(sendstuff);
  }

  sendstuff();
  /* */
}

function forward(rx_dev, rx_queue, tx_dev, tx_queue) {
  const bufs = new Array(BATCH_SIZE);
  const num_rx = rx_dev.ixy.rx_batch(rx_dev, rx_queue, bufs, BATCH_SIZE);
  if (num_rx > 0) {
    // touch all packets, otherwise it's a completely unrealistic workload
    // if the packet just stays in L3
    for (let i = 0; i < num_rx; i++) {
      bufs[i].mem8[6] += 1;
    }
    const num_tx = tx_dev.ixy.tx_batch(tx_dev, tx_queue, bufs, num_rx);
    // there are two ways to handle the case that packets are not being sent out:
    // either wait on tx or drop them; in this case it's better to drop them,
    // otherwise we accumulate latency
    for (const buf of bufs.slice(num_tx, num_rx)) {
      packets.free(buf);
    }
  }
}

function forwardProgram(pciAddr1, pciAddr2, batchSize) {
  if (!(pciAddr1 && pciAddr2)) {
    throw new Error('no pci adresses supplied. please use: ixy.js forward xxxx:xx:xx.x xxxx:xx:xx.x optionalBatchSize');
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
      dev1.ixy.read_stats(dev1, stats1);
      stats.print(stats1, stats1_old, stats.convert(time));
      stats.copy(stats1_old, stats1);
      if (dev1.ixy.pci_addr !== dev2.ixy.pci_addr) {
        dev2.ixy.read_stats(dev2, stats2);
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


module.exports = { generate: packet_generator_program, forward: forwardProgram };

// this makes our code callable via the commandline
require('make-runnable');
