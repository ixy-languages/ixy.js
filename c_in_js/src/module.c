// include to build into node
#include <node_api.h>

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

#define check_err(expr, op) ({\
	int64_t result = (int64_t) (expr);\
	if ((int64_t) result == -1LL) {\
		int err = errno;\
		char buf[512];\
		strerror_r(err, buf, sizeof(buf));\
		fprintf(stderr, "[ERROR] %s:%d %s(): Failed to %s: %s\n", __FILE__, __LINE__, __func__, op, buf);\
		exit(err);\
	}\
	result;\
})

#ifndef NDEBUG
#define debug(fmt, ...) do {\
	fprintf(stderr, "[DEBUG] %s:%d %s(): " fmt "\n", __FILE__, __LINE__, __func__, ##__VA_ARGS__);\
} while(0)
#else
#define debug(fmt, ...) do {} while(0)
#undef assert
#define assert(expr) (void) (expr)
#endif

int pci_open_resource(const char *pci_addr, const char *resource)
{
  char path[PATH_MAX];
  snprintf(path, PATH_MAX, "/sys/bus/pci/devices/%s/%s", pci_addr, resource);
  debug("Opening PCI resource at %s", path);
  int fd = check_err(open(path, O_RDWR), "open pci resource");
  return fd;
}
//endof magic memory

struct dma_memory
{
  void *virt;
  uintptr_t phy;
};

// translate a virtual address to a physical one via /proc/self/pagemap
static uintptr_t virt_to_phys(void *virt)
{
  long pagesize = sysconf(_SC_PAGESIZE);
  int fd = check_err(open("/proc/self/pagemap", O_RDONLY), "getting pagemap");
  // pagemap is an array of pointers for each normal-sized page
  check_err(lseek(fd, (uintptr_t)virt / pagesize * sizeof(uintptr_t), SEEK_SET), "getting pagemap");
  uintptr_t phy = 0;
  check_err(read(fd, &phy, sizeof(phy)), "translating address");
  close(fd);
  if (!phy)
  {
    error("failed to translate virtual address %p to physical address", virt);
  }
  // bits 0-54 are the page number
  return (phy & 0x7fffffffffffffULL) * pagesize + ((uintptr_t)virt) % pagesize;
}

static uint32_t huge_pg_id;
#define HUGE_PAGE_BITS 21
#define HUGE_PAGE_SIZE (1 << HUGE_PAGE_BITS)

// allocate memory suitable for DMA access in huge pages
// this requires hugetlbfs to be mounted at /mnt/huge
// not using anonymous hugepages because hugetlbfs can give us multiple pages with contiguous virtual addresses
// allocating anonymous pages would require manual remapping which is more annoying than handling files
struct dma_memory memory_allocate_dma(size_t size, bool require_contiguous)
{
  // round up to multiples of 2 MB if necessary, this is the wasteful part
  // this could be fixed by co-locating allocations on the same page until a request would be too large
  // when fixing this: make sure to align on 128 byte boundaries (82599 dma requirement)
  if (size % HUGE_PAGE_SIZE)
  {
    size = ((size >> HUGE_PAGE_BITS) + 1) << HUGE_PAGE_BITS;
  }
  if (require_contiguous && size > HUGE_PAGE_SIZE)
  {
    // this is the place to implement larger contiguous physical mappings if that's ever needed
    error("could not map physically contiguous memory");
  }
  // unique filename, C11 stdatomic.h requires a too recent gcc, we want to support gcc 4.8
  uint32_t id = __sync_fetch_and_add(&huge_pg_id, 1);
  char path[PATH_MAX];
  snprintf(path, PATH_MAX, "/mnt/huge/ixy-%d-%d", getpid(), id);
  // temporary file, will be deleted to prevent leaks of persistent pages
  int fd = check_err(open(path, O_CREAT | O_RDWR, S_IRWXU), "open hugetlbfs file, check that /mnt/huge is mounted");
  check_err(ftruncate(fd, (off_t)size), "allocate huge page memory, check hugetlbfs configuration");
  void *virt_addr = (void *)check_err(mmap(NULL, size, PROT_READ | PROT_WRITE, MAP_SHARED | MAP_HUGETLB, fd, 0), "mmap hugepage");
  // never swap out DMA memory
  check_err(mlock(virt_addr, size), "disable swap for DMA memory");
  // don't keep it around in the hugetlbfs
  close(fd);
  unlink(path);
  return (struct dma_memory){
      .virt = virt_addr,
      .phy = virt_to_phys(virt_addr)};
}

// if we can export virt and phys here, we don't need virtToPhys
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
  uintptr_t physPointer = virt_to_phys(virt); // TODO double check, but apparently offset is already added!
  napi_value ret;
  stat = napi_create_bigint_uint64(env, physPointer, &ret);
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
  }                                                                   // add virtToPhys to the export
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