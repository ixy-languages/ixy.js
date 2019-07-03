#include <node_api.h>
#include <assert.h>
#include <errno.h>
#include <linux/limits.h>
#include <stdio.h>
#include <sys/file.h>
#include <sys/mman.h>
#include <unistd.h>

#define check_err(expr, op) ({                                                                        \
  int64_t result = (int64_t)(expr);                                                                   \
  if ((int64_t)result == -1LL)                                                                        \
  {                                                                                                   \
    int err = errno;                                                                                  \
    char buf[512];                                                                                    \
    strerror_r(err, buf, sizeof(buf));                                                                \
    fprintf(stderr, "[ERROR] %s:%d %s(): Failed to %s: %s\n", __FILE__, __LINE__, __func__, op, buf); \
    exit(err);                                                                                        \
  }                                                                                                   \
  result;                                                                                             \
})

int pci_open_resource(const char *pci_addr, const char *resource)
{
  char path[PATH_MAX];
  snprintf(path, PATH_MAX, "/sys/bus/pci/devices/%s/%s", pci_addr, resource);
  int fd = check_err(open(path, O_RDWR), "open pci resource");
  return fd;
}

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
void *memory_allocate_dma(size_t size, bool require_contiguous)
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
  return virt_addr;
}

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
  void *virtualAddress = memory_allocate_dma(size, requireContigious);
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
  uintptr_t physPointer = virt_to_phys(virt);
  napi_value ret;
  stat = napi_create_bigint_uint64(env, physPointer, &ret);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to write PhysAddr into bigint.");
  }
  return ret;
}

// TODO try to port this to js
void remove_driver(const char *pci_addr) // for now C is fine but at some point well put this into JS
{
  char path[PATH_MAX];
  snprintf(path, PATH_MAX, "/sys/bus/pci/devices/%s/driver/unbind", pci_addr);
  int fd = open(path, O_WRONLY);
  if (fd == -1)
  {
    return;
  }
  if (write(fd, pci_addr, strlen(pci_addr)) != (ssize_t)strlen(pci_addr))
  {
    warn("failed to unload driver for device %s", pci_addr);
  }
  check_err(close(fd), "close");
}
// todo js
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

  remove_driver(pci_addr);
  enable_dma(pci_addr);

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

// This part just exposes our C functions to Node
napi_value Init(napi_env env, napi_value exports)
{
  napi_status status;
  napi_value fn;
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