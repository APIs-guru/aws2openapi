'use strict';

const path = require('path');

function extractServiceName(filename) {
    filename = path.basename(filename.replace('.normal.json',''));
	let components = filename.split('-');
	let prefix = components[0];
    let i = 1;
	while (!components[i].startsWith('2')) {
		prefix += '-' + components[i];
        i++;
    }
    return prefix;
}

module.exports = {
    extractServiceName: extractServiceName
};

