const defines = require('./constants');
const { RxDescriptor, TxDescriptor } = require('./descriptors');
const {
  get_reg_js, set_reg_js, clear_flags_js, set_flags_js,
} = require('./regOps');
const packets = require('./packets');

function wrap_ring(index, ring_size) {
  return (index + 1) & (ring_size - 1);
}
const TX_CLEAN_BATCH = 32;

class IXY {
  constructor(pci_addr, num_rx_queues, num_tx_queues, devInput) {
    this.dev = devInput;
    this.pci_addr = pci_addr;
    this.driver_name = 'ixy.js';
    this.num_rx_queues = num_rx_queues;
    this.num_tx_queues = num_tx_queues;
  }

  // section 1.8.2 and 7.1
  // try to receive a single packet if one is available, non-blocking
  // see datasheet section 7.1.9 for an explanation of the rx ring structure
  // tl;dr: we control the tail of the queue, the hardware the head
  rx_batch(queue_id, bufs, num_bufs) { // returns number
    const queue = this.dev.rx_queues[queue_id];
    // rx index we checked in the last run of this function
    let { rx_index } = queue;
    // index of the descriptor we checked in the last iteration of the loop
    let last_rx_index = rx_index;
    let buf_index;
    for (buf_index = 0; buf_index < num_bufs; buf_index++) {
      // rx descriptors are explained in 7.1.5
      const desc_ptr = new RxDescriptor(queue.descriptors, rx_index);
      const status = desc_ptr.upper().status_error();
      if (status & defines.IXGBE_RXDADV_STAT_DD) {
        if (!(status & defines.IXGBE_RXDADV_STAT_EOP)) {
          throw new Error('multi-segment packets are not supported - increase buffer size or decrease MTU');
        }
        // got a packet, read and copy the whole descriptor
        const buf = queue.virtual_addresses[rx_index];
        buf.size = desc_ptr.upper().length();
        // this would be the place to implement RX offloading by translating the device-specific
        // flags to an independent representation in the buf (similiar to how DPDK works)
        // need a new mbuf for the descriptor
        const new_buf = packets.alloc(queue.mempool);
        if (!new_buf) {
          // we could handle empty mempools more gracefully here, but it would be quite messy...
          // make your mempools large enough
          throw new Error('failed to allocate new mbuf for rx, you are either leaking memory or your mempool is too small');
        }
        // reset the descriptor
        desc_ptr.memView.d64[0 + desc_ptr.offset / 8] = new_buf.buf_addr_phy;
        // this resets the flags
        desc_ptr.memView.d64[1 + desc_ptr.offset / 8] = BigInt(0)/* 0n */; // TODO rewrite to 1n syntax before running, but keep at BigInt(1) syntax because otherwise eslint will not work
        queue.virtual_addresses[rx_index] = new_buf;
        bufs[buf_index] = buf;
        // want to read the next one in the next iteration,
        // but we still need the last / current to update RDT later
        last_rx_index = rx_index;
        rx_index = wrap_ring(rx_index, queue.num_entries);
      } else {
        break;
      }
    }
    if (rx_index !== last_rx_index) {
      // tell hardware that we are done
      // this is intentionally off by one, otherwise we'd set RDT=RDH
      // if we are receiving faster than packets are coming in
      // RDT=RDH means queue is full
      set_reg_js(this.dev, defines.IXGBE_RDT(queue_id), last_rx_index);
      queue.rx_index = rx_index;
    }
    this.dev.pkts_rec += buf_index;
    return buf_index;
  }


  // section 1.8.1 and 7.2
  // we control the tail, hardware the head
  // huge performance gains possible here by sending packets in batches
  // - writing to TDT for every packet is not efficient
  // returns the number of packets transmitted, will not block when the queue is full
  tx_batch(queue_id, bufs, num_bufs) {
    const queue = this.dev.tx_queues[queue_id];
    // the descriptor is explained in section 7.2.3.2.4
    // we just use a struct copy & pasted from intel, but it basically has two formats:
    // 1. the write-back format which is written by the NIC once sending it is finished
    // ^this is used in step 1
    // 2. the read format which is read by the NIC and written by us, this is used in step 2
    let { clean_index } = queue; // next descriptor to clean up
    let cur_index = queue.tx_index; // next descriptor to use for tx
    // step 1: clean up descriptors that were sent out by the hardware and return
    // them to the mempool
    // start by reading step 2 which is done first for each packet
    // cleaning up must be done in batches for performance reasons,
    // so this is unfortunately somewhat complicated
    while (true) {
      // figure out how many descriptors can be cleaned up
      // cur is always ahead of clean (invariant of our queue)
      let cleanable = cur_index - clean_index;
      if (cleanable < 0) { // handle wrap-around
        cleanable = queue.num_entries + cleanable;
      }
      if (cleanable < TX_CLEAN_BATCH) {
        break;
      }
      // calculcate the index of the last transcriptor in the clean batch
      // we can't check all descriptors for performance reasons
      let cleanup_to = clean_index + TX_CLEAN_BATCH - 1;
      if (cleanup_to >= queue.num_entries) {
        cleanup_to -= queue.num_entries;
      }
      const txd = new TxDescriptor(queue.descriptors, cleanup_to);
      const status = txd.wb().status();
      // hardware sets this flag as soon as it's sent out,
      // we can give back all bufs in the batch back to the mempool
      if (status & defines.IXGBE_ADVTXD_STAT_DD) {
        let i = clean_index;
        while (true) {
          const buf = queue.virtual_addresses[i];
          packets.free(buf);
          if (i === cleanup_to) {
            break;
          }
          i = wrap_ring(i, queue.num_entries);
        }
        // next descriptor to be cleaned up is one after the one we just cleaned
        clean_index = wrap_ring(cleanup_to, queue.num_entries);
      } else {
        // clean the whole batch or nothing; yes, this leaves some packets in
        // the queue forever if you stop transmitting, but that's not a real concern
        break;
      }
    }
    queue.clean_index = clean_index;
    // step 2: send out as many of our packets as possible
    let sent;
    for (sent = 0; sent < num_bufs; sent++) {
      const next_index = wrap_ring(cur_index, queue.num_entries);
      // we are full if the next index is the one we are trying to reclaim
      if (clean_index === next_index) {
        break;
      }
      const buf = bufs[sent];
      // remember virtual address to clean it up later
      queue.virtual_addresses[cur_index] = buf;
      queue.tx_index = wrap_ring(queue.tx_index, queue.num_entries);
      const txd = new TxDescriptor(queue.descriptors, cur_index);
      // NIC reads from here
      txd.memView.d64[0 + txd.offset / 8] = buf.buf_addr_phy;
      // always the same flags: one buffer (EOP), advanced data descriptor, CRC offload, data length
      txd.memView.d32[2 + txd.offset / 4] = (defines.IXGBE_ADVTXD_DCMD_EOP
        | defines.IXGBE_ADVTXD_DCMD_RS | defines.IXGBE_ADVTXD_DCMD_IFCS
        | defines.IXGBE_ADVTXD_DCMD_DEXT | defines.IXGBE_ADVTXD_DTYP_DATA
        | buf.size);
      // no fancy offloading stuff - only the total payload length
      // implement offloading flags here:
      // * ip checksum offloading is trivial: just set the offset
      // * tcp/udp checksum offloading is more annoying,
      // you have to precalculate the pseudo - header checksum
      txd.memView.d32[3 + txd.offset / 4] = buf.size << defines.IXGBE_ADVTXD_PAYLEN_SHIFT;
      cur_index = next_index;
    }
    // send out by advancing tail, i.e., pass control of the bufs to the nic
    // this seems like a textbook case for a release memory order,
    // but Intel's driver doesn't even use a compiler barrier here
    set_reg_js(this.dev, defines.IXGBE_TDT(queue_id), queue.tx_index);
    this.dev.pkts_sent += sent;
    return sent;
  }

  ixgbe_get_link_speed() {
    const links = get_reg_js(this.dev, defines.IXGBE_LINKS);
    if (!(links & defines.IXGBE_LINKS_UP)) {
      return 0;
    }
    switch (links & defines.IXGBE_LINKS_SPEED_82599) {
    case defines.IXGBE_LINKS_SPEED_100_82599:
      return 100;
    case defines.IXGBE_LINKS_SPEED_1G_82599:
      return 1000;
    case defines.IXGBE_LINKS_SPEED_10G_82599:
      return 10000;
    default:
      return 0;
    }
  }

  // read stat counters and accumulate in stats
  // stats may be NULL to just reset the counters
  read_stats(stats) {
    const rx_pkts = get_reg_js(this.dev, defines.IXGBE_GPRC);
    const tx_pkts = get_reg_js(this.dev, defines.IXGBE_GPTC);
    const rx_bytes = get_reg_js(this.dev, defines.IXGBE_GORCL);
    const tx_bytes = get_reg_js(this.dev, defines.IXGBE_GOTCL);
    let rx_dropped_pkts = 0;
    for (let i = 0; i < 2/* 8 */; i++) { // we can only have 64bit numbers anyways
      rx_dropped_pkts += get_reg_js(this.dev,
        defines.RXMPC(i));
    }
    if (stats) {
      stats.rx_pkts += rx_pkts;
      stats.tx_pkts += tx_pkts;
      stats.rx_bytes += rx_bytes;
      stats.tx_bytes += tx_bytes;
      stats.rx_dropped_pkts += rx_dropped_pkts;
      stats.pkts_sent += this.dev.pkts_sent;
      stats.pkts_rec += this.dev.pkts_rec;
      this.dev.pkts_rec = 0;
      this.dev.pkts_sent = 0;
    }
  }

  set_promisc(enabled) {
    if (enabled) {
      console.info('enabling promisc mode');
      set_flags_js(this.dev, defines.IXGBE_FCTRL, defines.IXGBE_FCTRL_MPE
          | defines.IXGBE_FCTRL_UPE);
    } else {
      console.info('disabling promisc mode');
      clear_flags_js(this.dev, defines.IXGBE_FCTRL, defines.IXGBE_FCTRL_MPE
          | defines.IXGBE_FCTRL_UPE);
    }
  }

  // calls ixy_tx_batch until all packets are queued with busy waiting
  tx_batch_busy_wait(queue_id, bufs, num_bufs) {
    let num_sent = 0;
    while (num_sent !== num_bufs) {
      // busy wait
      num_sent += this.tx_batch(queue_id, bufs.slice(num_sent), num_bufs - num_sent);
    }
  }
}

module.exports = { IXY };
