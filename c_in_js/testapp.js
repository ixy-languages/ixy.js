const addon = require('./build/Release/exported_module');
// testing the random function that uses c 
const value = 99558;
console.log(`Input :${value}\nOutput:${addon.my_function(value)}`); // expected to add 200
let numEntries = 2;
const entrySize = 2048;
let myArrayBuffer = addon.mempoolTest(numEntries, entrySize);
let myTypedArray = new Int8Array(myArrayBuffer);
// let's see how big this buffer is, shall we?
console.log(`My Array buffer parameters:
Num Entries: ${numEntries}
Entry Size: ${entrySize}
Returned buffer byte length is: ${myArrayBuffer.byteLength}
Created typed array byte length is: ${myTypedArray.byteLength}`);
//with more entries?
 numEntries = 1000;
myArrayBuffer = addon.mempoolTest(numEntries, entrySize);
myTypedArray = new Int8Array(myArrayBuffer);
// let's see how big this buffer is, shall we?
console.log(`My Array buffer parameters:
Num Entries: ${numEntries}
Entry Size: ${entrySize}
Returned buffer byte length is: ${myArrayBuffer.byteLength}
Created typed array byte length is: ${myTypedArray.byteLength}`);
