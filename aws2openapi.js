'use strict';

const fs = require('fs');
const path = require('path');
const oasv = require('oas-validator');
const rr = require('recursive-readdir');
const yaml = require('js-yaml');
const aws2oa = require('./index.js');
const helpers = require('./helpers.js');

var preferred = require('./preferred.json');

function doit(input, regionConfig) {
	var outputDir = (process.argv.length>3 ? process.argv[3] : './aws/');
	if (!outputDir.endsWith('/')) outputDir += '/';
	var outputYaml = (process.argv.length>4 ? (process.argv[4] == '-y') : false);

	console.log(input);
	var aws = require(path.resolve(input));
	var options = {
		regionConfig: regionConfig
	};
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
	filename = filename.replace('.normal.json','');
    let prefix = helpers.extractServiceName(filename);
    options.serviceName = prefix;

	var result = aws2oa.convert(aws,options,function(err,openapi){
		if ((err) && (Object.keys(err).length>0)) {
			console.log(JSON.stringify(err));
		}
		if (openapi) {
            oasv.validate(openapi, { laxurls: true, validateSchema: 'never', text: '{}' })
            .then(options => {
            })
            .catch(ex => {
              console.error(aws.metadata.uid, ex.message);
			  process.exitCode = 1;
            });

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
			lastOrigin.url = lastOrigin.url.replace('{filename}',prefix+'/'+version+'/openapi.'+(outputYaml ? 'yaml' : 'json'));

			if (outputYaml) {
				fs.writeFileSync(outputDir+prefix+'/'+version+'/openapi.yaml',yaml.dump(openapi,{lineWidth: -1}),'utf8');
			}
			else {
				fs.writeFileSync(outputDir+prefix+'/'+version+'/openapi.json',JSON.stringify(openapi,null,2),'utf8');
			}
		}
	});
	if (!result) {
		console.log('Failed conversion: %s',input);
		process.exitCode = 1;
	}
}

function getRegionConfig(awsRoot) {
    const regionConfig = require(path.join(awsRoot, 'lib', 'region_config_data.json'));

    // We make a few amends to the official AWS endpoint config data. It describes the URLs
    // that the SDK sends requests to, but that's only a subset of all valid URLs, so we add a
    // couple of extra options that might be also relevant.

    // All based on https://docs.aws.amazon.com/general/latest/gr/rande.html
    // See buildServers below to understand how this is all used.

    // EC2/autoscaling/ELB/EMR all allow both region-less and regioned URLs:
    regionConfig.patterns['regionOrGeneral'] = {
        "endpoint": "{service}.{region}.amazonaws.com",
        "generalEndpoint": "{service}.amazonaws.com"
    };
    regionConfig.rules['us-east-1/ec2'] = 'regionOrGeneral';
    regionConfig.rules['us-east-1/autoscaling'] = 'regionOrGeneral';
    regionConfig.rules['us-east-1/elasticloadbalancing'] = 'regionOrGeneral';
    regionConfig.rules['us-west-2/elasticmapreduce'] = 'regionOrGeneral';
    regionConfig.rules['*/rds'] = 'regionOrGeneral';

    // S3 allows both - and .: s3.us-east-1.amazonaws.com or s3-us-east-1.amazonaws.com
    regionConfig.patterns['s3signature'].endpoint = "{service}{dash-or-dot}{region}.amazonaws.com";

    // S3 also has a general endpoint, resolving to us-east-1
    regionConfig.rules['us-east-1/s3'].endpoint = "{service}{dash-or-dot}{region}.amazonaws.com";
    regionConfig.rules['us-east-1/s3'].generalEndpoint = "{service}.amazonaws.com";

    // Chime/health/support have special non-standard endpoints
    regionConfig.rules['*/chime'] = { endpoint: "service.chime.aws.amazon.com" };
    regionConfig.rules['*/health'] = { endpoint: "https://health.us-east-1.amazonaws.com" };
    regionConfig.rules['*/support'] = { endpoint: "https://support.us-east-1.amazonaws.com" };

    return regionConfig;
}

let inputspec = process.argv[2];
if (inputspec) {
    inputspec = path.resolve(inputspec);
    const awsRoot = path.dirname(inputspec); // We require the given AWS spec to always be one dir down from the SDK root
    const regionConfig = getRegionConfig(awsRoot);

    const stats = fs.statSync(inputspec);
    if (stats.isFile()) {
    	doit(inputspec, regionConfig);
    }
    else {
      rr(inputspec, function(err, files) {
  	    for (var f in files) {
	      const filename = files[f];
  		  if (filename.indexOf('normal')>=0) {
	        doit(filename, regionConfig);
		  }
	    }
	  });
  }
}
