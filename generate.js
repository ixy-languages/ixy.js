const IxgbeDevice = require('./src/ixgbeDevice');
const packets = require('./src/packets');
const memPool = require('./src/mempool');
const stats = require('./src/stats');


let BATCH_SIZE = 32;

// check if little or big endian
const littleEndian = (function lE() {
  const buffer = new ArrayBuffer(2);
  new DataView(buffer).setInt16(0, 256, true /* littleEndian */);
  // Int16Array uses the correct byte-order for the platform.
  return new Int16Array(buffer)[0] === 256;
}());
function packet_generator_program(pciAddr, batchSize, trackPerformance = false) {
  if (!pciAddr) {
    throw new Error('no pci adress supplied. please use: node ixy.js generate xxxx:xx:xx.x optionalBatchSize optionalTrackPerformance');
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
  let seq_num = 0n;
  // BigInt(0)/* 0n */; // rewrite to 1n syntax before running, but keep at BigInt(1) syntax because otherwise eslint will not work
  let counter = 0;
  // tx loop
  while (true) {
    // we cannot immediately recycle packets, we need to allocate new packets every time
    // the old packets might still be used by the NIC: tx is async
    packets.allocBatch(mempool, bufs);
    for (const buf of bufs) {
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
        dev.ixy.read_stats(stat);
        stats.print(stat, stat_old, time - last_stats_printed, trackPerformance);
        stats.copy(stat_old, stat);
        last_stats_printed = time;
      }
    }
  }
}


module.exports = packet_generator_program;
