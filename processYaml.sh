#!/bin/sh
node getPreferred ../aws-sdk-js/apis
node aws2openapi ../aws-sdk-js/apis ../openapi-directory/APIs/amazonaws.com -y
