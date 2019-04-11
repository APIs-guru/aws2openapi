'use strict';

const fs = require('fs');
const path = require('path');
const rr = require('recursive-readdir');
const helpers = require('./helpers.js');

var results = [];

function doit(input) {
	var src = JSON.parse(fs.readFileSync(input,'utf8'));
    let serviceName = helpers.extractServiceName(input);
	if (src.metadata && src.metadata.apiVersion) {
		var entry = results.find(function(e,i,a){
			return e.serviceName == serviceName;
		});
		if (!entry) {
			entry = {serviceName: serviceName, versions:[]};
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
