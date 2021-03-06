// This is a collection of all the constants our driver uses

module.exports = {
  IXGBE_RXCTRL: 0x03000,
  IXGBE_RXCTRL_RXEN: 0x00000001,
  IXGBE_RXPBSIZE_128KB: 0x00020000,
  IXGBE_RXPBSIZE: i => 0x03C00 + (i * 4),
  IXGBE_HLREG0: 0x04240,
  IXGBE_HLREG0_RXCRCSTRP: 0x00000002,
  IXGBE_RDRXCTL: 0x02F00,
  IXGBE_RDRXCTL_CRCSTRIP: 0x00000002,
  IXGBE_FCTRL: 0x05080,
  IXGBE_FCTRL_BAM: 0x00000400,
  // eslint-disable-next-line no-nested-ternary
  IXGBE_SRRCTL: i => (i <= 15 ? 0x02100 + (i * 4) : (i) < 64 ? 0x01014
      + ((i) * 0x40) : 0x0D014 + (((i) - 64) * 0x40)),
  IXGBE_SRRCTL_DESCTYPE_MASK: 0x0E000000,
  IXGBE_SRRCTL_DESCTYPE_ADV_ONEBUF: 0x02000000,
  IXGBE_SRRCTL_DROP_EN: 0x10000000,
  NUM_RX_QUEUE_ENTRIES: 512,
  NUM_TX_QUEUE_ENTRIES: 512,
  IXGBE_RDBAL: i => (i < 64 ? 0x01000 + (i * 0x40) : 0x0D000 + ((i - 64) * 0x40)),
  IXGBE_RDBAH: i => (i < 64 ? 0x01004 + (i * 0x40) : 0x0D004 + ((i - 64) * 0x40)),
  IXGBE_RDLEN: i => (i < 64 ? 0x01008 + (i * 0x40) : 0x0D008 + ((i - 64) * 0x40)),
  IXGBE_RDH: i => (i < 64 ? 0x01010 + (i * 0x40) : 0x0D010 + ((i - 64) * 0x40)),
  IXGBE_RDT: i => (i < 64 ? 0x01018 + (i * 0x40) : 0x0D018 + ((i - 64) * 0x40)),
  IXGBE_CTRL_EXT: 0x00018,
  IXGBE_CTRL_EXT_NS_DIS: 0x00010000,
  // eslint-disable-next-line no-nested-ternary
  IXGBE_DCA_RXCTRL: i => (i <= 15 ? 0x02200 + (i * 4) : (i) < 64 ? 0x0100C
        + ((i) * 0x40) : 0x0D00C + (((i) - 64) * 0x40)),
  SIZE_PKT_BUF_HEADROOM: 40,
  IXGBE_RXDCTL: i => (i < 64 ? 0x01028 + (i * 0x40) : 0x0D028 + ((i - 64) * 0x40)),
  IXGBE_RXDCTL_ENABLE: 0x02000000,
  IXGBE_RXDADV_STAT_DD: 0x01,
  IXGBE_RXDADV_STAT_EOP: 0x02,
  IXGBE_GPRC: 0x04074,
  IXGBE_GPTC: 0x04080,
  IXGBE_GORCL: 0x04088,
  IXGBE_GOTCL: 0x04090,
  IXGBE_GORCH: 0x0408C,
  IXGBE_GOTCH: 0x04094,
  FCCRC: 0x05118,
  CRCERRS: 0x04000,
  ILLERRC: 0x04004,
  ERRBC: 0x04008,
  RXMPC: i => 0x03FA0 + (4 * i),
  Link_Status_Register: 0xB2,
  IXGBE_LINKS: 0x042A4,
  IXGBE_LINKS_UP: 0x40000000,
  IXGBE_LINKS_SPEED_82599: 0x30000000,
  IXGBE_LINKS_SPEED_100_82599: 0x10000000,
  IXGBE_LINKS_SPEED_1G_82599: 0x20000000,
  IXGBE_LINKS_SPEED_10G_82599: 0x30000000,
  IXGBE_AUTOC: 0x042A0,
  IXGBE_AUTOC_LMS_MASK: 0x7 << 13,
  IXGBE_AUTOC_LMS_10G_SERIAL: 0x3 << 13,
  IXGBE_AUTOC_10G_PMA_PMD_MASK: 0x00000180,
  IXGBE_AUTOC_10G_XAUI: 0x0 << 7,
  IXGBE_AUTOC_AN_RESTART: 0x00001000,
  IXGBE_EIMC: 0x00888,
  IXGBE_EEC: 0x10010,
  IXGBE_EEC_ARD: 0x00000200,
  IXGBE_CTRL: 0x00000,
  IXGBE_CTRL_RST_MASK: 0x00000008 | 0x04000000,
  IXGBE_RDRXCTL_DMAIDONE: 0x00000008,
  IXGBE_FCTRL_MPE: 0x00000100,
  IXGBE_FCTRL_UPE: 0x00000200,
  IXGBE_ADVTXD_STAT_DD: 0x00000001,
  IXGBE_HLREG0_TXCRCEN: 0x00000001,
  IXGBE_HLREG0_TXPADEN: 0x00000400,
  IXGBE_TXPBSIZE: i => 0x0CC00 + (i * 4),
  IXGBE_TXPBSIZE_40KB: 0x0000A000,
  IXGBE_DTXMXSZRQ: 0x08100,
  IXGBE_RTTDCS: 0x04900,
  IXGBE_RTTDCS_ARBDIS: 0x00000040,
  IXGBE_TDBAL: i => 0x06000 + (i * 0x40),
  IXGBE_TDBAH: i => 0x06004 + (i * 0x40),
  IXGBE_TDLEN: i => 0x06008 + (i * 0x40),
  IXGBE_TXDCTL: i => 0x06028 + (i * 0x40),
  IXGBE_DMATXCTL: 0x04A80,
  IXGBE_DMATXCTL_TE: 0x1,
  IXGBE_TDT: i => 0x06018 + (i * 0x40),
  IXGBE_ADVTXD_PAYLEN_SHIFT: 14,
  IXGBE_ADVTXD_DCMD_EOP: 0x01000000,
  IXGBE_ADVTXD_DCMD_RS: 0x08000000,
  IXGBE_ADVTXD_DCMD_IFCS: 0x02000000,
  IXGBE_ADVTXD_DCMD_DEXT: 0x20000000,
  IXGBE_ADVTXD_DTYP_DATA: 0x00300000,
  IXGBE_TDH: i => (0x06010 + ((i) * 0x40)),
  IXGBE_TXDCTL_ENABLE: 0x02000000,
};
