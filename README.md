# aws2openapi
Amazon Web Services API description to OpenAPI 3.0 specification

## Work in progress - beta quality

### Handles all current (v2) AWS json and xml specifications

Resultant OpenApi specifications [pass](https://github.com/OAI/OpenAPI-Specification/blob/master/schemas/v2.0/schema.json) [multiple](https://github.com/apigee-127/sway) [validators](https://github.com/BigstickCarpet/swagger-parser)

![screenshot](https://mermade.github.io/aws2openapi/screenshot.png)

The results of this converter can be found [here](https://github.com/APIs-guru/openapi-directory/tree/master/APIs/amazonaws.com)

### TODO **help wanted**

* ~~Fix input header parameter selectivity~~
* ~~Process protocol:ec2~~
* ~~Authentication~~ You will have to calculate HMAC headers manually
* ~~pagination~~
* ~~Examples~~
* ~~Waiters~~ (as vendor extension)
* Test against live endpoints
* Verify output header mappings
* Test path-with-fragment hack works
* Test paths with hardcoded ?parameters work
* Validate xml-handling keyword translations
