const addon = require('./build/Release/exported_module');
// const jstruct = require('js-struct');

// check if little or big endian
const littleEndian = (function lE() {
  const buffer = new ArrayBuffer(2);
  new DataView(buffer).setInt16(0, 256, true /* littleEndian */);
  // Int16Array benutzt die Plattform Byte-Reihenfolge.
  return new Int16Array(buffer)[0] === 256;
})();
console.log(`little endian?: ${littleEndian}`);
// rapla: '0000:05:01.0'
// narva: '0000:03:00.0'
const pciAddr = '0000:05:01.0';
const pciAddr2 = '0000:01:00.0';
if (pciAddr === '0000:03:00.0') {
  console.log(
    `pci addr input: ${pciAddr}, size: ${Buffer.byteLength(pciAddr, 'utf8')}`
  );
  console.log('------- c code start -------');
  const data = addon.getIDs(pciAddr, false);
  const dataRaw = addon.getIDs(pciAddr, true);
  console.log('------- c code end -------');
  const dataview = new DataView(data, 0);
  const dv2 = new DataView(dataRaw, 0);
  console.log('read in C:');
  console.log(
    `vendor id (first two bytes) of our arraybuffer: ${dataview.getUint16(
      0,
      littleEndian
    )}`
  );
  console.log(
    `device id (second two bytes) of our arraybuffer: ${dataview.getUint16(
      2,
      littleEndian
    )}`
  );
  console.log('read in JS:');
  console.log(
    `vendor id (first two bytes) of our arraybuffer: ${dv2.getUint16(
      0,
      littleEndian
    )}`
  );
  console.log(
    `device id (second two bytes) of our arraybuffer: ${dv2.getUint16(
      2,
      littleEndian
    )}`
  );
  // now for pciAddr2:
  console.log(
    `pci addr input: ${pciAddr2}, size: ${Buffer.byteLength(pciAddr2, 'utf8')}`
  );
  console.log('------- c code start -------');
  const data2 = addon.getIDs(pciAddr2, false);
  const dataRaw2 = addon.getIDs(pciAddr2, true);
  console.log('------- c code end -------');
  const dataview2 = new DataView(data2, 0);
  const dv22 = new DataView(dataRaw2, 0);
  console.log('read in C:');
  console.log(
    `vendor id (first two bytes) of our arraybuffer: ${dataview2.getUint16(
      0,
      littleEndian
    )}`
  );
  console.log(
    `device id (second two bytes) of our arraybuffer: ${dataview2.getUint16(
      2,
      littleEndian
    )}`
  );
  console.log('read in JS:');
  console.log(
    `vendor id (first two bytes) of our arraybuffer: ${dv22.getUint16(
      0,
      littleEndian
    )}`
  );
  console.log(
    `device id (second two bytes) of our arraybuffer: ${dv22.getUint16(
      2,
      littleEndian
    )}`
  );
}
// here well test if we can set the register we get via getReg
console.log('------- c code start -------');
const reg = addon.getReg(pciAddr);
console.log('------- c code end -------');
const dv = new DataView(reg, 0);
console.log(
  `first two bytes of our reg: ${dv.getUint16(
    0,
    littleEndian
  )}`
);
console.log(
  `next two bytes of our reg: ${dv.getUint16(
    1,
    littleEndian
  )}`
);


// teporarily deactivate
/*
let str = "newStr";
let oldStr = new ArrayBuffer(8);
let dv = new DataView(oldStr, 0);
console.log(`str input: ${str}`);
for (let i = 0; i < 8; i = i + 2) {
	dv.setInt16(i, (i + 1), littleEndian); // we need to use little endian!
	console.log(`index ${i} of our arraybuffer: ${dv.getInt16(i, littleEndian)}`);
	//console.log(`oldStr (arraybuffer) as int at index ${i} : ${jstruct.Type.int16.read(oldStr, i)}`);
}
console.log('------- c code start -------');
let newStr = addon.writeString(str, oldStr);
console.log('------- c code end -------');
console.log(`oldStr (arraybuffer) : ${jstruct.Type.char.read(oldStr)}`);
console.log(`this should be the original string stuff as well\nnewStr (arraybuffer) : ${jstruct.Type.char.read(newStr)}`);
let dv2 = new DataView(newStr, 0);
for (let i = 0; i < 8; i = i + 2) {
	console.log(`index ${i} of our arraybuffer: ${dv.getUint16(i, littleEndian)}`);
	console.log(`index ${i} of our ret arraybuffer: ${dv2.getUint16(i, littleEndian)}`); //returned is obviously the same

	//console.log(`oldStr (arraybuffer) as int : ${jstruct.Type.int16.read(oldStr, i)}`);
	//console.log(`newStr (arraybuffer) as int : ${jstruct.Type.int16.read(newStr, i)}`);
}
*/

/* test if were accessing the same data
dv.setInt16(2, 100, littleEndian);
console.log(`byte 2 of our arraybuffer: ${dv.getInt16(2, littleEndian)}`);
console.log(`byte 2 of our ret arraybuffer: ${dv2.getInt16(2, littleEndian)}`); //returned is obviously the same
*/
