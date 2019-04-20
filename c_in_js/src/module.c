// include to build into node
#include <node_api.h>

//include to use original c code
#include "original_c_src/memory.c"

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
  size_t size;
  napi_status stat;
  size_t argc = 2;
  napi_value argv[2];
  stat = napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to parse arguments");
  }
  stat = napi_get_value_uint32(env, argv[0], &size);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to get size from inputs.");
  }
  stat = napi_get_value_bool(env, argv[1], &requireContigious);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to get requireContigious from inputs.");
  }
  struct dma_memory dmaMem = memory_allocate_dma(size, requireContigious);
  void *virtualAddress = dmaMem.virt; // change this function later on, to do only whats actually needed to be done in C
  printf("Physical adress in C: %d", dmaMem.phy);
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
  napi_value ret;
  //hoping physical pointers are 64bit, else we need to handle every function that needs this value in C as well
  stat = napi_create_bigint_uint64(env, physPointer, &ret);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to get virtual Memory from ArrayBuffer.");
  }
  return ret;
}
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
  }
}

//endof copypastas

void set_reg(uint8_t *addr, int32_t reg, uint32_t value)
{
  printf("We got input addr: %d, reg: %d, value: %d\n", addr, reg, value);
  // TODO find out if we need to cast "value" to the correct size as well
  __asm__ volatile(""
                   :
                   :
                   : "memory");
  *((volatile uint32_t *)(addr + reg)) = value;
}
void *get_reg(uint8_t *addr, int reg)
{
  return (addr + reg);
}

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
  //printf("should be 0x00800 : %x", getAddress(regi));
  uint8_t *filepointer = get_reg(pci_map_resource_js, regUsed);

  printf("%d :: our resource at 0x%x\n", filepointer[0], regUsed);
  printf("%x", filepointer[0]);
  SHOW(uint8_t, filepointer[0]);
  printf("%x", filepointer[1]);
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

  set_reg(addr, reg, value);

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
  } // add getDmaMem to the export
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
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)