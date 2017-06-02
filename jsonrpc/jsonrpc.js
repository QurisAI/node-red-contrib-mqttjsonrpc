module.exports = function(RED) {
    'use strict';
    var mqtt = require('mqtt');
    var uuid = require('uuid');
    var _ = require('lodash');

    var mqttNameSpaceTopic = 'mqttjsonrpc/';
    var mqttMethodTopicBase    = mqttNameSpaceTopic + 'method/';
    var mqttResponseTopicBase  = mqttNameSpaceTopic + 'respone/';

    var state = {
        CONNECTING: 0,
        CONNECTED: 1,
        CLOSED: 2,
        FAILED: 3,
        OFFLINE: 4,
        properties: {
            0: {
                fill: 'orange',
                shape: 'dot',
                text: 'connecting'
            },
            1: {
                fill: 'green',
                shape: 'dot',
                text: 'connected'
            },
            2: {
                fill: 'red',
                shape: 'dot',
                text: 'closed'
            },
            3: {
                fill: 'red',
                shape: 'dot',
                text: 'failed'
            },
            4: {
                fill: 'red',
                shape: 'dot',
                text: 'offline'
            }
        }
    };


    // ********************
    // * MQTT Config Node * 
    // ********************
    function JsonRpcClientNode(n) {
        RED.nodes.createNode(this, n);

        // Configuration options passed by Node Red
        this.host = n.host;
        this.port = parseInt(n.port);
        this.path = n.path;

        // Node state
        
        this.users = {};
        var node = this;

        // Method for updating the state of all nodes.
        this.setState = function(newState, message) {
            node.state = newState;
            var statusConfig = state.properties[newState];
            if (message){
                statusConfig.message = message;
            }

            for (var id in node.users) {
                if (node.users.hasOwnProperty(id)) {
                    node.users[id].status(statusConfig);
                }
            }
        };

        this.setState(state.CONNECTING);

        this.connect = function () {

            console.log('subscribe');
            node.client = mqtt.connect([{
                host: this.host,
                port: this.port
            }]);
            console.log('subscribe');
            node.client.responseHandlers = {};
            node.client.methodHandlers   = {};

            // Update states
            node.client.on('connect', function (){
                node.setState(state.CONNECTED);
            });

            node.client.on('reconnect', function (){
                node.setState(state.CONNECTING, 'reconnecting');
            });

            node.client.on('close', function (){
                node.setState(state.CLOSED);
            });

            node.client.on('offline', function (){
                node.setState(state.OFFLINE);
            });

            node.client.on('error', function (error){
                node.setState(state.ERROR, 'error: ' + error.message);
                setTimeout(function() {
                    node.connect();
                }, 1000);
            });

            node.client.on('message', function (topic, msg){
                if(topic.startsWith(mqttMethodTopicBase)){
                    // Method was called
                    

                } else if (topic.startsWith(mqttResponseTopicBase)){
                    // Response called

                }

            });
        };

        this.registerResponseHandle = function (topic, handle){
            node.client.responseHandlers.topic = handle;
            node.client.subscribe(topic);
        };

        this.unregisterResponseHandle = function (topic){
            node.client.unsubscribe(topic);
            delete node.client.responseHandlers[topic];
        };

        this.callRPC = function (method, msg){
            var topic = mqttMethodTopicBase + method;
            node.client.publish(topic, JSON.stringify(msg));
        };

        this.registerMethod = function (method, handle){
            var topic = mqttMethodTopicBase + method;
            node.client.methodHandlers.topic = handle;
            node.client.subscribe(topic);
        };

        this.unregisterMethod = function (topic){
            node.client.unsubscribe(topic);
            delete node.client.methodHandlers[topic];
        };

        this.registerNode = function(rpcNode) {
            node.users[rpcNode.id] = rpcNode;
            if (Object.keys(node.users).length === 1) {
                node.connect();
            }
        };

        this.unregisterNode = function(rpcNode) {
            delete node.users[rpcNode.id];
            if (Object.keys(node.users).length === 0) {
                node.disconnect();
            }
        };

        this.on('close', function() {
            node.client.end();
        });

        console.log('te2st');
        this.connect();
    }
    RED.nodes.registerType('mqtt jsonrpc client config', JsonRpcClientNode);


    // *****************
    // * RPC Call Node *
    // *****************
    function JsonRpcCallNode(n) {
        RED.nodes.createNode(this, n);
        this.method = n.method;
        this.mqttNode = RED.nodes.getNode(n.client);

        var node = this;
        if (!this.mqttNode) {
            this.error(RED._('missing mqtt config'));
            return;
        }
        this.mqttNode.registerNode(this);
        this.mqttClient = this.mqttNode.client;


        this.on('input', function(msg) {
            var method = msg.method || node.method;

            // TODO do i have o re-fetch the clientConn?

            // Generate a unique response topic
            var mqttResponseTopic = mqttResponseTopicBase + uuid.v4(); 

            msg._rpc = {
                topic: mqttResponseTopic + uuid.v4()
            };


            node.mqttNode.registerResponseHandle(mqttResponseTopic, function(payload) {
                msg.payload = payload;
                node.send(msg);
            });

            // Make the request
            node.mqttNode.callRPC(method, msg);

            // TODO allow for timeout?
        });

        this.on('close', function(done) {
            if (node.mqttNode) {
                node.mqttNode.unregisterNode(node);
                done();
            }
        });

    }
    RED.nodes.registerType('mqtt jsonrpc call', JsonRpcCallNode);


    // ********************* 
    // * RPC Listener Node *
    // *********************
    function JsonRpcListenerNode(n) {
        RED.nodes.createNode(this, n);
        var node = this;
        this.method = n.method;
        this.mqttNode = RED.nodes.getNode(n.client);
        this.mqttNode.registerNode(this);

        if (!this.mqttNode) {
            this.error(RED._('missing client config'));
            return;
        }

        var handle = function (msg){
            node.send(msg);
        };

        this.mqttNode.registerMethod(this.method, handle);

        this.on('close', function(done) {
            console.log('closing client listener');
            if (node.mqttNode) {
                node.mqttNode.unregisterNode(node);
            }
            console.log('server listener done()');
            done();
        });
    }
    RED.nodes.registerType('mqtt jsonrpc listen', JsonRpcListenerNode);


    // ********************* 
    // * RPC Response Node *
    // *********************
    function JsonRpcResponseNode(n) {
        RED.nodes.createNode(this, n);
        this.mqttNode = RED.nodes.getNode(n.client);
        var node = this;

        this.on('input', function(msg) {
            if (!msg._rpc || !msg._rpc.topic) {
                node.warn(RED._('Missing rpc callback'));
                return;
            }

            var topic = msg._rpc.topic;
            delete msg._rpc;

            this.mqttNode.client.publish(topic, msg);
        });

        this.on('close', function(done) {
            console.log('closing client response');
            console.log('server response done()');
            done();
        });

    }
    RED.nodes.registerType('mqtt jsonrpc response', JsonRpcResponseNode);

};
