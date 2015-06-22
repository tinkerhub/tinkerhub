
var EventEmitter = require('events').EventEmitter;

var Q = require('q');
var seq = 0;

function RemoteDevice(net, def) {
    this._net = net;

    this._debug = require('debug')('th.device.' +  def.id);
    this._emitter = new EventEmitter();
    this._listeners = [];

    this._promises = {};

    this.metadata = {
        def: def,
        id: def.id,
        local: false,
        remote: true
    };
}

RemoteDevice.prototype.receiveEvent = function(event, payload) {
    this._debug('Emitting event', event, 'with payload', payload);

    this._emitter.emit(event, payload);
    this._listeners.forEach(function(listener) {
        listener(event, payload);
    });
};

RemoteDevice.prototype.on = function(event, listener) {
    this._emitter.on(event, listener);
};

RemoteDevice.prototype.onAll = function(listener) {
    this._listeners.push(listener);
};

RemoteDevice.prototype.call = function(action, args) {
    var deferred = Q.defer();

    var id = seq++;
    if(seq > 10000) seq = 0;

    this._promises[id] = deferred;

    this._net.send(this.metadata.def.peer, 'device:invoke', {
        id: this.metadata.def.id,
        seq: id,
        action: action,
        arguments: args
    });

    return deferred.promise;
};

RemoteDevice.prototype.receiveReply = function(message) {
    var deferred = this._promises[message.seq];
    if(message.error) {
        deferred.reject(new Error(message.error));
    } else {
        deferred.resolve(message.result);
    }
    delete this._promises[message.seq];
};

module.exports = RemoteDevice;
