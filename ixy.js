const generate = require('./generate');
const forward = require('./forward');


module.exports = { generate,forward };

// this makes our code callable via the commandline
require('make-runnable');
