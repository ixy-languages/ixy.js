// include to build into node
#include <node_api.h>

//include to use original c code
#include "original_c_src/memory.c"

#include <inttypes.h>
//including just everything so that nothings missing (for C functions added/copy pasted)
#include <assert.h>
#include <errno.h>
#include <linux/limits.h>
#include <stdio.h>
#include <sys/file.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include <stdint.h>

#include "original_c_src/log.h"

int isLittleEndian()
{
  int i = 1;
  char *p = (char *)&i;

  if (p[0] == 1)
    return 1 /*LITTLE_ENDIAN*/;
  else
    return 0 /*BIG_ENDIAN*/;
}

//functions to print bits
//use like this:   SHOW(int, 1);
void print_byte_as_bits(char val)
{
  for (int i = 7; 0 <= i; i--)
  {
    printf("%c", (val & (1 << i)) ? '1' : '0');
  }
}

void print_bits(char *ty, char *val, unsigned char *bytes, size_t num_bytes)
{
  printf("(%*s) %*s = [ ", 15, ty, 16, val);
  for (size_t i = 0; i < num_bytes; i++)
  {
    print_byte_as_bits(bytes[i]);
    printf(" ");
  }
  printf("]\n");
}

#define SHOW(T, V)                                      \
  do                                                    \
  {                                                     \
    T x = V;                                            \
    print_bits(#T, #V, (unsigned char *)&x, sizeof(x)); \
  } while (0)
//endof bit stuff

int pci_open_resource(const char *pci_addr, const char *resource)
{
  char path[PATH_MAX];
  snprintf(path, PATH_MAX, "/sys/bus/pci/devices/%s/%s", pci_addr, resource);
  debug("Opening PCI resource at %s", path);
  int fd = check_err(open(path, O_RDWR), "open pci resource");
  return fd;
}
//endof magic memory

napi_value getDmaMem(napi_env env, napi_callback_info info)
{
  bool requireContigious;
  int32_t size32;
  napi_status stat;
  size_t argc = 2;
  napi_value argv[2];
  stat = napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to parse arguments");
  }
  stat = napi_get_value_int32(env, argv[0], &size32);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to get size from inputs.");
  }
  stat = napi_get_value_bool(env, argv[1], &requireContigious);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to get requireContigious from inputs.");
  }
  size_t size = (size_t)size32;
  printf("trying to allocate dma in size of %zd, contigious? %d\n", size, requireContigious);
  struct dma_memory dmaMem = memory_allocate_dma(size, requireContigious);
  void *virtualAddress = dmaMem.virt; // change this function later on, to do only whats actually needed to be done in C
  printf("Physical adress in C: 0x%012lX\n", dmaMem.phy);
  napi_value ret;
  stat = napi_create_external_arraybuffer(env, virtualAddress, size, NULL, NULL, &ret);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to return virtual Adress as Arraybuffer.");
  }
  return ret;
}
napi_value virtToPhys(napi_env env, napi_callback_info info)
{
  void *virt;
  napi_status stat;
  size_t sizeOfArray;
  size_t argc = 1;
  napi_value argv[1];
  stat = napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to parse arguments");
  }
  stat = napi_get_arraybuffer_info(env, argv[0], &virt, &sizeOfArray);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to get virtual Memory from ArrayBuffer.");
  }
  uintptr_t physPointer = virt_to_phys(virt);
  //printf("Phys addr we computed: %016" PRIxPTR "\n", physPointer);
  napi_value ret;
  //hoping physical pointers are 64bit, else we need to handle every function that needs this value in C as well
  stat = napi_create_bigint_uint64(env, physPointer, &ret);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to write PhysAddr into bigint.");
  }
  return ret;
}
napi_value dataviewToPhys(napi_env env, napi_callback_info info)
{
  void *virt;
  napi_status stat;
  size_t sizeOfArray;
  size_t argc = 1;
  size_t byteOffset;
  napi_value argv[1];
  napi_value arrayBuffer;
  stat = napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to parse arguments");
  }
  stat = napi_get_dataview_info(env,
                                argv[0],
                                &sizeOfArray,
                                &virt,
                                &arrayBuffer,
                                &byteOffset);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to get virtual Memory from Dataview.");
  }
  uintptr_t oldPhysPointer = virt_to_phys(virt);           // TODO double check, but apparently offset is already added!
  uintptr_t physPointer = virt_to_phys(virt) + byteOffset; // TODO check if we need to multiply with 8 or so to get to bytes
  //printf("Byte offset: %d\nOriginal phys addr: %016" PRIxPTR "\n-----New Phys Addr: %016" PRIxPTR "\n", byteOffset, oldPhysPointer, physPointer);
  napi_value ret;
  //hoping physical pointers are 64bit, else we need to handle every function that needs this value in C as well
  stat = napi_create_bigint_uint64(env, oldPhysPointer, &ret);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to write PhysAddr into bigint.");
  }
  return ret;
}
napi_value shortenPhys(napi_env env, napi_callback_info info)
{
  uint64_t phys;
  napi_status stat;
  bool lossless;
  size_t argc = 1;
  napi_value argv[1];
  stat = napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to parse arguments");
  }
  stat = napi_get_value_bigint_uint64(env, argv[0], &phys, &lossless);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to get virtual Memory from ArrayBuffer.");
  }
  uint32_t shortPhys = (uint32_t)(phys & 0xFFFFFFFFull);
  printf("Original phys addr: %016" PRIxPTR "\n-----New Phys Addr: %016" PRIxPTR "\n", phys, shortPhys);
  napi_value ret;
  //hoping physical pointers are 64bit, else we need to handle every function that needs this value in C as well
  stat = napi_create_uint32(env, shortPhys, &ret);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to get virtual Memory from ArrayBuffer.");
  }
  return ret;
}
napi_value shortenPhysLatter(napi_env env, napi_callback_info info)
{
  uint64_t phys;
  napi_status stat;
  bool lossless;
  size_t argc = 1;
  napi_value argv[1];
  stat = napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to parse arguments");
  }
  stat = napi_get_value_bigint_uint64(env, argv[0], &phys, &lossless);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to get virtual Memory from ArrayBuffer.");
  }
  uint32_t shortPhys = (uint32_t)(phys >> 32);
  printf("Original phys addr: %016" PRIxPTR "\n-----New Phys Addr: %016" PRIxPTR "\n", phys, shortPhys);
  printf("original phys addr as decimal: %" PRIu64 "\n", phys);
  napi_value ret;
  //hoping physical pointers are 64bit, else we need to handle every function that needs this value in C as well
  stat = napi_create_uint32(env, shortPhys, &ret);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to get virtual Memory from ArrayBuffer.");
  }
  return ret;
}

napi_value addBigInts(napi_env env, napi_callback_info info)
{
  // printf("-------------------offsetof(struct pkt_buf, data): %d\n",offsetof(struct pkt_buf, data)); it is 64!
  uint64_t num1;
  uint32_t num2asInt;
  napi_status stat;
  bool lossless;
  size_t argc = 2;
  napi_value argv[2];
  stat = napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to parse arguments");
  }
  stat = napi_get_value_bigint_uint64(env, argv[0], &num1, &lossless);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to get bigint.");
  }
  stat = napi_get_value_uint32(env, argv[1], &num2asInt);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to get number.");
  }
  uint64_t num2 = (uint64_t)num2asInt;
  uint64_t addedBigints = num1 + num2;
  napi_value ret;
  //hoping physical pointers are 64bit, else we need to handle every function that needs this value in C as well
  stat = napi_create_bigint_uint64(env, addedBigints, &ret);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to return sum of bigint and number.");
  }
  return ret;
}
// start receiving things

// this is stuff we need for the function create_rx_queue to work
const int MAX_RX_QUEUE_ENTRIES = 4096;
// stuff to make it compile without dpdk and ixgbe_osdep.h
#include <stdbool.h>
typedef uint8_t u8;
typedef int8_t s8;
typedef uint16_t u16;
typedef int16_t s16;
typedef uint32_t u32;
typedef int32_t s32;
typedef uint64_t u64;
typedef int64_t s64;
/* Little Endian defines */
#ifndef __le16
#define __le16 u16
#endif
#ifndef __le32
#define __le32 u32
#endif
#ifndef __le64
#define __le64 u64

#endif
#ifndef __be16
/* Big Endian defines */
#define __be16 u16
#define __be32 u32
#define __be64 u64
#endif

/* Receive Descriptor - Advanced */
union ixgbe_adv_rx_desc {
  struct
  {
    __le64 pkt_addr; /* Packet buffer address */
    __le64 hdr_addr; /* Header buffer address */
  } read;
  struct
  {
    struct
    {
      union {
        __le32 data;
        struct
        {
          __le16 pkt_info; /* RSS, Pkt type */
          __le16 hdr_info; /* Splithdr, hdrlen */
        } hs_rss;
      } lo_dword;
      union {
        __le32 rss; /* RSS Hash */
        struct
        {
          __le16 ip_id; /* IP id */
          __le16 csum;  /* Packet Checksum */
        } csum_ip;
      } hi_dword;
    } lower;
    struct
    {
      __le32 status_error; /* ext status/error */
      __le16 length;       /* Packet length */
      __le16 vlan;         /* VLAN tag */
    } upper;
  } wb; /* writeback */
};

// this will be changed to JS as well
// allocated for each rx queue, keeps state for the receive function
struct ixgbe_rx_queue // 24 byte big
{
  volatile union ixgbe_adv_rx_desc *descriptors;
  struct mempool *mempool;
  uint16_t num_entries;
  // position we are reading from
  uint16_t rx_index;
  // virtual addresses to map descriptors back to their mbuf for freeing
  void *virtual_addresses[];
};

napi_value create_rx_queue(napi_env env, napi_callback_info info)
{
  // were doing this whole thing in JS with ixgbe_device.rx_queues = []; but were missing the mempool
  uint16_t num_of_rx_queues = 1; //default to 1, make this changeable later
  // this should be done in JS as soon as we know what exactly of the struct needs to be done in C:
  void *rx_queues = calloc(num_of_rx_queues, sizeof(struct ixgbe_rx_queue) + sizeof(void *) * MAX_RX_QUEUE_ENTRIES);
  // return our buffer
}

// what we want to implement to use in JS:
void setReg32(const uint8_t *addr, int32_t reg, uint32_t value)
{
  __asm__ volatile(""
                   :
                   :
                   : "memory");
  *((volatile uint32_t *)(addr + reg)) = value;
}
void waitSetReg32(const uint8_t *addr, int32_t reg, uint32_t mask)
{ // maybe we can make this better with async in JS, but probably not
  __asm__ volatile(""
                   :
                   :
                   : "memory");
  uint32_t cur = 0;
  while (cur = *((volatile uint32_t *)(addr + reg)), (cur & mask) != mask)
  {
    debug("waiting for flags 0x%08X in register 0x%05X, current value 0x%08X", mask, reg, cur);
    usleep(10000);
    __asm__ volatile(""
                     :
                     :
                     : "memory");
  }
}
void waitClearReg32(const uint8_t *addr, int reg, uint32_t mask)
{
  __asm__ volatile(""
                   :
                   :
                   : "memory");
  uint32_t cur = 0;
  while (cur = *((volatile uint32_t *)(addr + reg)), (cur & mask) != 0)
  {
    debug("waiting for flags 0x%08X in register 0x%05X to clear, current value 0x%08X", mask, reg, cur);
    usleep(10000);
    __asm__ volatile(""
                     :
                     :
                     : "memory");
  }
}
uint32_t getReg32(const uint8_t *addr, int reg)
{
  __asm__ volatile(""
                   :
                   :
                   : "memory");
  return *((volatile uint32_t *)(addr + reg));
}

/**
 * This makes the get_reg32 function available for JS
 * */
napi_value get_reg_js(napi_env env, napi_callback_info info)
{
  napi_status stat;
  size_t argc = 2;
  napi_value argv[2];

  stat = napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to parse arguments");
  }
  // get first arg: addr
  uint8_t *addr; // lets hope we dont need to actually allocate all that memory
  size_t size;
  stat = napi_get_arraybuffer_info(env, argv[0], &addr, size);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to get the arraybuffer.");
  }
  // get second arg: reg
  int reg;
  stat = napi_get_value_int32(env, argv[1], &reg);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed getting register offset.");
  }
  uint32_t gotReg = getReg32(addr, reg);

  napi_value ret;
  stat = napi_create_uint32(env, gotReg, &ret);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to create the register value.");
  }
  return ret;
}

// endof receiving packages
napi_value getIDs(napi_env env, napi_callback_info info)
{
  napi_status stat;
  napi_value returnValue;
  size_t argc = 2;
  napi_value argv[2];

  stat = napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to parse arguments");
  }
  char *pci_addr = malloc(12); // "0000:03:00.0"
  size_t size;
  stat = napi_get_value_string_utf8(env, argv[0], pci_addr, 13, &size); // for some reason we need to use length 13 not 12, to get 12 bytes
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Invalid string of length 12, the PCI adress, was passed as first argument");
  }

  //check if we want to actually give JS the raw adress or already parse (to compare the values we get)
  bool returnRawPointer;
  stat = napi_get_value_bool(env, argv[1], &returnRawPointer);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to get the 2nd argument, a boolean");
  }

  enable_dma(pci_addr); // do we need this to actually be able to write there?

  //The file handle can be found by typing lscpi -v
  //and looking for your device.
  int config = pci_open_resource(pci_addr, "config");
  // now lets create this as a buffer we give JS
  void *buf = malloc(4);
  stat = napi_create_arraybuffer(env, 4, &buf, &returnValue);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed our buffer creation");
  }
  // fill empty buffer inside of C
  if (!returnRawPointer)
  {
    pread(config, buf, 4, 0);

    return returnValue;
  }
  else
  {

    FILE *filepointer = fdopen(config, "w+"); //deactivate using pointer to file
    /*
    struct stat stat2;
    check_err(fstat(config, &stat2), "stat pci resource");
    debug("Size of the stat: %d\n", stat2.st_size);

    uint8_t *pci_map_resource_js = check_err(mmap(NULL, stat2.st_size, PROT_READ | PROT_WRITE, MAP_SHARED, config, 0), "mmap pci resource"); // we get the error Invalid Argument here
    //void *filepointer = get_reg(pci_map_resource_js, 0);
    void *filepointer = *pci_map_resource_js;
*/
    napi_value testReturnVal;
    stat = napi_create_external_arraybuffer(env, filepointer, 4, NULL, NULL, &testReturnVal);
    if (stat != napi_ok)
    {
      napi_throw_error(env, NULL, "Failed our external buffer creation");
    }
    return testReturnVal;
  }
}
#define IXGBE_EIMC 0x00888      // WO
#define IXGBE_EIAC 0x00810      // RW
#define IXGBE_EIAM 0x00890      // RW
#define IXGBE_EITR 0x00820      // RW (bits 3-11 could be interesting to test?)
#define IXGBE_EICR 0x00800      // RW1C (bits 0:15 interesting?) docs: 8.2.3.5.1
#define IXGBE_LLITHRESH 0x0EC90 // RW, 8.2.3.5.14 , 0-25:0, 26-31: 000101b
#define IXGBE_IVAR_MISC 0x00A00 // RW, 8.2.3.5.17 , 6:0 : X, 7: 0 , 14:8 : X , 15:1 , 31:16 : 0
#define IXGBE_VLNCTRL 0x05088   // RW, 8.2.3.7.2 , 15:0 0x8100 , 27:16 reserved : ?? , 30:28 : 0 (lets try to change these) , 31: reserved
#define IXGBE_LEDCTL 0x00200    // RW 8.2.3.1.6

int regUsed = IXGBE_LEDCTL;

// tmp copypastas
bool turnoffRMDr = false;
bool turnoffEBLDMA = false;
void remove_driver(const char *pci_addr) // for now C is fine but at some point well put this into JS
{
  if (!turnoffRMDr)
  {
    char path[PATH_MAX];
    snprintf(path, PATH_MAX, "/sys/bus/pci/devices/%s/driver/unbind", pci_addr);
    int fd = open(path, O_WRONLY);
    if (fd == -1)
    {
      debug("no driver loaded");
      return;
    }
    if (write(fd, pci_addr, strlen(pci_addr)) != (ssize_t)strlen(pci_addr))
    {
      warn("failed to unload driver for device %s", pci_addr);
    }
    check_err(close(fd), "close");
  }
}

void enable_dma(const char *pci_addr)
{
  if (!turnoffEBLDMA)
  {
    char path[PATH_MAX];
    snprintf(path, PATH_MAX, "/sys/bus/pci/devices/%s/config", pci_addr);
    int fd = check_err(open(path, O_RDWR), "open pci config");
    // write to the command register (offset 4) in the PCIe config space
    // bit 2 is "bus master enable", see PCIe 3.0 specification section 7.5.1.1
    assert(lseek(fd, 4, SEEK_SET) == 4);
    uint16_t dma = 0;
    assert(read(fd, &dma, 2) == 2);
    dma |= 1 << 2;
    assert(lseek(fd, 4, SEEK_SET) == 4);
    assert(write(fd, &dma, 2) == 2);
    check_err(close(fd), "close");
    printf("enabled dma...\n");
  }
}

//endof copypastas

// let's keep this for debugging purposes
napi_value printBits(napi_env env, napi_callback_info info)
{
  napi_status stat;
  size_t argc = 2;
  napi_value argv[2];

  stat = napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to parse arguments");
  }
  char *pci_addr = malloc(12); // "0000:03:00.0"
  size_t size;
  stat = napi_get_value_string_utf8(env, argv[0], pci_addr, 13, &size); // for some reason we need to use length 13 not 12, to get 12 bytes
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Invalid string of length 12, the PCI adress, was passed as first argument");
  }
  char *regi = malloc(10); // "IXGBE_EICR"
  size_t size2;
  stat = napi_get_value_string_utf8(env, argv[1], regi, 11, &size);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Invalid reg input");
  }

  remove_driver(pci_addr); // we added this to see if it works now
  enable_dma(pci_addr);    // do we need this to actually be able to write there?

  //this is what we need to get the root adress
  int fd = pci_open_resource(pci_addr, "resource0");
  debug("fd we got: %d\n", fd);
  struct stat stat2;
  check_err(fstat(fd, &stat2), "stat pci resource");
  printf("Size of the stat: %d\n", stat2.st_size);

  uint8_t *pci_map_resource_js = check_err(mmap(NULL, stat2.st_size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0), "mmap pci resource");
  uint32_t filepointer = getReg32(pci_map_resource_js, 0xB2 /*regi*/);

  printf("%d :: our resource at 0x%x\n", filepointer, 0xB2 /*regi*/);
  SHOW(uint32_t, filepointer);
  /*printf("%x", filepointer[1]);
  SHOW(uint8_t, filepointer[1]);
  uint16_t *bitFP = filepointer;
  printf("%x", bitFP[0]);
  SHOW(uint16_t, bitFP[0]);
  uint32_t *bitFP2 = filepointer;
  printf("%x", bitFP2[0]);
  SHOW(uint32_t, bitFP2[0]);

  napi_value testReturnVal;
  stat = napi_create_external_arraybuffer(env, (void *)filepointer, stat2.st_size, NULL, NULL, &testReturnVal);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed our external buffer creation");
  }
  return testReturnVal;
  */
}
// endof trying

/**
 * This will give us an ArrayBuffer in JS, which points to the Network Card installed in the PCI Address we provide
 * */
napi_value getIXYAddr(napi_env env, napi_callback_info info)
{
  napi_status stat;
  size_t argc = 1;
  napi_value argv[1];

  stat = napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to parse arguments");
  }
  char *pci_addr = malloc(12); // "0000:03:00.0"
  size_t size;
  stat = napi_get_value_string_utf8(env, argv[0], pci_addr, 13, &size); // for some reason we need to use length 13 not 12, to get 12 bytes
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Invalid string of length 12, the PCI adress, was passed as first argument");
  }

  // let's keep both of these for now
  remove_driver(pci_addr); // we added this to see if it works now
  enable_dma(pci_addr);    // do we need this to actually be able to write there?

  //this is what we need to get the root adress
  int fd = pci_open_resource(pci_addr, "resource0");
  struct stat stat2;
  check_err(fstat(fd, &stat2), "stat pci resource");

  uint8_t *pci_map_resource_js = check_err(mmap(NULL, stat2.st_size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0), "mmap pci resource");

  napi_value returnVal;
  stat = napi_create_external_arraybuffer(env, (void *)pci_map_resource_js, stat2.st_size, NULL, NULL, &returnVal);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed our external buffer creation");
  }
  return returnVal;
}
/**
 * This makes the set_reg function available for JS
 * */
napi_value set_reg_js(napi_env env, napi_callback_info info)
{
  napi_status stat;
  size_t argc = 3;
  napi_value argv[3];

  stat = napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to parse arguments");
  }
  // get first arg: addr
  uint8_t *addr; // lets hope we dont need to actually allocate all that memory
  size_t size;
  stat = napi_get_arraybuffer_info(env, argv[0], &addr, size);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to get the arraybuffer.");
  }
  // get second arg: reg
  int32_t reg;
  stat = napi_get_value_int32(env, argv[1], &reg);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed getting register offset.");
  }
  // get third arg: value
  uint32_t value;
  stat = napi_get_value_uint32(env, argv[2], &value);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed getting value.");
  }

  setReg32(addr, reg, value);
  return NULL;
}

/**
 * This makes the set_reg function available for JS
 * */
napi_value wait_set_reg_js(napi_env env, napi_callback_info info)
{
  napi_status stat;
  size_t argc = 3;
  napi_value argv[3];

  stat = napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to parse arguments");
  }
  // get first arg: addr
  uint8_t *addr; // lets hope we dont need to actually allocate all that memory
  size_t size;
  stat = napi_get_arraybuffer_info(env, argv[0], &addr, size);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to get the arraybuffer.");
  }
  // get second arg: reg
  int32_t reg;
  stat = napi_get_value_int32(env, argv[1], &reg);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed getting register offset.");
  }
  // get third arg: value
  uint32_t value;
  stat = napi_get_value_uint32(env, argv[2], &value);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed getting value.");
  }

  waitSetReg32(addr, reg, value);
  return NULL;
}

/**
 * This makes the set_reg function available for JS
 * */
napi_value wait_clear_reg_js(napi_env env, napi_callback_info info)
{
  napi_status stat;
  size_t argc = 3;
  napi_value argv[3];

  stat = napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to parse arguments");
  }
  // get first arg: addr
  uint8_t *addr; // lets hope we dont need to actually allocate all that memory
  size_t size;
  stat = napi_get_arraybuffer_info(env, argv[0], &addr, size);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to get the arraybuffer.");
  }
  // get second arg: reg
  int32_t reg;
  stat = napi_get_value_int32(env, argv[1], &reg);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed getting register offset.");
  }
  // get third arg: value
  uint32_t value;
  stat = napi_get_value_uint32(env, argv[2], &value);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed getting value.");
  }

  waitClearReg32(addr, reg, value);
  return NULL;
}

napi_value Init(napi_env env, napi_value exports)
{
  napi_status status;
  napi_value fn;

  //adding my 32 bit print function
  status = napi_create_function(env, NULL, 0, printBits, NULL, &fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to wrap native function");
  }

  status = napi_set_named_property(env, exports, "printBits", fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to populate exports");
  }
  //adding my shorten Physical Adress function
  status = napi_create_function(env, NULL, 0, shortenPhys, NULL, &fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to wrap native function");
  }

  status = napi_set_named_property(env, exports, "shortenPhys", fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to populate exports");
  }
  //adding my shorten Physical Adress function for the other part of the phys addr
  status = napi_create_function(env, NULL, 0, shortenPhysLatter, NULL, &fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to wrap native function");
  }

  status = napi_set_named_property(env, exports, "shortenPhysLatter", fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to populate exports");
  }
  //adding my add bigints function for the other part of the phys addr
  status = napi_create_function(env, NULL, 0, addBigInts, NULL, &fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to wrap native function");
  }

  status = napi_set_named_property(env, exports, "addBigInts", fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to populate exports");
  }
  // adding my getIDs to get PCI id stuff
  status = napi_create_function(env, NULL, 0, getIDs, NULL, &fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to wrap native function");
  }

  status = napi_set_named_property(env, exports, "getIDs", fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to populate exports");
  }
  // add getIXYAddr to the export
  status = napi_create_function(env, NULL, 0, getIXYAddr, NULL, &fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to wrap native function");
  }

  status = napi_set_named_property(env, exports, "getIXYAddr", fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to populate exports");
  }
  // add set_reg to the export
  status = napi_create_function(env, NULL, 0, set_reg_js, NULL, &fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to wrap native function");
  }

  status = napi_set_named_property(env, exports, "set_reg_js", fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to populate exports");
  }
  // add wait_set_reg to the export
  status = napi_create_function(env, NULL, 0, wait_set_reg_js, NULL, &fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to wrap native function");
  }

  status = napi_set_named_property(env, exports, "wait_set_reg_js", fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to populate exports");
  }
  // add wait_clear_reg to the export
  status = napi_create_function(env, NULL, 0, wait_clear_reg_js, NULL, &fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to wrap native function");
  }

  status = napi_set_named_property(env, exports, "wait_clear_reg_js", fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to populate exports");
  }
  // add get_reg to the export
  status = napi_create_function(env, NULL, 0, get_reg_js, NULL, &fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to wrap native function");
  }

  status = napi_set_named_property(env, exports, "get_reg_js", fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to populate exports");
  }
  // add getDmaMem to the export
  status = napi_create_function(env, NULL, 0, getDmaMem, NULL, &fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to wrap native function");
  }

  status = napi_set_named_property(env, exports, "getDmaMem", fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to populate exports");
  } // add virtToPhys to the export
  status = napi_create_function(env, NULL, 0, virtToPhys, NULL, &fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to wrap native function");
  }

  status = napi_set_named_property(env, exports, "virtToPhys", fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to populate exports");
  }
  // add virtToPhys to the export
  status = napi_create_function(env, NULL, 0, dataviewToPhys, NULL, &fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to wrap native function");
  }

  status = napi_set_named_property(env, exports, "dataviewToPhys", fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to populate exports");
  }
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)