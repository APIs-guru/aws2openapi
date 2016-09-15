var _ = require('lodash');
var recurseotron = require('../openapi_optimise/common.js');

function clean(s){
	var org = s;
	if (s.startsWith('<p>')) s = s.substr(3);
	if (s.endsWith('</p>')) s = s.substr(0,s.length-4);
	if ((s.indexOf('<p>')>=0) || (s.indexOf('</p>')>=0)) return org;
	return s;
}

function validate(src){
	var result = true;
	var validProtocols = ['json','rest-json','rest-xml','query']; //TODO ec2
	if (src.version != '2.0') result = false;
	if (validProtocols.indexOf(src.metadata.protocol)<0) result = false;
	return result;
}

function rename(obj,key,newKey){
	if (typeof obj[key] !== 'undefined') {
		obj[newKey] = obj[key];
		delete obj[key];
	}
}

function findActionsForShape(openapi,shape){
	var result = [];
	// TODO currently returns first action, may need to return an array
	for (var p in openapi.paths) {
		var path = openapi.paths[p];
		for (var a in recurseotron.actions){
			if (path[recurseotron.actions[a]]) {
				result.push(path[recurseotron.actions[a]]);
			}
		}
	}
	return result;
}

function findActionsForParameter(openapi,parameter){
	var result = [];
	for (var p in openapi.paths) {
		var path = openapi.paths[p];
		if (p.indexOf('{'+parameter.locationName+'}')>=0) {
			for (var a in recurseotron.actions) {
				if (path[recurseotron.actions[a]]) {
					result.push(path[recurseotron.actions[a]]);
				}
			}
		}
	}
	return result;
}

function attachHeader(openapi,shape,header,required){
	var actions = findActionsForShape(openapi,shape);
	if (actions.length>0) {
		for (var a in actions) {
			var action = actions[a];
			if (!action.parameters) {
				action.parameters = [];
			}
			var param = {};
			param.name = header.locationName;
			param["in"] = 'header';
			param.type = 'string';
			if (required) param.required = true;
			//var parameters = [];
			//parameters.push(param);
			//action.parameters = _.unionWith(action.parameters,parameters,_.isEqual);
			action.parameters.push(param); // we uniq them later
		}
	}
}

function attachParameter(openapi,shape,parameter,required,location){
	var actions = findActionsForParameter(openapi,parameter);
	if (actions.length>0) {
		for (var a in actions) {
			var action = actions[a];
			if (!action.parameters) {
				action.parameters = [];
			}
			var param = {};
			param.name = parameter.locationName;
			param["in"] = (location == 'querystring' ? 'query' : 'path');
			param.type = 'string'; // TODO de-reference shape we might not have transformed, but string is a good default
			if (required) param.required = true;
			//var parameters = [];
			//parameters.push(param);
			//action.parameters = _.unionWith(action.parameters,parameters,_.isEqual);
			action.parameters.push(param); // we uniq them later
		}
	}
}

function transformShape(openapi,shape){

	if (shape.type == 'structure') shape.type = 'object';
	if (shape.type == 'float') {
		shape.type = 'number';
		shape.format = 'float';
	}
	if (shape.type == 'long') {
		shape.type = 'integer'; // TODO verify this, it may simply be an unbounded integer
	}
	rename(shape,'members','properties');
	if (shape.documentation) {
		shape.description = clean(shape.documentation);
		delete shape.documentation;
	}

	if (shape.type == 'blob') {
		shape.type = 'string';
	}

	if (shape.type == 'string') {
		if (typeof shape.min !== 'undefined') {
			rename(shape,'min','minLength');
		}
		if (typeof shape.max !== 'undefined') {
			rename(shape,'max','maxLength');
		}
		if (shape.sensitive) {
			shape.format = 'password';
			delete shape.sensitive;
		}
		if (shape.pattern) {
			try {
				var regex = new RegExp(shape.pattern);
			}
			catch (e) {
				rename(shape,'pattern','x-pattern');
			}
		}
	}

	if (shape.type == 'integer') {
		rename(shape,'min','minimum');
		rename(shape,'max','maximum');
	}

	if (shape.type == 'timestamp') {
		shape.type = 'string';
		delete shape.timestampFormat;
		shape.format = 'date-time'; // TODO validate this, add a pattern for rfc822 etc
	}

	if (shape.type == 'list') {
		shape.type = 'array';
		rename(shape,'member','items');
		rename(shape,'min','minItems');
		rename(shape,'max','maxItems');
	}

	if (shape.type == 'map') {
		rename(shape,'min','minItems');
		rename(shape,'max','maxItems');
		// create map 'shape', array of key:value object. Doing it inline means we don't need to name it
		shape.type = 'array';
		shape.items = {};
		shape.items.type = 'object';
		shape.items.properties = {};
		shape.items.properties.key = {};
		shape.items.properties.key["$ref"] = '#/definitions/'+shape.key.shape;
		shape.items.properties.value = {};
		shape.items.properties.value["$ref"] = '#/definitions/'+shape.value.shape;
		delete shape.key;
		delete shape.value;
	}

	if (shape.type == 'double') {
		shape.type = 'number';
		shape.format = 'double';
	}

	if (shape.type == 'number') {
		rename(shape,'min','minimum');
		rename(shape,'max','maximum');
	}

	if (shape.flattened) {
		if (!shape.xml) shape.xml = {};
		shape.xml.wrapped = (!shape.flattened);
		delete shape.flattened;
	}

	delete shape.exception;
	delete shape.fault;
	delete shape.error;
	delete shape.sensitive;
	delete shape.wrapper; // xml
	delete shape.xmlOrder; // xml

	recurseotron.recurse(shape,{},function(obj,state){
		if (state.key == 'shape') {
			state.parents[state.parents.length-1]["$ref"] = '#/definitions/'+obj;
			delete state.parents[state.parents.length-1][state.key];
		}
		if (state.key == 'documentation') {
			state.parents[state.parents.length-1].description = clean(obj);
			delete state.parents[state.parents.length-1].documentation;
		}
		if ((state.key == 'location') && (obj == 'headers')) {
			delete state.parents[state.parents.length-2][state.keys[state.keys.length-2]]; // TODO
		}
		if ((state.key == 'location') && (obj == 'statusCode')) {
			delete state.parents[state.parents.length-2][state.keys[state.keys.length-2]]; // should already be pointed to by 'output'
		}
		if ((state.key == 'location') && (obj == 'header')) {
			var header = state.parents[state.parents.length-2][state.keys[state.keys.length-2]];
			var newHeader = _.cloneDeep(header);

			var required = shape.required;
			var index = (required ? required.indexOf(state.keys[state.keys.length-2]) : -1);
			if (index>=0) {
				required.splice(index,1);
				if (required.length<=0) delete shape.required;
			}

			// we now need to know which operation (or response?) is referencing this shape
			attachHeader(openapi,shape,newHeader,index>=0);

			delete state.parents[state.parents.length-2][state.keys[state.keys.length-2]];
		}
		if ((state.key == 'location') && ((obj == 'uri') || (obj == 'querystring'))) {
			var param = state.parents[state.parents.length-2][state.keys[state.keys.length-2]];
			var newParam = _.cloneDeep(param);

			var required = shape.required;
			var index = (required ? required.indexOf(state.keys[state.keys.length-2]) : -1);
			if (index>=0) { // should always be true
				required.splice(index,1);
				if (required.length<=0) delete shape.required;
			}

			// we now need to know which operation (or response?) is referencing this shape
			attachParameter(openapi,shape,newParam,index>=0,param.location);

			delete state.parents[state.parents.length-2][state.keys[state.keys.length-2]];
		}
		if (state.key == 'xmlNamespace') {
			if (!shape.xml) shape.xml = {};
			shape.xml.namespace = obj.uri;
			delete state.parents[state.parents.length-1].xmlNamespace;
		}
		if (state.key == 'xmlAttribute') {
			if (!shape.xml) shape.xml = {};
			shape.xml.attribute = obj;
			delete state.parents[state.parents.length-1].xmlAttribute;
		}
		if (state.key == 'flattened') {
			if (!shape.xml) shape.xml = {};
			shape.xml.wrapped = !obj;
			delete state.parents[state.parents.length-1].flattened;
		}
		if (state.key == 'locationName') {
			delete state.parents[state.parents.length-1].locationName;
		}
		if (state.key == 'payload') {
			delete state.parents[state.parents.length-1].payload; // TODO
		}
		if (state.key == 'box') {
			delete state.parents[state.parents.length-1].box; // TODO
		}
		if (state.key == 'idempotencyToken') {
			delete state.parents[state.parents.length-1].idempotencyToken; // TODO
		}
		if (state.key == 'streaming') {
			delete state.parents[state.parents.length-1].streaming; // TODO revisit this for OpenApi 3.x ?
		}
		if (state.key == 'deprecated') {
			delete state.parents[state.parents.length-1].deprecated; // TODO revisit this for OpenApi 3.x ?
		}
	});

	return shape;
}

function postProcess(openapi){
	recurseotron.forEachAction(openapi,function(action){
		if (action.parameters) {
			action.parameters = _.uniqWith(action.parameters,_.isEqual);
		}
	});
}

module.exports = {

	convert : function(src,options,callback) {

		if (!validate(src)) return false;

		process.nextTick(function(){
			var err = {};
			var s = {};
			s.swagger = "2.0";
			s.info = {};
			s.info.version = src.metadata.apiVersion
			s.info["x-release"] = src.metadata.signatureVersion;
			s.info.title = src.metadata.serviceFullName;
			if (src.documentation) s.info.description = clean(src.documentation);
			s["x-logo"] = {};
			s["x-logo"].url = 'https://media.amazonwebservices.com/blog/2007/big_pbaws_logo_300px.jpg';
			s["x-logo"].backgroundColor = '#FFFFFF';
			s.info.termsOfService = 'https://aws.amazon.com/service-terms/';
			s.info.contact = {};
			s.info.contact.name = 'Mike Ralphson';
			s.info.contact.email = 'mike.ralphson@gmail.com';
			s.info.contact.url = 'https://github.com/mermade/aws2openapi';
			s.info.license = {};
			s.info.license.name = 'Apache 2.0 License';
			s.info.license.url = 'http://www.apache.org/licenses/';
			s.externalDocs = {};
			s.externalDocs.description = 'Amazon Web Services documentation';
			s.externalDocs.url = 'https://aws.amazon.com/'+src.metadata.endpointPrefix+'/';
			s.host = src.metadata.endpointPrefix+'.us-east-1.amazonaws.com';
			s.basePath = '/';
			s.schemes = [];
			s.consumes = [];
			s.produces = [];

			var protocol = src.metadata.protocol;

			if ((protocol == 'query') && (src.metadata.xmlNamespace)) {
				protocol = 'xml';
			}
			if ((protocol == 'query') && (src.metadata.jsonVersion)) {
				protocol = 'json';
			}

			if ((protocol == 'rest-json') || (protocol == 'json')) {
				s.consumes.push('application/json');
				s.produces.push('application/json');
			}
			if (protocol == 'rest-xml') {
				s.consumes.push('text/xml');
				s.produces.push('text/xml');
			}

			s.paths = {};
			s.definitions = {};

			for (var p in src.operations) {
				var op = src.operations[p];
				var path = {};

				var action = {};
				if (op.http) {
					if (s.schemes.indexOf('http')<0) {
						s.schemes.push('http');
					}
					var actionName = op.http.method.toLocaleLowerCase();
					action.operationId = p; // TODO not handled is 'alias', add as a vendor extension if necessary
					action.description = (op.documentation ? clean(op.documentation) : '');
					if (op.documentationUrl) {
						action.description += '<p>'+op.documentationUrl+'</p>';
					}
					action.responses = {};
					var success = {};
					success.description = 'Success';
					success.schema = {};
					if (op.output && op.output.shape) {
						success.schema["$ref"] = '#/definitions/'+op.output.shape;
					}
					action.responses[op.http.responsCode ? op.http.responseCode : 200] = success;
				}

				if (op.input && op.input.shape) {
					action.parameters = [];
					var param = {};
					param.name = 'body';
					param["in"] = 'body';
					param.required = true;
					param.schema = {};
					param.schema["$ref"] = '#/definitions/'+op.input.shape;
					if (!action.parameters) {
						action.parameters = [];
					}
					action.parameters.push(param);
				}

				var defStatus = 400;
				for (var e in op.errors) {
					var error = op.errors[e];
					var failure = {};
					failure.description = (error.description ? clean(error.documentation) : error.shape);
					failure["x-aws-exception"] = error.exception;
					failure.schema = {};
					failure.schema["$ref"] = '#/definitions/'+error.shape;
					action.responses[error.error ? error.error.httpStatusCode : defStatus++] = failure; //TODO fake statuses. Map to combined output schema?
				}

				path[actionName] = action;

				var url = op.http.requestUri;
				while (url.indexOf('+}')>=0) {
					url = url.replace('+}','}'); // TODO we need to mark the parameter (later) as multiple, IF swagger 2.0 supports this
				}

				s.paths[url] = path; //TODO check we're not overwriting
			}

			for (var d in src.shapes) {
				var shape = src.shapes[d];

				shape = transformShape(s,shape);

				s.definitions[d] = shape;
			}

			postProcess(s);

			callback(err,s);

		});
		return true;

	}

};