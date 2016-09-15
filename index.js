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
	var validProtocols = ['json','rest-json'];
	if (src.version != '2.0') result = false;
	if (validProtocols.indexOf(src.metadata.protocol)<0) result = false;
	return result;
}

function rename(obj,key,newKey){
	obj[newKey] = obj[key];
	delete obj[key];
}

function findActionForShape(openapi,shape){
	// TODO currently returns first action
	for (var p in openapi.paths) {
		var path = openapi.paths[p];
		for (var a in recurseotron.actions){
			if (path[recurseotron.actions[a]]) {
				return path[recurseotron.actions[a]];
			}
		}
	}
	return false;
}

function attachHeader(openapi,shape,header,required){
	var action = findActionForShape(openapi,shape);
	if (action) {
		if (!action.parameters) {
			action.parameters = [];
		}
		var param = {};
		param.name = header.locationName;
		param["in"] = 'header';
		param.type = 'string';
		if (required) param.required = true;
		action.parameters.push(param);
	}
}

function transformShape(openapi,shape){

	if (shape.type == 'structure') shape.type = 'object';
	if (shape.type == 'long') {
		shape.type = 'number';
		shape.format = 'float';
	}
	rename(shape,'members','properties');
	if (shape.documentation) {
		shape.description = clean(shape.documentation);
		delete shape.documentation;
	}

	if (shape.type == 'string') {
		if (typeof shape.min !== 'undefined') {
			rename(shape,'min','minLength');
		}
		if (typeof shape.max !== 'undefined') {
			rename(shape,'max','maxLength');
		}
	}

	if (shape.type == 'integer') {
		if (typeof shape.min !== 'undefined') {
			rename(shape,'min','minimum');
		}
		if (typeof shape.max !== 'undefined') {
			rename(shape,'max','maximum');
		}
	}

	if (shape.type == 'timestamp') {
		shape.type = 'string'; // TODO validate this
		shape.format = 'date-time';
	}

	if (shape.type == 'list') {
		shape.type = 'array';
		rename(shape,'member','items');
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

	delete shape.exception;
	delete shape.fault;
	delete shape.error;

	recurseotron.recurse(shape,{},function(obj,state){
		if (state.key == 'shape') {
			state.parents[state.parents.length-1]["$ref"] = '#/definitions/'+obj;
			delete state.parents[state.parents.length-1][state.key];
		}
		if (state.key == 'documentation') {
			state.parents[state.parents.length-1].description = clean(obj);
			delete state.parents[state.parents.length-1].documentation;
		}
		if ((state.key == 'location') && (obj == 'header')) {
			var header = state.parents[state.parents.length-2][state.keys[state.keys.length-2]];
			var newHeader = _.cloneDeep(header);

			var required = shape.required;
			var index = (required ? required.indexOf(state.keys[state.keys.length-2]) : -1);
			if (index>=0) {
				required.splice(index,1);
			}

			// we now need to know which operation (or response?) is referencing this shape
			attachHeader(openapi,shape,newHeader,index>=0);

			delete state.parents[state.parents.length-2][state.keys[state.keys.length-2]];
		}
	});

	return shape;
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
			s.info.description = clean(src.documentation);
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
			if ((src.metadata.protocol == 'rest-json') || (src.metadata.protocol == 'json')) {
				s.consumes.push('application/json');
				s.produces.push('application/json');
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
					action.operationId = p;
					action.description = clean(op.documentation);
					action.responses = {};
					var success = {};
					success.description = 'Success';
					success.schema = {};
					if (op.output.shape) {
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

				s.paths[op.http.requestUri] = path; //!
			}

			for (var d in src.shapes) {
				var shape = src.shapes[d];

				shape = transformShape(s,shape);

				s.definitions[d] = shape;
			}

			callback(err,s);

		});
		return true;

	}

};