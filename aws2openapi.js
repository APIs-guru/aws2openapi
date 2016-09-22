'use strict';

var fs = require('fs');
var path = require('path');
var SwaggerParser = require('swagger-parser');
var validator = require('is-my-json-valid');
var aws2oa = require('./index.js');

var swaggerSchema = require('./validation/swagger2Schema.json');

var input = (process.argv.length>2 ? process.argv[2] : './aws-sdk-js/apis/mobileanalytics-2014-06-05.normal.json');
var outputDir = (process.argv.length>3 ? process.argv[3] : './aws/');
if (!outputDir.endsWith('/')) outputDir += '/';

console.log(input);
var aws = require(path.resolve(input));
var options = {};
try {
	options.paginators = require(path.resolve(input.replace('.normal.','.paginators.')));
	console.log('  Has paginators');
}
catch (ex) {}
try {
	options.examples = require(path.resolve(input.replace('.normal.','.examples.')));
	console.log('  Has examples version '+options.examples.version);
}
catch (ex) {}

// https://docs.aws.amazon.com/aws-sdk-php/v2/guide/feature-waiters.html
try {
	options.waiters = require(path.resolve(input.replace('.normal.','.waiters2.')));
	console.log('  Has waiters version '+options.waiters.version);
}
catch (ex) {}


var result = aws2oa.convert(aws,options,function(err,openapi){
	if ((err) && (Object.keys(err).length>0)) {
		console.log(JSON.stringify(err));
	}
	if (openapi) {

		SwaggerParser.validate(openapi, function(vErr, api) {
			if (vErr) {
				console.log(input);
				console.error(vErr);
				process.exitCode = 1;
			}
		});

		var validate = validator(swaggerSchema);
		validate(openapi,{
			greedy: true,
			verbose: true
		});
		var errors = validate.errors;
		if (errors) {
			console.log(input);
			console.log('Failed validation (simple): %s',input);
			console.log(errors);
		}

		var components = input.split('/');
		var filename = components[components.length-1];
		filename = filename.replace('.normal.json','');
		components = filename.split('-');
		var prefix = components[0];
		if (!components[1].startsWith('2')) {
			prefix += '-' + components[1];
		}
		var version = filename.replace(prefix+'-','');
		try {
			fs.mkdirSync(outputDir+prefix);
		}
		catch (e) {}
		try {
			fs.mkdirSync(outputDir+prefix+'/'+version);
		}
		catch (e) {}
		fs.writeFileSync(outputDir+prefix+'/'+version+'/swagger.json',JSON.stringify(openapi,null,2),'utf8');
	}
});
if (!result) {
	console.log('Failed conversion: %s',input);
	process.exitCode = 1;
}
