module.exports = function(RED) {
    'use strict';
    var mqtt = require('mqtt');
    var uuid = require('uuid');
    var _ = require('lodash');


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
        this.namespace = n.namespace;
        this.username = n.username;
        this.password = n.password;


        // Create the config node individual namespace
        this.mqttNameSpaceTopic = 'mqttjsonrpc/' + this.namespace + '/';
        this.mqttMethodTopicBase = this.mqttNameSpaceTopic + 'method/';
        this.mqttResponseTopicBase = this.mqttNameSpaceTopic + 'response/';

        // Node state
        this.users = {};
        var node = this;

        // Method for updating the state of all nodes.
        this.setState = function(newState, message) {
            node.state = newState;
            var statusConfig = state.properties[newState];
            if (message) {
                statusConfig.message = message;
            }

            for (var id in node.users) {
                if (node.users.hasOwnProperty(id)) {
                    node.users[id].status(statusConfig);
                }
            }
        };

        this.setState(state.CONNECTING);

        this.connect = function() {

            node.client = mqtt.connect(this.host, {
                host: this.host,
                port: this.port,
                username: this.username,
                password: this.password
            });

            node.client.subscribe(node.mqttResponseTopicBase + '+');

            node.client.methodHandlers = {};
            node.client.responseHandlers = {};

            // Update client based on the state
            node.client.on('connect', function() {
                node.setState(state.CONNECTED);
            });

            node.client.on('reconnect', function() {
                node.setState(state.CONNECTING, 'reconnecting');
            });

            node.client.on('close', function() {
                node.setState(state.CLOSED);
            });

            node.client.on('offline', function() {
                node.setState(state.OFFLINE);
            });

            node.client.on('error', function(error) {
                node.setState(state.ERROR, 'error: ' + error.message);
                setTimeout(function() {
                    node.connect();
                }, 1000);
            });

            node.client.on('message', function(topic, msg) {
                var msgObject;
                try {
                    msgObject = JSON.parse(msg);

                } catch (error) {
                    node.error(RED._('Invalid JSON object: ' + msg));
                    return;
                }

                if (topic.startsWith(node.mqttMethodTopicBase)) {
                    // Method was called
                    if (_.has(node.client.methodHandlers, topic)) {
                        node.client.methodHandlers[topic](msgObject);
                    } else {
                        node.error(RED._('Invalid method topic: ' + msg + ', incorrect namespace or method not registered?'));
                        return;
                    }

                } else if (topic.startsWith(node.mqttResponseTopicBase)) {
                    // Response called
                    if (_.has(node.client.responseHandlers, topic)) {
                        node.client.responseHandlers[topic](msgObject);
                        node.unregisterResponseHandle(topic);
                    }
                } else {
                    node.error(RED._('No registered handler for the topic: ' + topic));
                }
            });
        };

        this.registerResponseHandle = function(topic, handle) {
            node.client.responseHandlers[topic] = handle;
        };

        this.unregisterResponseHandle = function(topic) {
            delete node.client.responseHandlers[topic];
        };

        this.callRPC = function(method, msg) {
            var topic = node.mqttMethodTopicBase + method;
            node.client.publish(topic, JSON.stringify(msg));
        };

        this.respond = function(msg) {
            if (!_.has(msg, '_rpc.topic')) {
                node.error(RED._('Invalid msg, no _rpc object attached.'));
                return;
            }

            var topic = msg._rpc.topic;
            delete msg._rpc;

            node.client.publish(topic, JSON.stringify(msg));
        };

        this.registerMethod = function(method, handle) {
            var topic = node.mqttMethodTopicBase + method;
            node.client.subscribe(node.mqttMethodTopicBase + '+');
            node.client.methodHandlers[topic] = handle;
        };

        this.unregisterMethod = function(method) {
            var topic = node.mqttMethodTopicBase + method;
            //TODO Fix unsubscribe
            node.client.unsubscribe(node.mqttMethodTopicBase + method);
            delete node.client.methodHandlers[topic];
        };

        this.isRegisteredMethod = function(method) {
            var topic = node.mqttMethodTopicBase + method;
            return _.has(node.client.methodHandlers, topic);
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
    }
    RED.nodes.registerType('mqtt jsonrpc client config', JsonRpcClientNode);


    // ********************
    // * RPC Request Node *
    // ********************
    function JsonRpcRequestNode(n) {
        RED.nodes.createNode(this, n);
        this.method = n.method;
        this.timeout = parseInt(n.timeout);
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
            // Generate a unique response topic
            var mqttResponseTopic = this.mqttNode.mqttResponseTopicBase + uuid.v4();

            // Add RPC to 
            msg._rpc = {
                topic: mqttResponseTopic
            };

            node.mqttNode.registerResponseHandle(mqttResponseTopic, function(msg) {
                node.send(msg);
            });

            // Make the request
            node.mqttNode.callRPC(method, msg);

            if (0 < this.timeout) {
                setTimeout(function() {
                    node.mqttNode.unregisterResponseHandle(mqttResponseTopic);
                    msg.error = {
                        message: 'Request timed out',
                        name: 'timeout'
                    };
                    node.send(msg);
                }, this.timeout);
            }
        });

        this.on('close', function(done) {
            if (node.mqttNode) {
                node.mqttNode.unregisterNode(node);
                done();
            }
        });

    }
    RED.nodes.registerType('mqtt jsonrpc request', JsonRpcRequestNode);


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

        var handle = function(msg) {
            msg._rpc.mqttNode = n.client;
            node.send(msg);
        };

        this.mqttNode.registerMethod(this.method, handle);

        this.on('close', function(done) {
            if (node.mqttNode) {
                node.mqttNode.unregisterNode(node);
            }
            done();
        });
    }
    RED.nodes.registerType('mqtt jsonrpc listen', JsonRpcListenerNode);


    // ********************* 
    // * RPC Response Node *
    // *********************
    function JsonRpcResponseNode(n) {
        RED.nodes.createNode(this, n);
        var node = this;

        this.on('input', function(msg) {
            if (!msg._rpc || !msg._rpc.topic || !msg._rpc.mqttNode) {
                node.warn(RED._('Missing rpc callback'));
                return;
            }

            var mqttNodeId = msg._rpc.mqttNode;
            var mqttNode = RED.nodes.getNode(mqttNodeId);
            mqttNode.respond(msg);
        });

        this.on('close', function(done) {
            done();
        });

    }
    RED.nodes.registerType('mqtt jsonrpc response', JsonRpcResponseNode);

};
