#!/bin/sh
find ../aws-sdk-js/apis/ -name *normal.json | xargs -n 1 -e node aws2openapi.js
