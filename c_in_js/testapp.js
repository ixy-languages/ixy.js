const addon = require('./build/Release/exported_module');
// testing the random function that uses c 
const value = 99558;
console.log(`Input :${value}\nOutput:${addon.my_function(value)}`); // expected to add 200
let myArrayBuffer = addon.mempoolTest();
// let's see how big this buffer is, shall we?
console.log(`My Array buffer byte length is: ${myArrayBuffer.byteLength}`);