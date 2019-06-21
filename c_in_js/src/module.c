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

// what we want to implement to use in JS:
void setReg32(const uint8_t *addr, int32_t reg, uint32_t value)
{
  __asm__ volatile(""
                   :
                   :
                   : "memory");
  *((volatile uint32_t *)(addr + reg)) = value;
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

void remove_driver(const char *pci_addr) // for now C is fine but at some point well put this into JS
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

void enable_dma(const char *pci_addr)
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

//endof copypastas

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

// This part just exposes our C functions to Node
napi_value Init(napi_env env, napi_value exports)
{
  napi_status status;
  napi_value fn;

  // adding my getIDs to get PCI id stuff
  status = napi_create_function(env, NULL, 0, getIDs, NULL, &fn); // maybe use later?
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
  status = napi_create_function(env, NULL, 0, getIXYAddr, NULL, &fn); // USED
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
  status = napi_create_function(env, NULL, 0, set_reg_js, NULL, &fn); // USED
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to wrap native function");
  }

  status = napi_set_named_property(env, exports, "set_reg_js", fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to populate exports");
  }
  // add get_reg to the export
  status = napi_create_function(env, NULL, 0, get_reg_js, NULL, &fn); // USED
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
  status = napi_create_function(env, NULL, 0, getDmaMem, NULL, &fn); // USED
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to wrap native function");
  }

  status = napi_set_named_property(env, exports, "getDmaMem", fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to populate exports");
  } // add virtToPhys to the export
  status = napi_create_function(env, NULL, 0, virtToPhys, NULL, &fn); // USED
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
  status = napi_create_function(env, NULL, 0, dataviewToPhys, NULL, &fn); // USED
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