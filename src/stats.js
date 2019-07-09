
function diff_mpps(pkts_new, pkts_old, nanos) {
  return (pkts_new - pkts_old) / 1000000.0 / (nanos / 1000000000.0);
}

function diff_mbit(bytes_new, bytes_old, pkts_new, pkts_old, nanos) {
  // take stuff on the wire into account, i.e., the preamble, SFD and IFG (20 bytes)
  // otherwise it won't show up as 10000 mbit/s with small packets which is confusing
  return (((bytes_new - bytes_old) / 1000000.0 / (nanos / 1000000000.0)) * 8
      + diff_mpps(pkts_new, pkts_old, nanos) * 20 * 8);
}

function convertHRTimeToNano(time) {
  return time[0] * 1000000000 + time[1];
}

function print_stats_diff(stats_new, stats_old, nanos, trackAverage = false) {
  const rxMbits = diff_mbit(stats_new.rx_bytes, stats_old.rx_bytes,
    stats_new.rx_pkts, stats_old.rx_pkts, nanos);
  const rxMpps = diff_mpps(stats_new.rx_pkts, stats_old.rx_pkts, nanos);
  const recRate = (stats_new.pkts_rec - stats_old.pkts_rec)
      / (stats_new.rx_pkts - stats_old.rx_pkts);
  console.info(`[${stats_new.device ? stats_new.device.ixy.pci_addr : '???'}] RX: ${rxMbits * recRate} Mbits/s ${rxMpps * recRate} Mpps`);
  console.info(`[${stats_new.device ? stats_new.device.ixy.pci_addr : '???'}] TX: ${diff_mbit(stats_new.tx_bytes, stats_old.tx_bytes, stats_new.tx_pkts, stats_old.tx_pkts, nanos)} Mbit/s ${diff_mpps(stats_new.tx_pkts, stats_old.tx_pkts, nanos)} Mpps`);
  console.info(`[${stats_new.device ? stats_new.device.ixy.pci_addr : '???'}] RX packets : ${stats_new.pkts_rec - stats_old.pkts_rec}`);
  console.info(`[${stats_new.device ? stats_new.device.ixy.pci_addr : '???'}] TX packets : ${stats_new.pkts_sent - stats_old.pkts_sent}`);
  // console.info(`[${stats_new.device ? stats_new.device.ixy.pci_addr : '???'}] according to NIC: RX: ${rxMbits} Mbit/s ${rxMpps} Mpps`);
  // console.info(`[${stats_new.device ? stats_new.device.ixy.pci_addr : '???'}] according to NIC: RX_pkts: ${stats_new.rx_pkts - stats_old.rx_pkts} ; TX_pkts: ${stats_new.tx_pkts - stats_old.tx_pkts}`);
  // console.info(`[${stats_new.device ? stats_new.device.ixy.pci_addr : '???'}] Packages actually getting received: ${recRate * 100}% ; droprate: ${(1 - recRate) * 100}%`);
  console.info('----- ----- ----- -----');
  if (trackAverage) {
    // handle performance analysis
    if (!stats_new.startTime) {
      stats_new.startTime = process.hrtime();
    }
    const sinceStartTimeNano = convertHRTimeToNano(process.hrtime(stats_new.startTime));
    console.info(`[${stats_new.device ? stats_new.device.ixy.pci_addr : '???'}] Average one way performance: ${diff_mpps(stats_new.tx_pkts, 0, sinceStartTimeNano)} Mpps`);
  }
}

// initializes a stats and clears the stats on the device
function stats_init(stats, dev) {
  // might require device-specific initialization
  stats.rx_pkts = 0;
  stats.tx_pkts = 0;
  stats.rx_bytes = 0;
  stats.tx_bytes = 0;
  stats.rx_dropped_pkts = 0;
  stats.pkts_rec = 0;
  stats.pkts_sent = 0;
  stats.device = dev;
  if (dev) {
    // reset stats
    dev.ixy.read_stats(dev);
  }
}
function copyStats(to, from) {
  to.rx_pkts = from.rx_pkts;
  to.tx_pkts = from.tx_pkts;
  to.rx_bytes = from.rx_bytes;
  to.tx_bytes = from.tx_bytes;
  to.rx_dropped_pkts = from.rx_dropped_pkts;
  to.device = from.device;
  to.pkts_sent = from.pkts_sent;
  to.pkts_rec = from.pkts_rec;
}

module.exports = {
  print: print_stats_diff, convert: convertHRTimeToNano, init: stats_init, copy: copyStats,
};
