var path = require('path');
var aws2oa = require('./index.js');

var input = (process.argv.length>2 ? process.argv[2] : './aws-sdk-js/apis/mobileanalytics-2014-06-05.normal.json');

var aws = require(path.resolve(input));

var result = aws2oa.convert(aws,{},function(err,openapi){
	console.log(JSON.stringify(openapi,null,2));
});
