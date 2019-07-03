//  synchronous wait function
function wait(ms) {
  const start = Date.now();
  let now = start;
  while (now - start < ms) {
    now = Date.now();
  }
}

function get_reg_js(dev, reg) {
  return dev.mem32[reg / 4];
}
function set_reg_js(dev, reg, val) {
  dev.mem32[reg / 4] = val;
}

function clear_flags_js(dev, reg, flags) {
  set_reg_js(dev, reg, get_reg_js(dev, reg) & ~flags);
}
function set_flags_js(dev, reg, flags) {
  set_reg_js(dev, reg, get_reg_js(dev, reg) | flags);
}

function wait_set_reg_js(dev, reg, val) {
  while ((get_reg_js(dev, reg) & val) !== val) {
    set_reg_js(dev, reg, val);
    wait(100);
  }
}

function wait_clear_reg_js(dev, reg, val) {
  while ((get_reg_js(dev, reg) & val) !== 0) {
    clear_flags_js(dev, reg, val);
    wait(100);
  }
}

module.exports = {
  get_reg_js, set_reg_js, clear_flags_js, set_flags_js, wait_set_reg_js, wait_clear_reg_js, wait,
};
