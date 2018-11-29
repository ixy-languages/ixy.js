const addon = require('./build/Release/exported_module');
const js = require("js-struct");
// testing the random function that uses c 
const value = 99558;
console.log(`Input :${value}\nOutput:${addon.my_function(value)}`); // expected to add 200
let numEntries = 2;
const entrySize = 2048;
let myArrayBuffer = addon.mempoolTest(numEntries, entrySize);
let myTypedArray = new Uint8Array(myArrayBuffer);
// let's see how big this buffer is, shall we?
console.log(`My Array buffer parameters:
Num Entries: ${numEntries}
Entry Size: ${entrySize}
Returned buffer byte length is: ${myArrayBuffer.byteLength}
Created typed array byte length is: ${myTypedArray.byteLength}`);
//with more entries?
 numEntries = 10;
myArrayBuffer = addon.mempoolTest(numEntries, entrySize);
myTypedArray = new Uint8Array(myArrayBuffer);
// let's see how big this buffer is, shall we?
console.log(`My Array buffer parameters:
Num Entries: ${numEntries}
Entry Size: ${entrySize}
Returned buffer byte length is: ${myArrayBuffer.byteLength}
Created typed array byte length is: ${myTypedArray.byteLength}`);

//trying to use js-struct to use the c struct correctly 
/* c struct:
struct mempool {
	void* base_addr;
	uint32_t buf_size;
	uint32_t num_entries;
	uint32_t free_stack_top;
	// the stack contains the entry id, i.e., base_addr + entry_id * buf_size is the address of the buf
	uint32_t free_stack[];
};
*/
const jsMempool = js.Struct([
    js.Type.byte('base_addr'),
    js.Type.uint32('buf_size'),
    js.Type.uint32('num_entries'),
    js.Type.uint32('free_stack_top'),
    js.Type.array(Type.uint32,numEntries)('free_stack'),
  ]);
  console.log("Now this should be the struct:");
  console.log(jsMempool.read(myTypedArray, 0));

