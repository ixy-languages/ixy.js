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

const currentHost = 'narva'; // adjust this part before deploy on machine
const runEverything = false;
const runTestCWrapper = true;
const runTest1 = false;
const runTest2 = false;
const runTest3 = false;
let pciAddr;
let pciAddr2;
switch (currentHost) {
case 'narva':
  pciAddr = '0000:03:00.0';
  pciAddr2 = '0000:01:00.0';
  break;
case 'riga':
  pciAddr = '0000:04:00.0';
  pciAddr2 = '0000:06:00.0';
  break;
default:
  pciAddr = null;
  pciAddr2 = null;
}
console.log('some accessing data tests...');
addon.printBits(pciAddr, 'EICR');

if (runEverything || runTestCWrapper) {
  const IXYDevice = addon.getIXYAddr(pciAddr);
  const IXYView = new DataView(IXYDevice);
  console.log(`The 32bit before changing: ${IXYView.getUint32(0x200, littleEndian)}`);
  console.log('-----------cstart------------');
  addon.set_reg_js(IXYDevice, 8, 0x200, 22); // seems to work with 32 bit but not with less? (maybe little endian is fucking up our byte order here)
  console.log('-----------c--end------------');
  console.log(`The 32bit after changing: ${IXYView.getUint32(0x200, littleEndian)}`);
}

if (runEverything || runTest1) {
  console.log('\n     first test start:\n');

  console.log(
    `pci addr input: ${pciAddr}, size: ${Buffer.byteLength(pciAddr, 'utf8')}`
  );
  console.log('------- c code start -------');
  const data = addon.getIDs(pciAddr, false);
  const dataRaw = addon.getIDs(pciAddr, true);
  console.log('------- c code end -------');
  const dataview = new DataView(data, 0);
  const dv2 = new DataView(dataRaw, 0);
  console.log(`length of dataview1: ${dataview.byteLength}`);
  console.log(`length of dataview2: ${dv2.byteLength}`);

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
  // testing if changes go through
  dataview.setUint16(2, 200, littleEndian);

  console.log('we shouldve changed the values now:');
  console.log(
    `from C: vendor id (first two bytes) of our arraybuffer: ${dataview.getUint16(
      0,
      littleEndian
    )}`
  );
  console.log(
    `from JS: vendor id (first two bytes) of our arraybuffer: ${dv2.getUint16(
      0,
      littleEndian
    )}`
  );
  dv2.setUint8(2, 200, littleEndian);
  console.log('we shouldve changed the values now:');
  console.log(
    `from C: vendor id (first two bytes) of our arraybuffer: ${dataview.getUint16(
      0,
      littleEndian
    )}`
  );
  console.log(
    `from JS: vendor id (first two bytes) of our arraybuffer: ${dv2.getUint16(
      0,
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
if (runEverything || runTest2) {
  console.log('\n     second test start:\n');

  // here well test if we can set the register we get via getReg
  console.log('------- c code start -------');
  const reg = addon.getReg(pciAddr, false);
  console.log('------- c code end -------');
  const dv = new DataView(reg, 0);
  console.log(`length of dataview: ${dv.byteLength}`);
  for (let i = 0; i < 16; i++) {
    console.log(`${i} Uint8 of our reg: ${dv.getUint8(i, littleEndian)}`);
  }
  for (let i = 0; i < 16; i++) {
    dv.setUint8(i, 27, littleEndian);
  }
  console.log('changed values to 27 in JS:');
  for (let i = 0; i < 16; i++) {
    console.log(`${i} Uint8 of our reg: ${dv.getUint8(i, littleEndian)}`);
  }
  for (let i = 0; i < 16; i++) {
    dv.setUint8(i, 2 + (i * 5), littleEndian);
    const value = dv.getUint8(i, littleEndian);
    console.log(
      `changing values in loop in JS: value at ${i} should be ${2 +
      (i * 5)}: ${value}`
    );
    console.log(`${i} Uint8 of our reg: ${dv.getUint8(i, littleEndian)}`);
  }
  // loading the same memory again to see if we actually changed it there
  console.log('running the getReg from C again to check for validity');
  console.log('------- c code start -------');
  const reg2 = addon.getReg(pciAddr, true);
  console.log('------- c code end -------');
  const dv222 = new DataView(reg2, 0);
  for (let i = 0; i < 16; i++) {
    console.log(
      `${i} Uint8 of our reg: ${dv222.getUint8(i, littleEndian)}`
    );
  }
}
if (runEverything || runTest3) {
  console.log('\n     third test start:\n');

  const str = 'newStr';
  const oldStr = new ArrayBuffer(8);
  const dv4 = new DataView(oldStr, 0);
  console.log(`str input: ${str}`);
  for (let i = 0; i < 8; i += 2) {
    dv4.setInt16(i, i + 1, littleEndian); // we need to use little endian!
    console.log(
      `index ${i} of our arraybuffer: ${dv4.getUint8(i, littleEndian)}`
    );
    // console.log(`oldStr (arraybuffer) as int at index ${i} : ${jstruct.Type.int16.read(oldStr, i)}`);
  }
  console.log('------- c code start -------');
  const newStr = addon.writeString(str, oldStr);
  console.log('------- c code end -------');
  const dv6 = new DataView(newStr, 0);
  for (let i = 0; i < 8; i += 2) {
    console.log(
      `index ${i} of our arraybuffer: ${dv4.getUint8(i, littleEndian)}`
    );
    console.log(
      `index ${i} of our ret arraybuffer: ${dv6.getUint8(i, littleEndian)}`
    ); // returned is obviously the same

    // console.log(`oldStr (arraybuffer) as int : ${jstruct.Type.int16.read(oldStr, i)}`);
    // console.log(`newStr (arraybuffer) as int : ${jstruct.Type.int16.read(newStr, i)}`);
  }
  console.log('testing if we can change data via JS:');
  dv4.setUint8(2, 100, littleEndian);
  console.log(`byte 2 of our arraybuffer: ${dv4.getUint8(2, littleEndian)}`);
  console.log(
    `byte 2 of our ret arraybuffer: ${dv6.getUint8(2, littleEndian)}`
  ); // returned is obviously the same

  console.log('\narrayTest\n');
  const buf = addon.arrayTest();
  const bufDv = new DataView(buf);
  console.log(`size of the buffer: ${bufDv.byteLength}`);
  console.log(bufDv.getUint32(0, littleEndian));
  console.log(bufDv.getUint32(4, littleEndian));
  console.log('changing to 900...');
  bufDv.setUint32(0, 900, littleEndian);
  console.log(bufDv.getUint32(0, littleEndian));
  console.log(bufDv.getUint32(4, littleEndian));
  addon.readArray(buf);
}
