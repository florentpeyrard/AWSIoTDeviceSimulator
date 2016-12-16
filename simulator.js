//angular-toArrayFilter : to make Angular support objects as well as arrays
angular.module('simulatorApp', ['angular-toArrayFilter'])
    .controller('SimulatorController', ['$scope', function ($scope) {
        var fs = require('fs')
        var moment = require('moment');

        //to access AWS, config in ~/.aws/credentials. Before that, credentials must be created in IAM web console , and rights on resources must be given to the user owning the credentials
        var awssdk = require('aws-sdk')
        var devicesdk = require('aws-iot-device-sdk');
        var parser = require('json-parser');
        var extend = require('util')._extend;


        //var simu = this;


        $scope.things = []; //properties of a thing : thingName, thingTypeName, selected, state, reported, desired, device
        $scope.thingTypes = [];
        $scope.thingTypeIndex = null;
        $scope.thingIndex = null;
        $scope.propertyIndex = null;
        $scope.newThing = {
            "thingName": "",
            "thingTypeName": ""
        };
        $scope.newThingTypeName = "";
        $scope.newPropertyName = "";
        $scope.texts = [];
        $scope.copies = {};
        $scope.dataGenerator = {}; //properties : idToClearInterval, rate   
        $scope.logs = "";
        $scope.sentUpdates = 0;
        $scope.receivedUpdates = 0;
        $scope.qos = null;
        $scope.allowedQos = ["0","1","2"];
        $scope.started = false;

        $scope.parseJSON = function (text) {
            return JSON.parse(text);
        }

        /*        $scope.updateModel = function(variable,value){
                    $scope.variable = value
                    $scope.apply()
                }*/

        //On récupère la liste des device via l'API AWS IoT (pas dispo dans SDK) 

        $scope.log = function (text) {
            $scope.logs += "\n" + moment().format() + " " + text;

        }

        $scope.createThingType = function () {
            $scope.log('createThingType');
            var params = {
                thingTypeName: $scope.newThingTypeName
            };
            iot.createThingType(params, function (err, data) {
                if (err) $scope.log(err);
                else {
                    $scope.log('Thing type created on AWS :' + JSON.stringify(data));
                    $scope.thingTypes.push(data.thingTypeName);
                    $scope.$apply();
                }
            });
        }


        $scope.listThingTypes = function () {
            iot.listThingTypes({}, function (err, data) {
                if (err) $scope.log(err);
                else {
                    for (i = 0; i < data.thingTypes.length; i++) {
                        $scope.thingTypes.push(data.thingTypes[i].thingTypeName)
                    }
                    $scope.$apply();
                    //retrieve things list from the things registry on AWS
                }
            });

        }


        $scope.listThings = function () {
            $scope.things = [];
            $scope.thingTypeIndex = null;
            $scope.thingIndex = null;
            iot.listThings({}, function (err, data) {
                if (err) {
                    $scope.log(err)
                } else {
                    //$scope.log('Retrieved things list from things registry on AWS : '+JSON.stringify(data));
                    //$scope.log('number of things '+data.things.length)
                    for (i = 0; i < data.things.length; i++) {
                        //$scope.log('the thing is '+data.things[i].thingName)
                        $scope.things.push(data.things[i]);
                        $scope.things[i]['state'] = [];
                        $scope.things[i]['reported'] = [];
                        $scope.things[i]['desired'] = [];

                        //we create one connection per device to be more realistic, even if one client id for all things name (used in topic paths) is allowed by AWS. In contrast, one certificate is shared among all connections, because handling certificates is a bit heavier.
                        //$scope.log('creating a connection for thing '+data.things[i].thingName)
                        $scope.things[i]['device'] = devicesdk.device({
                            keyPath: "TODO",
                            certPath: "TODO",
                            caPath: "TODO",
                            clientId: data.things[i].thingName,
                            region: "us-west-2"
                        });
                        $scope.$apply()
                            //actions performed on receiving MQTT messages
                        $scope.things[i].device
                            .on('message', $scope.processIncomingMessages);

                        //MQTT connect the thing to AWS IoT
                        //IIFE is necessary to store the thing reference used by the inner callbacks 
                        (function () {
                            var thing = $scope.things[i];
                            thing.device
                                .on('connect', function () {
                                    if (thing) {
                                        //$scope.log('MQTT connected');
                                        //$scope.log('want to subscribe to topics for thing '+thing.thingName);
                                        var topic = '$aws/things/' + thing.thingName + '/shadow/#';
                                        //subscribe is async so we have to wait the callback is fired before publishing (otherwise we may not receive responses to our first requests)
                                        thing.device.subscribe(topic, {
                                            qos: parseInt($scope.qos)
                                        }, function (err, granted) {
                                            if (err) $scope.log('Error on subscribing : ' + err);
                                            //$scope.log('subscribed topics : '+JSON.stringify(granted));
                                            //get properties-values with MQTT                                                      
                                            thing.device.publish('$aws/things/' + thing.thingName + '/shadow/get', null, {
                                                qos: parseInt($scope.qos)
                                            });

                                        });
                                    }

                                });
                        })();



                    }
                    $scope.buildThingTypeIndex();
                    $scope.buildThingIndex();
                    $scope.$apply();


                }
            })
        }


        $scope.buildThingTypeIndex = function () {
            //$scope.log('building thing type index')
            $scope.thingTypeIndex = {}
            for (var i = 0; i < $scope.things.length; i++) {
                if (!$scope.thingTypeIndex[$scope.things[i].thingTypeName]) {
                    $scope.thingTypeIndex[$scope.things[i].thingTypeName] = [];
                }
                $scope.thingTypeIndex[$scope.things[i].thingTypeName].push(i);

            }
            //$scope.log('thing type index '+JSON.stringify($scope.thingTypeIndex))
        }


        $scope.buildThingIndex = function () {
            //$scope.log('building thing index');
            $scope.thingIndex = {};
            for (var i = 0; i < $scope.things.length; i++) {
                $scope.thingIndex[$scope.things[i].thingName] = i;
            }
            //$scope.log('thing  index : '+JSON.stringify($scope.thingIndex))

        }




        //gives the thing type index based on the thing type name
        $scope.getThingTypeIndex = function (name) {
            return $scope.thingTypeIndex[name];
        }

        $scope.getThingIndex = function (name) {
            return $scope.thingIndex[name];
        }




        $scope.createThing = function () {
            //check the thing name isn't already in use
            for (var key in $scope.thingIndex) {
                if ($scope.newThing.thingName == key) {
                    $scope.log('Thing name already in use.');
                    return;
                }

            }
            //thing creation on AWS
            var params = {
                thingName: $scope.newThing.thingName,
                thingTypeName: $scope.newThing.thingTypeName.toString()
            }
            iot.createThing(params, function (err, data) {
                if (err) $scope.log(err);
                else {
                    //$scope.log(JSON.stringify(data))          
                    //attach the certificate to the thing on AWS
                    var params = {
                        principal: 'arn:aws:iot:us-west-2:023980856765:cert/c84c370d61cc8d3f189d5d8d4e2485d75877a4d1d90f0cc996abeca7e05b560e',
                        'thingName': $scope.newThing.thingName
                    };
                    iot.attachThingPrincipal(params, function (err, data) {
                        if (err) $scope.log(err);
                    });
                    $scope.listThings();
                    $scope.newThing = {
                        "thingName": "",
                        "thingTypeName": ""
                    };
                }
            });

        }


        $scope.addProperty = function () {
            var count = 0;
            var selectedThing = null;
            for (var i = 0; i < $scope.things.length; i++) {
                if ($scope.things[i].selected) {
                    count++;
                    selectedThing = i;
                }
            }
            if (count > 1) $scope.log('More than one thing selected. Please select one thing only.');
            else if (count == 0) $scope.log('Please select one thing.');
            else {
                $scope.things[selectedThing].state.push({
                    propName: $scope.newPropertyName,
                    propValue: ""
                });
                $scope.things[selectedThing].reported.push({
                    propName: $scope.newPropertyName,
                    propValue: ""
                });
                $scope.things[selectedThing].desired.push({
                    propName: $scope.newPropertyName,
                    propValue: ""
                });
                $scope.send();
            }

        };






        $scope.send = function () {
            for (var i = 0; i < $scope.things.length; i++) {
                var doc = {
                    state: {}
                };
                doc.state = {
                    reported: {}
                };
                for (var j = 0; j < $scope.things[i].state.length; j++) {
                    doc.state.reported[$scope.things[i].state[j].propName] = $scope.things[i].state[j].propValue;
                }

                for (var prop in doc.state.reported) {
                    if (doc.state.reported[prop] == "null") {
                        doc.state.reported[prop] = null;
                    }
                }
                $scope.things[i].device.publish('$aws/things/' + $scope.things[i].thingName + '/shadow/update', JSON.stringify(doc), {
                    qos: parseInt($scope.qos)
                });
            }
        }

        $scope.copyThing = function () {
            var count = 0;
            var selectedThing = null;
            for (var i = 0; i < $scope.things.length; i++) {
                if ($scope.things[i].selected) {
                    count++;
                    selectedThing = i;
                }
            }
            if (count > 1) $scope.log('More than one thing selected. Please select one thing only.');
            else if (count == 0) $scope.log('Please select one thing.');
            else {
                for (var j = 0; j < $scope.copies.number; j++) {

                    (function () {
                        //$scope.log('firstSuffix : '+$scope.copies.firstSuffix);
                        //$scope.log('firstSuffix : '+$scope.copies.firstSuffix);

                        var index = parseInt($scope.copies.firstSuffix) + j;
                        var newThingName = $scope.copies.basename + index.toString();
                        //$scope.log(newThingName);
                        var alreadyExists = false;
                        //check the thing name is not already in use
                        for (var k = 0; k < $scope.things.length; k++) {
                            if (newThingName == $scope.things[k].thingName) {
                                $scope.log('The name ' + newThingName + ' is already in use.');
                                alreadyExists = true;
                                break;
                            }
                        }
                        if (!alreadyExists) {

                            //thing creation on AWS
                            var params = {
                                thingName: newThingName,
                                thingTypeName: $scope.things[selectedThing].thingTypeName
                            }
                            iot.createThing(params, function (err, data) {
                                if (err) $scope.log(err);
                                else {
                                    $scope.things.push({
                                        thingName: newThingName
                                    });
                                    $scope.buildThingIndex();
                                    var index = $scope.getThingIndex(newThingName);
                                    //$scope.log(JSON.stringify(data))          
                                    //attach the certificate to the thing on AWS
                                    var params = {
                                        principal: 'arn:aws:iot:us-west-2:023980856765:cert/c84c370d61cc8d3f189d5d8d4e2485d75877a4d1d90f0cc996abeca7e05b560e',
                                        'thingName': newThingName
                                    };

                                    iot.attachThingPrincipal(params, function (err, data) {
                                        if (err) $scope.log(err);
                                        else {
                                            var copyOfSelectedThing = extend($scope.things[selectedThing], {});
                                            $scope.things[index]['thingTypeName'] = copyOfSelectedThing.thingTypeName;
                                            $scope.things[index]['selected'] = false;
                                            $scope.things[index]['state'] = [];
                                            $scope.things[index]['reported'] = [];
                                            $scope.things[index]['desired'] = [];
                                            $scope.things[index]['device'] = devicesdk.device({
                                                keyPath: "c84c370d61-private.pem.key",
                                                certPath: "c84c370d61-certificate.pem.crt",
                                                caPath: "rootCA.pem.crt",
                                                clientId: $scope.things[index].thingName,
                                                region: "us-west-2"
                                            });
                                            $scope.$apply()
                                                //actions performed on receiving MQTT messages
                                            $scope.things[index].device
                                                .on('message', $scope.processIncomingMessages);

                                            (function () {
                                                var thing = $scope.things[index];
                                                thing.device
                                                    .on('connect', function () {
                                                        if (thing) {
                                                            //$scope.log('MQTT connected');
                                                            //$scope.log('want to subscribe to topics for thing '+thing.thingName);
                                                            var topic = '$aws/things/' + thing.thingName + '/shadow/#';
                                                            //subscribe is async so we have to wait the callback is fired before publishing (otherwise we may not receive responses to our first requests)
                                                            thing.device.subscribe(topic, {
                                                                qos: parseInt($scope.qos)
                                                            }, function (err, granted) {
                                                                if (err) $scope.log('Error on subscribing : ' + err);
                                                                //$scope.log('subscribed topics : '+JSON.stringify(granted));
                                                                //get properties-values with MQTT     
                                                                else {
                                                                    var doc = {
                                                                        state: {}
                                                                    };
                                                                    doc.state = {
                                                                        reported: {}
                                                                    };

                                                                    for (var j = 0; j < $scope.things[selectedThing].state.length; j++) {
                                                                        doc.state.reported[$scope.things[selectedThing].state[j].propName] = $scope.things[selectedThing].state[j].propValue;
                                                                    }

                                                                    for (var prop in doc.state.reported) {
                                                                        if (doc.state.reported[prop] == "null") {
                                                                            doc.state.reported[prop] = null;
                                                                        }
                                                                    }
                                                                    $scope.things[index].device.publish('$aws/things/' + $scope.things[index].thingName + '/shadow/update', JSON.stringify(doc), {
                                                                        qos: parseInt($scope.qos)
                                                                    });

                                                                }

                                                            });

                                                        }

                                                    });
                                            })();
                                        }
                                    });

                                }
                            });
                        }
                    })();

                }

            }
        }


        $scope.deleteThings = function () {



            for (var i = 0; i < $scope.things.length; i++) {
                (function () {
                    if ($scope.things[i].selected) {
                        var thingName = $scope.things[i].thingName;
                        var params = {
                            principal: 'arn:aws:iot:us-west-2:023980856765:cert/c84c370d61cc8d3f189d5d8d4e2485d75877a4d1d90f0cc996abeca7e05b560e',
                            thingName: thingName
                        };
                        iot.detachThingPrincipal(params, function (err, data) {
                            if (err) $scope.log(err, err.stack);
                            else {
                                var params = {
                                    thingName: thingName
                                };
                                iot.deleteThing(params, function (err, data) {
                                    if (err) $scope.log(err, err.stack);
                                    else {
                                        var index = $scope.getThingIndex(thingName);
                                        $scope.things.splice(index, 1);
                                        $scope.buildThingIndex();
                                        $scope.$apply();
                                    }
                                });

                            }
                        });








                    }
                })();
            }




        }



        $scope.generateData2 = function () {

            var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
            //$scope.log($scope.things.length);
            for (var i = 0; i < $scope.things.length; i++) {
                if ($scope.things[i].selected) {
                    for (var j = 0; j < $scope.things[i].state.length; j++) {
                        var text = "";
                        for (var k = 0; k < 5; k++)
                            text += possible.charAt(Math.floor(Math.random() * possible.length));
                        $scope.things[i].state[j].propValue = text;
                    }
                    var doc = {
                        state: {}
                    };
                    doc.state = {
                        reported: {}
                    };

                    for (var j = 0; j < $scope.things[i].state.length; j++) {
                        doc.state.reported[$scope.things[i].state[j].propName] = $scope.things[i].state[j].propValue;
                    }

                    $scope.things[i].device.publish('$aws/things/' + $scope.things[i].thingName + '/shadow/update', JSON.stringify(doc), {
                        qos: parseInt($scope.qos)
                    });
                    $scope.sentUpdates++;
                }
            }


        }



        $scope.startGenerateData2 = function () {
            $scope.dataGenerator.idToClearInterval = setInterval($scope.generateData2, 1000 / $scope.dataGenerator.rate);
        }

        $scope.stopGenerateData2 = function () {
            clearInterval($scope.dataGenerator.idToClearInterval);
        }

        $scope.resetCounters = function () {
            $scope.sentUpdates = 0;
            $scope.receivedUpdates = 0;
        }


        $scope.processIncomingMessages = function (topic, payload) {

            var regexThingName = /aws\/things\/(.*)\/shadow/;

            var thingName = topic.match(regexThingName)[1];

            //$scope.log('thingName we will retrieve the index : '+thingName);
            var thingIndex = $scope.getThingIndex(thingName);
            var thing = $scope.things[thingIndex];


            //if the thing still exists
            if (thing) {

                if (topic.match(/get\/accepted/) != null) {
                    var data = JSON.parse(payload);

                    for (var prop in data.state.reported) {

                        var foundInState = false;
                        var foundInReported = false;

                        for (var i = 0; i < thing.state.length; i++) {
                            if (thing.state[i].propName == prop) {
                                foundInState = true;
                                break;
                            }
                        }
                        if (!foundInState) {
                            thing['state'].push({
                                propName: prop,
                                propValue: data.state.reported[prop]
                            });
                        }
                        for (var i = 0; i < thing.reported.length; i++) {
                            if (thing.reported[i].propName == prop) {
                                foundInReported = true;
                                break;
                            }
                        }
                        if (!foundInReported) {
                            thing['reported'].push({
                                propName: prop,
                                propValue: data.state.reported[prop]
                            });
                        }

                    }
                    for (var prop in data.state.desired) {

                        var foundInDesired = false;
                        for (var i = 0; i < thing.desired.length; i++) {
                            if (thing.desired[i].propName == prop) {
                                foundInDesired = true;
                                break;
                            }
                        }
                        if (!foundInDesired) {
                            thing['desired'].push({
                                propName: prop,
                                propValue: data.state.desired[prop]
                            });
                        }


                    }


                }


                if (topic.match(/update\/accepted/) != null) {
                    $scope.receivedUpdates++;
                    var data = JSON.parse(payload);

                    for (var prop in data.state.reported) {

                        var foundInReported = false;

                        for (var i = 0; i < thing.reported.length; i++) {
                            if (thing.reported[i].propName == prop) {
                                foundInReported = true;
                                if (data.state.reported[prop] == null)
                                    thing.reported.splice(i, 1);
                                else
                                    thing['reported'][i] = {
                                        propName: prop,
                                        propValue: data.state.reported[prop]
                                    };
                                break;
                            }
                        }
                        if (!foundInReported) {
                            thing['reported'].push({
                                propName: prop,
                                propValue: data.state.reported[prop]
                            });
                        }
                        for (var i = 0; i < thing.state.length; i++) {
                            if (thing.state[i].propName == prop) {
                                if (data.state.reported[prop] == null)
                                    thing.state.splice(i, 1);
                                break;
                            }
                        }
                        for (var i = 0; i < thing.desired.length; i++) {
                            if (thing.desired[i].propName == prop) {
                                if (data.state.reported[prop] == null)
                                    thing.desired.splice(i, 1);
                                break;
                            }
                        }

                    }
                    for (var prop in data.state.desired) {
                        var foundInDesired = false;
                        for (var i = 0; i < thing.desired.length; i++) {
                            if (thing.desired[i].propName == prop) {
                                foundInDesired = true;
                                if (data.state.desired[prop] == null)
                                    thing.desired.splice(i, 1);
                                else
                                    thing['desired'][i] = {
                                        propName: prop,
                                        propValue: data.state.desired[prop]
                                    };
                                break;
                            }
                        }
                        if (!foundInDesired) {
                            thing['desired'].push({
                                propName: prop,
                                propValue: data.state.desired[prop]
                            });
                        }



                    }


                }






            }
            $scope.$apply();
        }




        //simulator start
        $scope.start = function () {
            if (!($scope.qos in $scope.allowedQos)){
                $scope.log('Select QoS');
            }
            else{
            $scope.started = true;
            $scope.listThingTypes();
            //retrieve thing types list from the things registry on AWS
            $scope.listThings();                
            }

        }


        var iot = new awssdk.Iot(options = {
            region: 'us-west-2'
        })




    }])