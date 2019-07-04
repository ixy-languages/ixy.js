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
function packet_generator_program(pciAddr, batchSize) {
  if (!pciAddr) {
    throw new Error('no pci adress supplied. please use: node ixy.js generate xxxx:xx:xx.x optionalBatchSize');
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
  // BigInt(0)/* 0n */; // TODO rewrite to 1n syntax before running, but keep at BigInt(1) syntax because otherwise eslint will not work
  // /*
  let counter = 0;
  // tx loop
  while (true) {
    // we cannot immediately recycle packets, we need to allocate new packets every time
    // the old packets might still be used by the NIC: tx is async
    packets.allocBatch(mempool, bufs);
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
        dev.ixy.read_stats(stat);
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
    packets.allocBatch(mempool, bufs);
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


module.exports = packet_generator_program;