#!/bin/sh
cd $(dirname $0)
cd ../aws-sdk-js
git pull
cd ../aws2openapi
. ./processYaml.sh
if [ "$?" -eq "0" ]; then
  cd ../openapi-directory/APIs
  git add amazonaws.com
  git commit -m "Update AWS APIs"
  git push
fi
