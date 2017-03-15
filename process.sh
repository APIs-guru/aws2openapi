#!/bin/sh
node aws2openapi ../aws-sdk-js/apis ../openapi-definitions/aws
#find ../aws-sdk-js/apis/ -name *normal.json | xargs -n 1 -e node aws2openapi.js
