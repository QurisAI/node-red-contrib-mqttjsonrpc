var WebSocketServer = require('rpc-websockets').Server;

// instantiate Server and start listening for requests
var server = new WebSocketServer({
    port: 8080,
    host: 'localhost'
});

// register an RPC method
server.register('sum', function(params) {
    return params[0] + params[1];
});

// create an event
server.event('feedUpdated');

// get events (getter method)
console.log(server.eventList());

// emit an event to subscribers
server.emit('feedUpdated');

server.on('error', err => {
    console.log(err.message);
});
