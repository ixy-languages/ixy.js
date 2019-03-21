const addon = require('./build/Release/exported_module');
const jstruct = require("js-struct");

// check if little or big endian
const littleEndian = (function () {
	var buffer = new ArrayBuffer(2);
	new DataView(buffer).setInt16(0, 256, true /* littleEndian */);
	// Int16Array benutzt die Plattform Byte-Reihenfolge.
	return new Int16Array(buffer)[0] === 256;
})();
console.log(`little endian?: ${littleEndian}`);

// testing the random function that uses c 
/*
const value = 99558;
console.log(`Input :${value}\nOutput:${addon.my_function(value)}`); // expected to add 200
let numEntries = 2, entrySize = 2048;
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
entrySize = 1024;
myArrayBuffer = addon.mempoolTest(numEntries, entrySize);
myTypedArray = new Uint8Array(myArrayBuffer);
// let's see how big this buffer is, shall we?
console.log(`My Array buffer parameters:
    Num Entries: ${numEntries}
    Entry Size: ${entrySize}
Returned buffer byte length is: ${myArrayBuffer.byteLength}
Created typed array byte length is: ${myTypedArray.byteLength}`);
*/

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
/*
const jsMempool = jstruct.Struct([
	jstruct.Type.byte('base_addr'),
	jstruct.Type.uint32('buf_size'),
	jstruct.Type.uint32('num_entries'),
	jstruct.Type.uint32('free_stack_top'),
	jstruct.Type.array(jstruct.Type.uint32, numEntries)('free_stack'),
]);
console.log("Now this should be the struct:");
console.log(jsMempool.read(myTypedArray, 0));
console.log(`length of my typed array: ${myTypedArray.length}`);
console.log('this is the struct read from the buffer without typed:');
console.log(jsMempool.read(myArrayBuffer, 0));
console.log(`length of my typed array: ${myArrayBuffer.length}`);


console.log('starting array test with input 5');
const myArrayTestBuffer = addon.arrayTest(5);
let myTypedArrayTest = new Uint32Array(myArrayTestBuffer);
console.log('this is the array we got: ');
console.log(myTypedArrayTest);

*/
// testing if struct actually works the way i think it does
/*
const Book = jstruct.Struct([
	jstruct.Type.array(jstruct.Type.char, 50)('title'),
	jstruct.Type.array(jstruct.Type.char, 50)('author'),
	jstruct.Type.uint32('id')
	/*
	char title[50];
  char author[50];
  int book_id;
  */
/*
]);
*/
// let book = new Uint8Array(Book.size);

/* disable book stuff
let book = new ArrayBuffer(Book.size);
const bookobj = Book.read(book, 0);
console.log('book 1 author: ' + bookobj.author);
console.log('------- c code start -------');
let book2 = addon.changeAuthor('this guy', book);
console.log('------- c code end -------');
const bookobj2 = Book.read(book2, 0);
console.log('book 1 author: ' + bookobj.author);
console.log('book2 author: ' + bookobj2.author);
*/


let str = "newStr";
let oldStr = new ArrayBuffer(8);
let dv = new DataView(oldStr, 0);
console.log(`str input: ${str}`);
for (let i = 0; i < 8; i = i + 2) {
	dv.setInt16(i, (i + 1), littleEndian); // we need to use little endian!
	console.log(`index ${i} of our arraybuffer: ${dv.getInt16(i, littleEndian)}`);
	//console.log(`oldStr (arraybuffer) as int at inde ${i} : ${jstruct.Type.int16.read(oldStr, i)}`);
}
console.log('------- c code start -------');
let newStr = addon.writeString(str, oldStr);
console.log('------- c code end -------');
console.log(`oldStr (arraybuffer) : ${jstruct.Type.char.read(oldStr)}`);
console.log(`this should be the original string stuff as well\nnewStr (arraybuffer) : ${jstruct.Type.char.read(newStr)}`);
let dv2 = new DataView(newStr, 0);
for (let i = 0; i < 8; i = i + 2) {
	console.log(`index ${i} of our arraybuffer: ${dv.getInt16(i, littleEndian)}`);
	console.log(`index ${i} of our ret arraybuffer: ${dv2.getInt16(i, littleEndian)}`); //returned is obviously the same

	//console.log(`oldStr (arraybuffer) as int : ${jstruct.Type.int16.read(oldStr, i)}`);
	//console.log(`newStr (arraybuffer) as int : ${jstruct.Type.int16.read(newStr, i)}`);
}
/* test if were accessing the same data
dv.setInt16(2, 100, littleEndian);
console.log(`byte 2 of our arraybuffer: ${dv.getInt16(2, littleEndian)}`);
console.log(`byte 2 of our ret arraybuffer: ${dv2.getInt16(2, littleEndian)}`); //returned is obviously the same
*/



// todo

// endof testing struct stuff
/* temporarily deactivate this
// trying ixy_Device stuff
const klaipedaPci = "0000:02:00.0", narvaPci = "0000:03:00.0";
let myIxyDevice = addon.createIxyDevice(klaipedaPci, 1, 1);
myTypedArray = new Uint16Array(myIxyDevice);
*/
// original struct:
/*
struct ixy_device
{
	const char *pci_addr;
	const char *driver_name;
	uint16_t num_rx_queues;
	uint16_t num_tx_queues;
	uint32_t (*rx_batch)(struct ixy_device *dev, uint16_t queue_id, struct pkt_buf *bufs[], uint32_t num_bufs);
	uint32_t (*tx_batch)(struct ixy_device *dev, uint16_t queue_id, struct pkt_buf *bufs[], uint32_t num_bufs);
	void (*read_stats)(struct ixy_device *dev, struct device_stats *stats);
	void (*set_promisc)(struct ixy_device *dev, bool enabled);
	uint32_t (*get_link_speed)(const struct ixy_device *dev);
};
*/
/*
const jsIxyDevice = jstruct.Struct(
    //TODO
);*/
/* since struct is not yet defined we do not try using it yet:
console.log("Now this should be the ixy device struct:");
console.log(klaipedaPci.read(myTypedArray, 0));
*/
