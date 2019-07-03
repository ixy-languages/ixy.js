class RxDescriptor {
  constructor(virtMem, index = 0) {
    this.memView = virtMem;
    this.offset = index * 16;
  }

  pkt_addr() { return this.memView.d64[0 + this.offset / 8]; }

  hdr_addr() { return this.memView.d64[1 + this.offset / 8]; }

  lower() {
    return {
      lo_dword: {
        data: () => this.memView.d32[0 + this.offset / 4],
        hs_rss: {
          pkt_info: () => this.memView.d16[0 + this.offset / 2],
          hdr_info: () => this.memView.d16[1 + this.offset / 2],
        },
      },
      hi_dword: {
        rss: () => this.memView.d32[1 + this.offset / 4],
        ip_id: () => this.memView.d16[2 + this.offset / 2],
        csum: () => this.memView.d16[3 + this.offset / 2],
      },
    };
  }

  upper() {
    return {
      status_error: () => this.memView.d32[2 + this.offset / 4],
      length: () => this.memView.d16[6 + this.offset / 2],
      vlan: () => this.memView.d16[7 + this.offset / 2],
    };
  }
}
class TxDescriptor {
  constructor(virtMem, index = 0) {
    this.memView = virtMem;
    this.offset = index * 16;
  }


  read() {
    return {
      buffer_addr: () => this.memView.d64[0 + this.offset / 8],
      cmd_type_len: () => this.memView.d32[2 + this.offset / 4],
      olinfo_status: () => this.memView.d32[3 + this.offset / 4],
    };
  }


  wb() {
    return {
      rsvd: () => this.memView.d64[0 + this.offset / 8],
      nxtseq_seed: () => this.memView.d32[2 + this.offset / 4],
      status: () => this.memView.d32[3 + this.offset / 4],
    };
  }
}

module.exports = {
  RxDescriptor, TxDescriptor,
};
