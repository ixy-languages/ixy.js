const addon = require('./build/Release/exported_module');
const value = 99558;
console.log(`Input :${value}\nOutput:${addon.my_function(value)}`);