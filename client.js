var WebSocket = require('rpc-websockets').Client;

// instantiate Client and connect to an RPC server
var ws = new WebSocket();

console.log();


ws.on('error', function(err) {
    console.log('oopsy daisy ' + err.message);
    console.log(err)
});

ws.on('open', function() {
    console.log('WEBSOCKET OPEN FOR BUSINESS');
        // call an RPC method with parameters
    ws.call('sum', [5, 3]).then(function(result) {
        console.log('CALLED SUM' + result);
        require('assert').equal(result, 8);
    }, err => {
        console.log("ERror" + err.message);
    });

    // send a notification to an RPC server
    ws.notify('openedNewsModule');

    // subscribe to receive an event
    ws.subscribe('feedUpdated');

    ws.on('feedUpdated', function() {
        console.log('UPDATEDED AWESOME LOGIC');
        //updateLogic();
    });

    // unsubscribe from an event
    ws.unsubscribe('feedUpdated');

    // close a websocket connection
});
