var util = require('util');
var _ = require('lodash');
var recurse = require('reftools/lib/recurse.js').recurse;

var ourVersion = require('./package.json').version;
var actions = ['get','post','put','patch','delete','head','options','trace'];

/*
https://docs.aws.amazon.com/AmazonS3/latest/dev/RESTAuthentication.html
https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-swagger-extensions.html
*/

const amzHeaders = ['X-Amz-Content-Sha256','X-Amz-Date','X-Amz-Algorithm','X-Amz-Credential','X-Amz-Security-Token',
    'X-Amz-Signature','X-Amz-SignedHeaders'];
const s3Headers = ['x-amz-security-token'];
const v2Params = ['AWSAccessKeyId', 'Action', 'SignatureMethod', 'SignatureVersion', 'Timestamp', 'Version', 'Signature'];

var multiParams = [];

/**
Removes starting and ending <p></p> markup if no other <p>'s exist
@param s {string} the string to clean
@returns the cleaned or original string
*/
function clean(s){
    var org = s;
    if (s && s.startsWith('<p>')) s = s.substr(3);
    if (s && s.endsWith('</p>')) s = s.substr(0,s.length-4);
    if (s && ((s.indexOf('<p>')>=0) || (s.indexOf('</p>')>=0))) return org;
    return s;
}

/**
Checks the source spec is in a format version and protocol we expect to see
@param src {aws-spec} the specification to check
@returns boolean
*/
function validate(src){
    var result = true;
    var validProtocols = ['json','rest-json','rest-xml','query','ec2'];
    if ((typeof src.version !== 'undefined') && (src.version != '2.0')) result = false; // seems to be ok if missing
    if (validProtocols.indexOf(src.metadata.protocol)<0) result = false;
    return result;
}

/**
rename an object property by removing and re-adding it
@param obj {object} the object to mutate
@param key {string} the property name to rename
@param newKey {string} the new property name
*/
function rename(obj,key,newKey){
    if (typeof obj[key] !== 'undefined') {
        obj[newKey] = obj[key];
        delete obj[key];
    }
}

function checkDef(openapi,name) {
    if (!openapi.definitions[name]) {
        //console.log('Forcing definition of:',name);
        openapi.definitions[name] = {};
    }
}

function findResponsesForShape(openapi,shapeName){
    var result = [];
    for (var p in openapi.paths) {
        var path = openapi.paths[p];
        for (var a of actions){
            var action = path[actions[a]];
            if (action) {
                var ok = false;
                for (var r in action.responses) {
                    r = parseInt(r,10);
                    if ((r>=200) && (r<700)) {
                        var ref = (r.schema ? r.schema["$ref"] : '');
                        if (ref == '#/definitions/'+shapeName) ok = true;
                    }
                }
                if (ok) result.push(r);
            }
        }
    }
}

function attachHeader(openapi,shapeName,header){
    var responses = findResponsesForShape(openapi,shapeName);
    for (var r in responses) {
        var response = responses[r];
        if (!response.header) {
            response.headers = {};
        }
        var header = {};
        header.description = '';
        header.type = 'string';
        response.headers[header.locationName] = header;
    }
}

function convertRegex(pattern) {

/* converted from coffeescript function https://raw.githubusercontent.com/drj11/posixbre/master/code/main.coffee */

    var bre1token;
    bre1token = function(tok) {
        // In POSIX RE in a bracket expression \ matches itself.
        if (/^\[/.test(tok)) {
            tok = tok.replace(/\\/, '\\\\');
        }
        // In POSIX RE in a bracket expression an initial ] or initial ^] is allowed.
        if (/^\[\^?\]/.test(tok)) {
            return tok.replace(/]/, '\\]');
        }
        // Tokens for which we have to remove a leading backslash.
        if (/^\\[(){}]$/.test(tok)) {
            return tok[1];
        }
        // Tokens for which we have to add a leading backslash.
        if (/^[+?|(){}]$/.test(tok)) {
            return '\\' + tok;
        }
        // Everything else is unchanged
        return tok;
    };
    // In POSIX RE, (?<!) is a negative lookbehind, which isn't supported in JS.
    // We strip the negative lookbehind, creating a more permissive regex.
    pattern = pattern.replace(/\(\?\<\![^)]*\)/g, '');

    return pattern.replace(/\[\^?\]?[^]]*\]|\\.|./g, bre1token);
}

function transformShape(openapi,shape){
    shape = _.cloneDeep(shape);

    if (shape.type == 'structure') shape.type = 'object';
    if (shape.type == 'float') {
        shape.type = 'number';
        shape.format = 'float';
    }
    if (shape.type == 'long') {
        shape.type = 'integer'; // TODO verify this, is it simply an unbounded integer?
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
        if (typeof shape.minLength === 'string') {
            shape.minLength = parseInt(shape.minLength,10);
        }
        if (typeof shape.maxLength === 'string') {
            shape.maxLength = parseInt(shape.maxLength,10);
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
                shape.pattern = convertRegex(shape.pattern);
                try {
                    var regex = new RegExp(shape.pattern);
                }
                catch (ex) {
                    rename(shape,'pattern','x-pattern');
                }
            }
        }
    }

    if (shape.type == 'integer') {
        rename(shape,'min','minimum');
        rename(shape,'max','maximum');
        if (typeof shape.minimum === 'string') {
            shape.minimum = parseInt(shape.maximum,10);
        }
        if (typeof shape.maximum === 'string') {
            shape.maximum = parseInt(shape.maximum,10);
        }
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
        rename(shape,'min','minProperties');
        rename(shape,'max','maxProperties');
        shape.type = 'object';
        shape.additionalProperties = {
            '$ref': '#/definitions/'+shape.value.shape
        };
        // In OpenAPI 3, we could use propertyNames/Patterns here, and use the shape.key.shape to
        // only allow valid keys. For now we allow any string.

        checkDef(openapi,shape.value.shape);
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
    delete shape.synthetic;
    delete shape.wrapper; // xml
    delete shape.xmlOrder; // xml

    recurse(shape,{},function(obj,key,state){
        if (key == 'shape') {
            obj["$ref"] = '#/definitions/'+obj[key];
            checkDef(openapi,obj[key]);
            delete obj[key];
        }
        if (key == 'documentation') {
            obj.description = clean(obj.documentation);
            delete obj.documentation;
        }
        if ((key == 'location') && (obj[key] == 'headers')) {
            delete obj[key];
        }
        if ((key == 'location') && (obj[key] == 'statusCode')) {
            delete obj[key]; // should already be pointed to by 'output'
        }
        if ((key == 'location') && (obj[key] == 'header')) {
            var header = obj[key]; // JRM clone
            var newHeader = _.cloneDeep(header);

            var required = shape.required;
            var index = (required ? required.indexOf(state.pkey) : -1);
            if (index>=0) {
                required.splice(index,1);
                if (required.length<=0) delete shape.required;
            }

            // we now need to know which response is referencing this shape
            var shapeName = state.pkey;
            attachHeader(openapi,shapeName,newHeader);

            delete state.parent[state.pkey];
        }
        if ((key == 'location') && ((obj[key] == 'uri') || (obj[key] == 'querystring'))) {
            var required = shape.required;
            var index = (required ? required.indexOf(state.pkey) : -1);
            if (index>=0) { // should always be true
                required.splice(index,1);
                if (required.length<=0) delete shape.required;
            }

            delete state.parent[state.pkey];
        }
        if (key == 'xmlNamespace') {
            if (!shape.xml) shape.xml = {};
            shape.xml.namespace = obj[key].uri;
            delete obj.xmlNamespace;
        }
        if (key == 'xmlAttribute') {
            if (!shape.xml) shape.xml = {};
            shape.xml.attribute = obj[key];
            delete obj.xmlAttribute;
        }
        if (key == 'flattened') {
            if (!shape.xml) shape.xml = {};
            shape.xml.wrapped = !obj[key];
            delete obj.flattened;
        }
        if (key == 'locationName') {
            delete obj.locationName;
        }
        if (key == 'payload') {
            if (state.pkey !== 'properties') {
                delete obj.payload; // TODO
            }
        }
        if (key == 'box') {
            delete obj.box; // just indicates if this is model around a simple type
        }
        if (key == 'idempotencyToken') {
            delete obj.idempotencyToken; // TODO
        }
        if (key == 'jsonvalue') {
            delete obj.jsonvalue; // TODO
        }
        if (key == 'queryName') {
            delete obj.queryName; // TODO ec2 only
        }
        if (key == 'streaming') {
            delete obj.streaming; // TODO revisit this for OpenApi 3.x ?
        }
        if (key == 'deprecated') {
            delete obj.deprecated; // TODO revisit this for OpenApi 3.x ?
        }
        if (key == 'deprecatedMessage') {
            if (!obj.description) {
                obj.description = '';
            }
            obj.description += obj.deprecatedMessage;
            delete obj.deprecatedMessage;
        }
        if (key === 'required' && Array.isArray(obj.required)) {
            if (!obj.required.length) {
                delete obj.required;
            }
        }
        if ((key === 'event') && (typeof obj.event === 'boolean'))  {
            delete obj.event;
        }
        if (key === 'eventpayload') {
            delete obj.eventpayload;
        }
        if (key === 'eventstream') {
            delete obj.eventstream;
        }
    });

    return shape;
}

function isEqualParameter(a,b) {
    return ((a.name == b.name) && (a.in == b.in));
}

function postProcess(openapi,options){
    Object.keys(openapi.paths).forEach(function(action){
        if (action.parameters) {
            action.parameters = _.uniqWith(action.parameters,isEqualParameter);
        }

        if (options.waiters) {
            for (var w in options.waiters.waiters) {
                var waiter = options.waiters.waiters[w];
                if (waiter.operation == (action['x-aws-operation-name'] || action.operationId)) {
                    if (!action["x-waiters"]) {
                        action["x-waiters"] = [];
                    }
                    action["x-waiters"].push(waiter);
                }
            }
        }

    });
}

function deparameterisePath(s){
    return s
        .replace(/(\{.+?\})/g,'{param}')
        .replace(/#.*/, '');
}

function doit(methodUri,op,pi) {
    methodUri.replace(/(\{.+?\})/g,function(match,group1){
        let name = match.replace('{','').replace('}','');
        let param = (op.parameters||[]).concat(pi.parameters||[]).find(function(e,i,a){
            return ((e.name == name) && (e.in == 'path'));
        });
        if (!param) {
            //console.warn('Missing path parameter '+match);
            let nparam = {};
            nparam.name = name;
            nparam.type = 'string';
            nparam.in = 'path';
            nparam.required = true;
            op.parameters.push(nparam); // correct for missing path parameters (2?)
        }
        return match;
    });
}

function fillInMissingPathParameters(openapi) {
    for (let p in openapi.paths) {
        let pi = openapi.paths[p];
        for (let o in pi) {
            if (['get','post','put','patch','delete','head','options'].indexOf(o)>=0) {
                let op = pi[o];
                doit(p,op,pi);
            }
        }
    }
}

function patches(openapi) {
    if (openapi.info["x-serviceName"] === 'data.mediastore') {
        delete openapi.definitions.GetObjectResponse.required;
    }
}

function attachParameters(openapi, src, op, action, options) {
    if (op.input && op.input.shape) {
        // Build parameters details for these params, according to the
        // standard approach for each protocol.
        const paramShape = src.shapes[op.input.shape];

        switch (src.metadata.protocol) {
            case 'rest-xml':
            case 'rest-json':
                // Querystring/URI/header/headers are sent as params for the corresponding type
                // Anything else is a body param

                const [queryParams, bodyParams] = _.partition(
                    _.map(paramShape.members, (member, memberName) => _.omitBy({
                        name: member.locationName || memberName,
                        in: {
                            'header': 'header',
                            'uri': 'path',
                            'querystring': 'query'
                        }[member.location],
                        required: _.includes(paramShape.required, memberName),
                        description: clean(member.documentation || ''),
                        ...(src.shapes[member.shape] ?
                            transformShape(openapi, src.shapes[member.shape]) : {}
                        )
                    }, _.isUndefined)),
                    (param) => !!param.in
                );

                action.parameters = queryParams;

                if (bodyParams.length) {
                    const bodyParam = {
                        name: 'body',
                        in: 'body',
                        required: true,
                        schema: {
                            type: 'object',
                            required: bodyParams
                                .filter(p => p.required)
                                .map(p => p.name),
                            properties: _.mapValues(
                                _.keyBy(bodyParams, 'name'),
                                (param) => _.omit(param, ['name', 'required'])
                            )
                        }
                    };

                    if (bodyParam.schema.required.length === 0) {
                        delete bodyParam.schema.required;
                    }

                    action.parameters.push(bodyParam);
                }
                break;

            case 'query':
            case 'ec2':
                // Serialises all params, into a query string for GET or formdata for POST
                action.parameters = _.map(paramShape.members, (member, name) => _.omitBy({
                    name: src.metadata.protocol === 'ec2'
                        // EC2 uppercases the first char of param names, unless there's a queryName
                        // is provided. See query_param_serializer's ucfirst() in the AWS SDK.
                        ? member.queryName || _.upperFirst(member.locationName || name)
                        : member.locationName || name,
                    in: op.http.method === 'POST' ? 'formData' : 'query',
                    required: _.includes(paramShape.required, name),
                    description: clean(member.documentation || ''),
                    ...(src.shapes[member.shape] ?
                        transformShape(openapi, src.shapes[member.shape]) : {}
                    )
                }, _.isUndefined));
                break;

            case 'json':
                // All params are sent as a JSON object in the body
                const param = {
                    name: 'body',
                    in: 'body',
                    required: true,
                    schema: { '$ref': '#/definitions/' + op.input.shape }
                };
                checkDef(openapi,op.input.shape);
                action.parameters = [param];
                break;

            default:
                throw new Error('Unknown protocol: ' + src.metadata.protocol);
        }

        action.parameters = _.flatMap(action.parameters, (param) => {
            // Any list parameters need to be filtered to just param-valid properties
            // Any object query params need to be converted into their flattened forms

            if (param.in !== 'query' && param.in !== 'formData') {
                return param;
            }

            if (param.additionalProperties) {
                // A 'map' (in AWS terms)

                // These effectively allow wildcard parameters. We can't represent this properly
                // until OpenAPI 3, but in the short term we can enumerate N examples
                return _.flatMap(_.range(param.maxProperties || 3), (i) => [{
                    name: param.name + '.' + i + '.' + 'key',
                    in: param.in,
                    type: 'string'
                }, {
                    name: param.name + '.' + i + '.' + 'value',
                    in: param.in,
                    type: 'string' // Not accurate, but enough for now
                }]);
            } else if (param.type === 'object') {
                // A 'structure' (in AWS terms). This is a defined set of properties.
                // We don't deal with subobjects here, but we may need to in future.
                return _.map(param.properties, (subParam, subParamName) => {
                    const subParamShape = subParam.$ref ?
                        transformShape(openapi,
                            // Go from $ref back to shape name (this is a bit nasty).
                            src.shapes[subParam.$ref.split('/').slice(-1)[0]]
                        ) : {};
                    const type = subParam.type || subParamShape.type;

                    return _.omitBy({
                        name: param.name + '.' + subParamName,
                        in: param.in,
                        required: subParam.required,
                        description: [param.description, subParam.description].join('\n'),

                        // Simplify to stringy params. Not accurate, but enough for now:
                        type: type === 'array' ? 'array' : 'string',
                        items: type === 'array' ? { type: 'string' } : undefined,
                    }, _.isUndefined)
                })
            } else if (param.type === 'array') {
                return {
                    name: param.name,
                    in: param.in,
                    required: param.required,
                    description: param.description,
                    type: 'array',
                    items: { type: 'string' } // Not accurate, but enough for now
                };
            } else {
                return param;
            }
        });
    }

    if (options.paginators && options.paginators.pagination[op.name]) {
        var pag = options.paginators.pagination[op.name];
        if (pag.limit_key && !_.some(action.parameters, { name: pag.limit_key })) {
            var param = {};
            param.name = pag.limit_key;
            param.type = 'string';
            param["in"] = 'query';
            param.description = 'Pagination limit';
            param.required = false;
            if (!action.parameters) {
                action.parameters = [];
            }
            action.parameters.push(param);
        }
        if (pag.input_token && !_.some(action.parameters, { name: pag.input_token })) {
            if (!Array.isArray(pag.input_token)) {
                pag.input_token = [pag.input_token]; //it usually isn't...
            }
            for (var t in pag.input_token) {
                var param = {};
                param.name = pag.input_token[t];
                param.type = 'string';
                param["in"] = 'query';
                param.description = 'Pagination token';
                param.required = false;
                if (!action.parameters) {
                    action.parameters = [];
                }
                action.parameters.push(param);
            }
        }
    }
}

// Attach the given action at the given url/verb in a paths object.
// This assumes there are no conflicts, and will overwrite existing
// actions, so that should be checked first
function attachOperation(paths, url, method, action, signatureVersion) {
    if (paths[url]) {
        paths[url][method] = action;
        return;
    }

    paths[url] = { [method]: action };
    if (signatureVersion === 4) {
        paths[url].parameters = [];
        for (var h in amzHeaders) {
            var param = {};
            param["$ref"] = '#/parameters/'+amzHeaders[h];
            paths[url].parameters.push(param);
        }
    }
    else if (signatureVersion === 3) {
        paths[url].parameters = [];
        for (var h in s3Headers) {
            var param = {};
            param["$ref"] = '#/parameters/'+s3Headers[h];
            paths[url].parameters.push(param);
        }
    }
    else if (signatureVersion === 2) {
        paths[url].parameters = [];
        for (var p in v2Params) {
            var param = {};
            param["$ref"] = '#/parameters/'+v2Params[p];
            paths[url].parameters.push(param);
        }
    }
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
            s.info["x-logo"] = {};
            s.info["x-logo"].url = 'https://twitter.com/awscloud/profile_image?size=original';
            s.info["x-logo"].backgroundColor = '#FFFFFF';
            s.info.termsOfService = 'https://aws.amazon.com/service-terms/';
            s.info.contact = {};
            s.info.contact.name = 'Mike Ralphson';
            s.info.contact.email = 'mike.ralphson@gmail.com';
            s.info.contact.url = 'https://github.com/mermade/aws2openapi';
            s.info.contact["x-twitter"] = 'PermittedSoc';
            s.info.license = {};
            s.info.license.name = 'Apache 2.0 License';
            s.info.license.url = 'http://www.apache.org/licenses/';
            s.info['x-providerName'] = 'amazonaws.com';
            s.info['x-serviceName'] = src.metadata.endpointPrefix;

            var xorigin = [];
            var origin = {contentType:'application/json',url:'https://raw.githubusercontent.com/aws/aws-sdk-js/master/apis/'+options.filename,converter:{url:'https://github.com/mermade/aws2openapi',version:ourVersion},'x-apisguru-direct': true};
            xorigin.push(origin);
            s.info['x-origin'] = xorigin;

            s.info['x-apiClientRegistration'] = {url:'https://portal.aws.amazon.com/gp/aws/developer/registration/index.html?nc2=h_ct'};
            s.info['x-apisguru-categories'] = ['cloud'];
            var preferred = true;
            if (!options.preferred) options.preferred = [];
            var prefEntry = options.preferred.find(function(e,i,a){
                return e.serviceName === options.serviceName;
            });
            console.log(JSON.stringify(prefEntry));
            if (prefEntry) preferred = (prefEntry.preferred == src.metadata.apiVersion);
            s.info['x-preferred'] = preferred;

            var epp = src.metadata.endpointPrefix.split('.');

            s.externalDocs = {
                description: 'Amazon Web Services documentation',
                // This is a best guess. Mostly correct, but not always.
                // In future, it might be good to test it for 404s, and try
                // some other possible URL formats too as a backup.
                url: 'https://docs.aws.amazon.com/'+epp[epp.length-1]+'/'
            };
            s.host = src.metadata.endpointPrefix+'.amazonaws.com';
            s.basePath = '/';
            s['x-hasEquivalentPaths'] = false; // may get removed later
            s.schemes = ['https']; // GitHub issue #3
            s.consumes = [];
            s.produces = [];

            s.parameters = {};

            s.securityDefinitions = {};
            s.securityDefinitions.hmac = {};
            s.securityDefinitions.hmac.type = 'apiKey';
            s.securityDefinitions.hmac.name = 'Authorization';
            s.securityDefinitions.hmac["in"] = 'header';

            var signatureVersion = null;

            if (src.metadata.signatureVersion) {
                if ((src.metadata.signatureVersion == 'v4') || (src.metadata.signatureVersion === 's3v4')) {
                    s.securityDefinitions.hmac.description = 'Amazon Signature authorization v4';
                    s.securityDefinitions.hmac["x-amazon-apigateway-authtype"] = 'awsSigv4';
                    signatureVersion = 4;

                    for (var h in amzHeaders) {
                        var header = {};
                        header.name = amzHeaders[h];
                        header["in"] = 'header';
                        header.type = 'string';
                        header.required = false;
                        s.parameters[amzHeaders[h]] = header;
                    }

                }
                else if (src.metadata.signatureVersion == 's3') {
                    s.securityDefinitions.hmac.description = 'Amazon S3 signature';
                    s.securityDefinitions.hmac["x-amazon-apigateway-authtype"] = 'awsS3';
                    signatureVersion = 3;

                    // https://docs.aws.amazon.com/AmazonS3/latest/dev/RESTAuthentication.html

                    for (var h in s3Headers) {
                        var header = {};
                        header.name = s3Headers[h];
                        header["in"] = 'header';
                        header.type = 'string';
                        header.required = false;
                        s.parameters[s3Headers[h]] = header;
                    }

                }
                else if (src.metadata.signatureVersion == 'v2') {
                    s.securityDefinitions.hmac.description = 'Amazon Signature authorization v2';
                    s.securityDefinitions.hmac["x-amazon-apigateway-authtype"] = 'awsSigv2';
                    signatureVersion = 2;

                    // https://docs.aws.amazon.com/general/latest/gr/signature-version-2.html

                    for (var p in v2Params) {
                        var param = {};
                        param.name = v2Params[p];
                        param["in"] = 'query';
                        param.type = 'string';
                        param.required = true;
                        s.parameters[v2Params[p]] = param;
                    }
                }
                else {
                    console.log('Unknown signatureVersion '+src.metadata.signatureVersion);
                }
            }

            s.security = [];
            var sec = {};
            sec.hmac = [];
            s.security.push(sec);

            const protocol = src.metadata.protocol;

            if (
                protocol == 'rest-json' ||
                protocol == 'json' ||
                (protocol == 'query' && src.metadata.jsonVersion)
            ) {
                s.consumes.push('application/json');
                s.produces.push('application/json');
            }
            if (
                protocol == 'rest-xml' ||
                (protocol == 'query' && src.metadata.xmlNamespace)
            ) {
                s.consumes.push('text/xml');
                s.produces.push('text/xml');
            }

            s.paths = {};
            s.definitions = {};

            // EC2/Query protocol operations are all valid as either GET or POST, so in
            // those cases we duplicate every operation, once for each method
            const operations = (protocol === 'ec2' || protocol === 'query')
                ? _.flatMap(src.operations, (op) => [
                    _.merge(_.cloneDeep(op), { http: { method: 'GET' } }),
                    _.merge(_.cloneDeep(op), { http: { method: 'POST' } }),
                ])
                : Object.values(src.operations);

            for (let op of operations) {
                var action = { };

                if (op.deprecated) action.deprecated = true;

                if (op.http) {
                    if (s.schemes.indexOf('http')<0) {
                        s.schemes.push('http');
                    }
                    var method = op.http.method.toLocaleLowerCase();
                    if (protocol === 'ec2' || protocol === 'query') {
                        action['x-aws-operation-name'] = op.name; // Save separately, for reference elsewhere
                        action.operationId = method.toUpperCase() + ' ' + op.name;
                    } else {
                        action.operationId = op.name; // TODO not handled is 'alias', add as a vendor extension if necessary
                    }
                    action.description = (op.documentation ? clean(op.documentation) : '');
                    if (op.documentationUrl) {
                        action.externalDocs = {
                            url: op.documentationUrl
                        };
                    }
                    action.responses = {};
                    var success = {};
                    success.description = 'Success';
                    if (op.output && op.output.shape) {
                        success.schema = {};
                        success.schema["$ref"] = '#/definitions/'+op.output.shape;
                        checkDef(s,op.output.shape);

                        if (options.examples && options.examples.examples[op.name]) {
                            for (var e in options.examples.examples[op.name]) {
                                var example = options.examples.examples[op.name][e];
                                if (example.output) {
                                    src.shapes[op.output.shape].example = example.output;
                                }
                            }
                        }
                    }
                    action.responses[op.http.responseCode ? op.http.responseCode : 200] = success;
                }

                attachParameters(s, src, op, action, options);

                var defStatus = 480;
                for (var e in op.errors) {
                    var error = op.errors[e];
                    var failure = {};
                    failure.description = (error.description ? clean(error.documentation) : error.shape);
                    if (error.exception) failure["x-aws-exception"] = error.exception;
                    failure.schema = {};
                    failure.schema["$ref"] = '#/definitions/'+error.shape;
                    checkDef(s,error.shape);
                    action.responses[error.error ? error.error.httpStatusCode : defStatus++] = failure; //TODO fake statuses created. Map to combined output schema with a 'oneOf'?
                }

                var url = op.http.requestUri;

                if (src.metadata.endpointPrefix === 'sqs') {
                    // SQS has unique special logic for its URLs. If a QueueUrl param is provided, it
                    // replaces the base endpoint entirely. That effectively means that the path for
                    // operations on a specific queue needs to be within /{accountId}/{queueName}.
                    // See https://github.com/aws/aws-sdk-js/blob/bdcca26/lib/services/sqs.js#L120-L129
                    // for the AWS SDK implementation side of this.

                    if (_.find(action.parameters, { name: 'QueueUrl' })) {
                        url = '/{AccountNumber}/{QueueName}' + url;

                        action.parameters.push({
                            in: 'path',
                            name: 'AccountNumber',
                            required: true,
                            description: 'The AWS account number',
                            type: 'integer'
                        });
                        action.parameters.push({
                            in: 'path',
                            name: 'QueueName',
                            required: true,
                            description: 'The name of the queue',
                            type: 'string'
                        });

                        // Remove the QueueUrl param (this path replaces it)
                        action.parameters = _.reject(action.parameters, { name: 'QueueUrl' })
                    }
                }

                url = url.replace(/(\{.+?\})/g,function(match,group1){ // store multiple parameters e.g. {key+} for later use. Only seen in s3
                    var result = group1.replace('+}','}');
                    if (result != group1) {
                        var multiple = {};
                        multiple.url = '';
                        multiple.action = method;
                        multiple.param = result.replace('{','').replace('}','');
                        multiParams.push(multiple);
                    }
                    return result;
                });
                for (var m in multiParams) {
                    var multiple = multiParams[m];
                    if (multiple.url == '') multiple.url = url;
                }

                if (url.indexOf('?')>=0) {
                    let hparams = url.split('?')[1].split('&');
                    for (let p of hparams) {
                        let param = {};
                        param.name = p.split('=')[0];
                        param.in = 'query';
                        param.required = true;
                        let val = p.split('=')[1];
                        if (val) {
                            param.type = 'string';
                            param.enum = [val];
                        }
                        else {
                            // A slightly funky way to describe a empty ONLY value
                            // that must always be present (with required=true above)
                            param.type = 'boolean';
                            param.allowEmptyValue = true;
                            param.enum = [true];
                        }
                        //console.log('Hardcoded param',param.name);
                        action.parameters.push(param);
                    }

                    // Move query params to a fragment, so they're not strictly used, but
                    // the paths become distinct, everything validates, and they can be
                    // used by any tools that do understand them.
                    url = url.replace('?', '#');
                }

                if (op.input && op.input.shape) {
                    // Add any other required query params to the URL fragment too
                    const paramShape = src.shapes[op.input.shape];
                    const requiredQueryParamNames = _.filter(paramShape.members, (member, memberName) =>
                        _.includes(['querystring', 'header', 'headers'], member.location) &&
                        _.includes(paramShape.required, memberName)
                    ).map((param) => param.locationName);

                    if (requiredQueryParamNames.length > 0) {
                        url += (url.indexOf('#') > -1 ? '&' : '#') + requiredQueryParamNames.join('&');
                    }
                }

                // Work out a unique path identifier sufficient to look up the relevant
                // path given a full request, for routing etc.
                switch (protocol) {
                    case 'rest-xml':
                    case 'rest-json':
                        // Identified by specific requestUri params.
                        // Include all params from requestUri but with a # - already
                        // done by the URL parsing above though.
                        break;

                    case 'query':
                    case 'ec2':
                        // Identified by Action={opName} parameter
                        url += (url.indexOf('#') > -1 ? '&' : '#') + 'Action=' + op.name;
                        action.parameters = (action.parameters || []).concat([
                            {
                                name: 'Action',
                                in: 'query',
                                required: true,
                                type: 'string',
                                enum: [op.name]
                            },
                            {
                                name: 'Version',
                                in: 'query',
                                required: true,
                                type: 'string',
                                enum: [src.metadata.apiVersion]
                            }
                        ]);
                        break;

                    case 'json':
                        // Identified by X-Amz-Target={prefix.opName} header
                        const amzTarget = src.metadata.targetPrefix + '.' + op.name;
                        url += (url.indexOf('#') > -1 ? '&' : '#') + 'X-Amz-Target=' + amzTarget;
                        action.parameters = (action.parameters || []).concat({
                            name: 'X-Amz-Target',
                            in: 'header',
                            required: true,
                            type: 'string',
                            enum: [amzTarget]
                        });
                        break;

                    default:
                        throw new Error('Unknown protocol: ' + protocol);
                }

                // Before adding the operation, we need to confirm the URL+method don't conflict
                if (s.paths[url]) {
                    const conflictingAction = s.paths[url][method];
                    if (conflictingAction) {
                        const deprecatedUrl = url + (url.indexOf('#') > -1 ? '&' : '#') + 'deprecated!';

                        if (conflictingAction.deprecated) {
                            // We're a new version of a deprecated action. Move the deprecated version,
                            // and we'll overwrite the existing action when we're attached below.
                            if (s.paths[deprecatedUrl] && s.paths[deprecatedUrl][method]) {
                                throw new Error('Multiple deprecated methods for ' + url);
                            } else {
                                attachOperation(s.paths, deprecatedUrl, method, conflictingAction, signatureVersion);
                            }
                        } else if (action.deprecated) {
                            // We're the deprecated version of a replaced action. Move ourselves elsewhere.
                            url = deprecatedUrl;
                        } else {
                            throw new Error('Two conflicting actions, neither deprecated: ' +
                                action.operationId + ' and ' + conflictingAction.operationId);
                        }
                    }
                }

                attachOperation(s.paths, url, method, action, signatureVersion);
            }

            for (var d in src.shapes) {
                var shape = src.shapes[d];

                shape = transformShape(s,shape);

                s.definitions[d] = shape;
            }

            postProcess(s,options);

            const paths = Object.keys(s.paths);
            if (_.uniqBy(paths, deparameterisePath).length !== paths.length) {
                s['x-hasEquivalentPaths'] = true;
            } else {
                delete s['x-hasEquivalentPaths'];
            }

            fillInMissingPathParameters(s); // AWS getting sloppy

            patches(s); // extend if necessary

            callback(err,s);

        });
        return true;

    }

};

