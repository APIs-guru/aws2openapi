'use strict';

var fs = require('fs');
var path = require('path');
var SwaggerParser = require('swagger-parser');
var validator = require('is-my-json-valid');
var rr = require('recursive-readdir');
var yaml = require('js-yaml');
var aws2oa = require('./index.js');

var swaggerSchema = require('./validation/swagger2Schema.json');
var preferred = require('./preferred.json');

function doit(input) {
	var outputDir = (process.argv.length>3 ? process.argv[3] : './aws/');
	if (!outputDir.endsWith('/')) outputDir += '/';
	var outputYaml = (process.argv.length>4 ? (process.argv[4] == '-y') : false);

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

	var components = input.split('\\').join('/').split('/');
	var filename = components[components.length-1];
	options.filename = filename;
	options.preferred = preferred;

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

			filename = filename.replace('.normal.json','');
			components = filename.split('-');
			var prefix = components[0];
            let i = 1;
			while (!components[i].startsWith('2')) {
				prefix += '-' + components[i];
                i++;
			}
            var version = filename.replace(prefix+'-','');

            openapi.info["x-serviceName"] = prefix;

			try {
				fs.mkdirSync(outputDir+prefix);
			}
			catch (e) {}
			try {
				fs.mkdirSync(outputDir+prefix+'/'+version);
			}
			catch (e) {}

			var origin = openapi.info['x-origin'];
			var lastOrigin = origin[origin.length-1];
			lastOrigin.url = lastOrigin.url.replace('{filename}',prefix+'/'+version+'/swagger.'+(outputYaml ? 'yaml' : 'json'));

			if (outputYaml) {
				fs.writeFileSync(outputDir+prefix+'/'+version+'/swagger.yaml',yaml.safeDump(openapi,{lineWidth: -1}),'utf8');
			}
			else {
				fs.writeFileSync(outputDir+prefix+'/'+version+'/swagger.json',JSON.stringify(openapi,null,2),'utf8');
			}
		}
	});
	if (!result) {
		console.log('Failed conversion: %s',input);
		process.exitCode = 1;
	}
}

var inputspec = process.argv[2];
if (inputspec) {
    inputspec = path.resolve(inputspec);
    var stats = fs.statSync(inputspec);
    if (stats.isFile()) {
    	doit(inputspec);
    }
    else {
      rr(inputspec, function(err, files) {
  	    for (var f in files) {
	      var filename = files[f];
  		  if (filename.indexOf('normal')>=0) {
	        doit(filename);
		  }
	    }
	  });
  }
}
