#include <node_api.h>
#include "memory.h"
// we're going to use a whole lot of c code at first, and then work our way down
#include "device.h"

napi_value MyFunction(napi_env env, napi_callback_info info)
{
  napi_status status;
  size_t argc = 1;
  int number = 0;
  napi_value argv[1];
  status = napi_get_cb_info(env, info, &argc, argv, NULL, NULL);

  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to parse arguments");
  }

  status = napi_get_value_int32(env, argv[0], &number);

  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Invalid number was passed as argument");
  }
  napi_value myNumber;
  number = number + 200;
  status = napi_create_int32(env, number, &myNumber);

  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to create return value");
  }

  return myNumber;
}

napi_value arrayTest(napi_env env, napi_callback_info info) // we create a uint32 array based on an input, to be sure we deliver data correctly
{
  napi_status status;
  size_t argc = 1;
  int number = 0;
  napi_value argv[1];
  status = napi_get_cb_info(env, info, &argc, argv, NULL, NULL);

  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to parse arguments");
  }

  status = napi_get_value_int32(env, argv[0], &number);

  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Invalid number was passed as argument");
  }
  napi_value ret;

  uint32_t uints []= {number,number*2,number*3,number*4};
  // TODO find out how we would actually convert this, seems very inconvenient from what i found in napi docs. Maybe we want to handle only single values later ? would be impractical in some cases though
  // status = napi_create_uint32(env, uints, &ret);

  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to create return value");
  }

  return ret;
}

napi_value MempoolTest(napi_env env, napi_callback_info info)
{
  napi_status status;
  napi_value returnVal;

  size_t argc = 2;
  int num_entries = 1; // default to 1 i guess
  int entry_size = 0;  // will default inside memory.c if it stays 0
  napi_value argv[2];

  status = napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to parse arguments");
  }

  status = napi_get_value_int32(env, argv[0], &num_entries);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Invalid number was passed as first argument");
  }

  status = napi_get_value_int32(env, argv[1], &entry_size);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Invalid number was passed as second argument");
  }

  //printf("Inside module.c:\nNum entries: "+num_entries+"\n"+"Entry size: "+ entry_size);

  struct mempool *myMempool = memory_allocate_mempool(num_entries, entry_size);

  status = napi_create_arraybuffer(env, sizeof(struct mempool), (void **)&myMempool, &returnVal);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to create return value");
  }

  return returnVal;
}
/* temporarily disable this
napi_value createIxyDevice(napi_env env, napi_callback_info info)
{
  //TODO use the c code here correctly
  napi_status status;
  napi_value returnVal;

  size_t argc = 3;
  char *pci_addr;
  uint16_t rx_queues = 1; // default to 1
  uint16_t tx_queues = 1; // default to 1
  napi_value argv[3];

  status = napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to parse arguments");
  }

  status = napi_get_value_string_utf8(env, argv[0], pci_addr); //not sure if & is needed here or not /shrugs
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Invalid char was passed as first argument");
  }
  printf("this should be the pci address: %s", pci_addr);
  status = napi_get_value_uint16(env, argv[1], &rx_queues);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Invalid number was passed as second argument");
  }
  printf("this should be the rx queues count: %d", rx_queues);

  status = napi_get_value_uint16(env, argv[2], &tx_queues);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Invalid number was passed as second argument");
  }
  printf("this should be the tx queues count: %d", tx_queues);

  // creating the struct
  struct ixy_device *dev = ixy_init(pci_addr, rx_queues, tx_queues);

  status = napi_create_arraybuffer(env, sizeof(struct ixy_device), (void **)&dev, &returnVal);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to create return value");
  }

  return returnVal;
}
*/
// potential TODO rewrite these to Node API
/*
static inline uint32_t ixy_rx_batch(struct ixy_device *dev, uint16_t queue_id, struct pkt_buf *bufs[], uint32_t num_bufs)
{
  return dev->rx_batch(dev, queue_id, bufs, num_bufs);
}

static inline uint32_t ixy_tx_batch(struct ixy_device *dev, uint16_t queue_id, struct pkt_buf *bufs[], uint32_t num_bufs)
{
  return dev->tx_batch(dev, queue_id, bufs, num_bufs);
}

static inline void ixy_read_stats(struct ixy_device *dev, struct device_stats *stats)
{
  dev->read_stats(dev, stats);
}

static inline void ixy_set_promisc(struct ixy_device *dev, bool enabled)
{
  dev->set_promisc(dev, enabled);
}

static inline uint32_t get_link_speed(const struct ixy_device *dev)
{
  return dev->get_link_speed(dev);
}

// calls ixy_tx_batch until all packets are queued with busy waiting
static void ixy_tx_batch_busy_wait(struct ixy_device *dev, uint16_t queue_id, struct pkt_buf *bufs[], uint32_t num_bufs)
{
  uint32_t num_sent = 0;
  while ((num_sent += ixy_tx_batch(dev, 0, bufs + num_sent, num_bufs - num_sent)) != num_bufs)
  {
    // busy wait
  }
}

// getters/setters for PCIe memory mapped registers
static inline void set_reg32(uint8_t *addr, int reg, uint32_t value)
{
  __asm__ volatile(""
                   :
                   :
                   : "memory");
  *((volatile uint32_t *)(addr + reg)) = value;
}

static inline uint32_t get_reg32(const uint8_t *addr, int reg)
{
  __asm__ volatile(""
                   :
                   :
                   : "memory");
  return *((volatile uint32_t *)(addr + reg));
}

static inline void set_flags32(uint8_t *addr, int reg, uint32_t flags)
{
  set_reg32(addr, reg, get_reg32(addr, reg) | flags);
}

static inline void clear_flags32(uint8_t *addr, int reg, uint32_t flags)
{
  set_reg32(addr, reg, get_reg32(addr, reg) & ~flags);
}

static inline void wait_clear_reg32(const uint8_t *addr, int reg, uint32_t mask)
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

static inline void wait_set_reg32(const uint8_t *addr, int reg, uint32_t mask)
{
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

// getters/setters for pci io port resources

static inline void write_io32(int fd, uint32_t value, size_t offset)
{
  if (pwrite(fd, &value, sizeof(value), offset) != sizeof(value))
    error("pwrite io resource");
  __asm__ volatile(""
                   :
                   :
                   : "memory");
}

static inline void write_io16(int fd, uint16_t value, size_t offset)
{
  if (pwrite(fd, &value, sizeof(value), offset) != sizeof(value))
    error("pwrite io resource");
  __asm__ volatile(""
                   :
                   :
                   : "memory");
}

static inline void write_io8(int fd, uint8_t value, size_t offset)
{
  if (pwrite(fd, &value, sizeof(value), offset) != sizeof(value))
    error("pwrite io resource");
  __asm__ volatile(""
                   :
                   :
                   : "memory");
}

static inline uint32_t read_io32(int fd, size_t offset)
{
  __asm__ volatile(""
                   :
                   :
                   : "memory");
  uint32_t temp;
  if (pread(fd, &temp, sizeof(temp), offset) != sizeof(temp))
    error("pread io resource");
  return temp;
}

static inline uint16_t read_io16(int fd, size_t offset)
{
  __asm__ volatile(""
                   :
                   :
                   : "memory");
  uint16_t temp;
  if (pread(fd, &temp, sizeof(temp), offset) != sizeof(temp))
    error("pread io resource");
  return temp;
}

static inline uint8_t read_io8(int fd, size_t offset)
{
  __asm__ volatile(""
                   :
                   :
                   : "memory");
  uint8_t temp;
  if (pread(fd, &temp, sizeof(temp), offset) != sizeof(temp))
    error("pread io resource");
  return temp;
}
*/
//ENDOF node API rewrites

napi_value Init(napi_env env, napi_value exports)
{
  napi_status status;
  napi_value fn;

  status = napi_create_function(env, NULL, 0, MyFunction, NULL, &fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to wrap native function");
  }

  status = napi_set_named_property(env, exports, "my_function", fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to populate exports");
  }

  //adding my test buffer thingy
  status = napi_create_function(env, NULL, 0, MempoolTest, NULL, &fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to wrap native function");
  }

  status = napi_set_named_property(env, exports, "mempoolTest", fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to populate exports");
  }
/* temproarily deactivate
  // adding ixy device creator
  status = napi_create_function(env, NULL, 0, createIxyDevice, NULL, &fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to wrap native function");
  }

  status = napi_set_named_property(env, exports, "createIxyDevice", fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to populate exports");
  }
*/
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)