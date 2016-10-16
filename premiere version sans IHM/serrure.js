
var awsIot = require('aws-iot-device-sdk');

//
// Replace the values of '<YourUniqueClientIdentifier>' and '<YourAWSRegion>'
// with a unique client identifier and the AWS region you created your
// certificate in (e.g. 'us-east-1').  NOTE: client identifiers must be
// unique within your AWS account; if a client attempts to connect with a
// client identifier which is already in use, the existing connection will
// be terminated.
//
var device = awsIot.device({
   keyPath: "c84c370d61-private.pem.key",
  certPath: "c84c370d61-certificate.pem.crt",
caPath: "rootCA.pem.crt",
  clientId: "Serrure",
    region: "us-west-2" 
});

//
// Device is an instance returned by mqtt.Client(), see mqtt.js for full
// documentation.
//
device
  .on('connect', function() {
    console.log('connect');
    device.subscribe('$aws/things/Serrure/shadow/update/accepted');
    device.subscribe('$aws/things/Serrure/shadow/update/rejected');
    
  document =  {
        "state": {
            "reported": {
                "locked": "true"
                }
        }
}
    
    device.publish('$aws/things/Serrure/shadow/update', JSON.stringify(document));
    });

device
  .on('message', function(topic, payload) {
    console.log('message', topic, payload.toString());
  });