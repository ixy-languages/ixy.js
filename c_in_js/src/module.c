#include <node_api.h>
#include "memory.h"
#include "device.h"

int isLittleEndian()
{
  int i = 1;
  char *p = (char *)&i;

  if (p[0] == 1)
    return 1 /*LITTLE_ENDIAN*/;
  else
    return 0 /*BIG_ENDIAN*/;
}
//function to magically map memory
//including just everything so that nothings missing
#include <assert.h>
#include <errno.h>
#include <linux/limits.h>
#include <stdio.h>
#include <sys/file.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

int pci_open_resource(const char *pci_addr, const char *resource)
{
  char path[PATH_MAX];
  snprintf(path, PATH_MAX, "/sys/bus/pci/devices/%s/%s", pci_addr, resource);
  debug("Opening PCI resource at %s", path);
  int fd = check_err(open(path, O_RDWR), "open pci resource");
  return fd;
}
//endof magic memory
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
#define IXGBE_EIMC 0x00888

// tmp copypastas
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
}
//endof copypastas
// lets try to make this work in JS:
/*set_reg32(dev->addr, IXGBE_EIMC, 0x7FFFFFFF);
  defined as:
  static inline void set_reg32(uint8_t *addr, int reg, uint32_t value)
{
	__asm__ volatile(""
					 :
					 :
					 : "memory");
	*((volatile uint32_t *)(addr + reg)) = value;
}
  */
void *get_reg(uint8_t *addr, int reg)
{
  __asm__ volatile(""
                   :
                   :
                   : "memory"); // i dont think we need this but lets just keep this here before changing too much
  void *regPointer = (volatile uint32_t *)(addr + reg);
  return regPointer;
}
// endof trying
napi_value getReg(napi_env env, napi_callback_info info)
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

  remove_driver(pci_addr); // we added this to see if it works now
  //enable_dma(pci_addr);    // do we need this to actually be able to write there?

  //this is what we need to get the root adress
  int fd = pci_open_resource(pci_addr, "resource0");
  struct stat stat2;
  check_err(fstat(fd, &stat2), "stat pci resource");
  printf("Size of the stat: %d\n", stat2.st_size);

  //this needs to be fixed:
  uint8_t *pci_map_resource_js = check_err(mmap(NULL, stat2.st_size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0), "mmap pci resource"); // we get the error Invalid Argument here

  // ab hier ist alles noch nicht ganz fertig, aber ich will erstmal mmap fixen
  //void *filepointer = get_reg(pci_map_resource_js, IXGBE_EIMC);
  void *filepointer = pci_map_resource_js;
  napi_value testReturnVal;
  stat = napi_create_external_arraybuffer(env, filepointer, stat2.st_size /*pretty sure this wont work*/ /* sizeof(filepointer)*/, NULL, NULL, &testReturnVal);
  if (stat != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed our external buffer creation");
  }
  return testReturnVal;
}
// Try writing a string into the buf (WORKS finally!)
napi_value writeString(napi_env env, napi_callback_info info)
{

  printf("c says is this little endian?: %d\n", isLittleEndian());
  napi_status status;
  napi_value returnVal;

  size_t argc = 2;
  napi_value argv[2];

  status = napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed to parse arguments");
  }
  char inputString[8];
  status = napi_get_value_string_utf8(env, argv[0], inputString, sizeof(inputString), NULL);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Invalid string of length 10 was passed as first argument");
  }
  bool result;
  status = napi_is_arraybuffer(env, argv[1], &result);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Failed checking if input is arraybuffer");
  }
  printf("The inputted data is an arraybuffer?: %d\n", result);
  //char string[10];
  int16_t *inputArrayBuffer[4];
  size_t lengthOfString;
  status = napi_get_arraybuffer_info(env,
                                     argv[1],
                                     (void **)inputArrayBuffer,
                                     &lengthOfString);
  // napi_get_value_string_utf8(env, argv[1], string, 10, NULL);

  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Invalid arraybuffer was passed as second argument");
  }
  printf("The inputted arraybuffer as string: %s\n", argv[1]);
  printf("The inputted arraybuffers data as string: %s\n", inputArrayBuffer);

  printf("length of arraybuffer: %d\n", lengthOfString);
  // printf("Input string: %s\n", inputString);
  // printf("Input arraybuffer: %d\n", argv[1]);
  printf("size of a single element in arraybuffer: %d\n", sizeof(inputArrayBuffer[0][0]));
  for (int i = 0; i < lengthOfString / sizeof(inputArrayBuffer[0][0]); i++)
  {
    printf("Input arraybuffers data at index %d : %d\n", i, inputArrayBuffer[0][i]);
    inputArrayBuffer[0][i] = 30;
    printf("Change arraybuffers data at index %d : %d\n", i, inputArrayBuffer[0][i]);
  }

  return argv[1]; // this should be the original array buffer, and we changed the data lying beneath? - yes
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
  printf("the number we got: %d\n", number);

  uint32_t uints[] = {number, number * 2, number * 3, number * 4};
  // TODO find out how we would actually convert this, seems very inconvenient from what i found in napi docs. Maybe we want to handle only single values later ? would be impractical in some cases though
  // status = napi_create_uint32(env, uints, &ret);
  printf("our array: \n");
  for (int i = 0; i < sizeof(uints) / sizeof(uints[0]); i++)
  {
    printf("%d\n", uints[i]);
  }
  // trying to create an array buffer from this input
  napi_create_external_arraybuffer(env,
                                   &uints,
                                   sizeof(uints),
                                   NULL,
                                   NULL,
                                   &ret);

  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to create return value");
  }

  return ret;
}

napi_value Init(napi_env env, napi_value exports)
{
  napi_status status;
  napi_value fn;

  //adding my test string thingy
  status = napi_create_function(env, NULL, 0, writeString, NULL, &fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to wrap native function");
  }

  status = napi_set_named_property(env, exports, "writeString", fn);
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

  //adding my second test buffer thingy
  status = napi_create_function(env, NULL, 0, arrayTest, NULL, &fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to wrap native function");
  }

  status = napi_set_named_property(env, exports, "arrayTest", fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to populate exports");
  }
  //add getReg to exports
  status = napi_create_function(env, NULL, 0, getReg, NULL, &fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to wrap native function");
  }

  status = napi_set_named_property(env, exports, "getReg", fn);
  if (status != napi_ok)
  {
    napi_throw_error(env, NULL, "Unable to populate exports");
  }
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)