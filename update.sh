#!/bin/sh
cd $(dirname $0)
expbranch="$1"
if [ "$expbranch" = "" ]; then
  expbranch=master
fi
branch=`git symbolic-ref --short HEAD`
echo Checking if branch $branch is expected $expbranch
if [ "$branch" = "$expbranch" ]; then
  echo Pulling latest changes...
  cd ../aws-sdk-js
  git pull
  tag=`git describe --abbrev=0 --tags`
  cd ../aws2openapi
  . ./processYaml.sh
  if [ "$?" -eq "0" ]; then
    cd ../openapi-directory/APIs
    git add amazonaws.com
    git commit -m "Update AWS APIs to $tag"
    git push
  fi
else
  echo Current branch $branch does not match expected $expbranch
fi
