var EventEmitter = require('events').EventEmitter;
var util = require('util');
var debug = require('debug')('th.devices');

var RemoteDevice = require('./remote');
var LocalDevice = require('./local');

function Registry(net) {
    EventEmitter.call(this);

    this._net = net;

    this._localDevices = {};
    this._devices = {};

    net.on('message', this._onmessage.bind(this));
    net.on('peerConnected', this._sendDeviceListTo.bind(this));
    net.on('peerDisconnected', this._removeDevicesForPeer.bind(this));
}

util.inherits(Registry, EventEmitter);

Registry.prototype._toPublicDevice = function(device) {
    return device;
};

Registry.prototype._onmessage = function(event) {
    debug('Received message', event);
    switch(event.type) {
        case 'device':
            this._registerDevice(event.payload);
            break;
        case 'device:disconnected':
            this._removeDevice(event.payload);
            break;
        case 'device:event':
            this._handleDeviceEvent(event.payload);
            break;
        case 'device:invoke':
            this._handleDeviceInvoke(event.peer, event.payload);
            break;
        case 'device:invoke-result':
            this._handleDeviceInvokeResult(event.payload);
            break;
    }
};

Registry.prototype._registerDevice = function(def) {
    // Skip registering if we have this device locally
    if(this._localDevices[def.id]) return;

    var registered = this._devices[def.id];
    if(registered) {
        // Check if we should update our previous registration
        if(registered.def.owner === registered.def.peer &&
            def.peer !== registered.def.peer)
        {
            // The device is reachable via its owner, don't update from this peer
            return;
        }
    }

    debug('Found device ' + def.id + ' via peer ' + def.peer);

    var device = this._devices[def.id] = new RemoteDevice(this._net, def);

    this.emit('deviceConnected', this._toPublicDevice(device));
};

Registry.prototype.register = function(id, instance) {
    var device = this._localDevices[id] = this._devices[id] = new LocalDevice(this, id, instance);

    debug('New local device ' + id);

    this._net.broadcast('device', device.def);

    this.emit('deviceConnected', this._toPublicDevice(device));
};

Registry.prototype._removeDevice = function(device) {
    var registered = this._devices[id];
    if(registered.def.peer != device.peer) return;

    debug('Device ' + device.id + ' is no longer available');

    delete this._devices[device.id];
    this.emit('deviceDisconnected', this._toPublicDevice(device));
};

Registry.prototype._sendDeviceListTo = function(id) {
    debug('Telling peer ' + id + ' about our devices');

    Object.keys(this._localDevices).forEach(function(dId) {
        var device = this._devices[dId];

        // Skip sending device if we think it comes from the peer
        if(device.def.peer === id || device.def.owner === id) return;

        this._net.send(id, 'device', device.def);
    }.bind(this));
};

Registry.prototype._removeDevicesForPeer = function(peer) {
    Object.keys(this._devices).forEach(function(id) {
        var device = this._devices[id];
        if(device.def.peer == peer) {
            debug('Device ' + id + ' is no longer available');

            delete this._devices[id];
            this.emit('deviceDisconnected', this._toPublicDevice(device));
        }
    }.bind(this));
};

Registry.prototype._handleDeviceEvent = function(message) {
    var device = this._devices[message.id];
    if(! device) return;

    device.receiveEvent(message.event, message.payload);
};

Registry.prototype._handleDeviceInvoke = function(peer, message) {
    var device = this._devices[message.id];
    if(! device) {
        this._net.send(peer, 'device:invoke-result', {
            id: message.id,
            seq: message.seq,
            error: 'Unknown Device'
        });
    } else {
        var self = this;
        device.call(message.action, message.arguments)
            .then(function(value) {
                self._net.send(peer, 'device:invoke-result', {
                    id: message.id,
                    seq: message.seq,
                    result: value
                });
            }, function(err) {
                self._net.send(peer, 'device:invoke-result', {
                    id: message.id,
                    seq: message.seq,
                    error: String(err)
                });
            });
    }
};

Registry.prototype._handleDeviceInvokeResult = function(message) {
    var device = this._devices[message.id];
    if(! device) return;

    device.receiveReply(message);
};

module.exports = function(net) {
    return new Registry(net);
};
