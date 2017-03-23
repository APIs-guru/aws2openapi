'use strict';

var fs = require('fs');
var path = require('path');
var rr = require('recursive-readdir');
var yaml = require('js-yaml');

var results = [];

function doit(input) {
	var src = JSON.parse(fs.readFileSync(input,'utf8'));
	if (src.metadata && src.metadata.apiVersion && src.metadata.endpointPrefix) {
		var entry = results.find(function(e,i,a){
			return e.endpointPrefix == src.metadata.endpointPrefix;
		});
		if (!entry) {
			entry = {endpointPrefix: src.metadata.endpointPrefix, versions:[]};
			results.push(entry);
		}
		entry.versions.push(src.metadata.apiVersion);
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

process.on('exit',function(){
	for (var entry of results) {
		entry.versions = entry.versions.sort();
		entry.preferred = entry.versions.pop();
	}
	fs.writeFileSync('./preferred.json',JSON.stringify(results,null,2),'utf8');
});