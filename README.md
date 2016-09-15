# aws2openapi
Amazon Web Services API description to OpenApi (Swagger) 2.0 specification

## Work in progress - alpha quality

### Handles all current (v2) AWS json and xml specifications

Resultant OpenApi specifications pass multiple validators

### TODO

* ~~Fix input header parameter selectivity~~
* ~~Process ec2~~
* ~~Authentication~~ You will have to calculate HMAC headers manually
* Verify output header mappings 
* Test against live endpoints
* Test ec2 path-with-fragment hack works
* Test paths with hardcoded ?parameters work
* Validate xml-handling keyword translations
* Pagination?
