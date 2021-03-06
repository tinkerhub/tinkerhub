'use strict';

const { metadataChanged } = require('ataraxia-services');
const definition = require('../utils/definition');
const storage = require('abstract-things/storage/api');
const values = require('abstract-things/values');

const globalStorage = storage.global();

const instanceSymbol = Symbol('instance');
const rebuild = Symbol('rebuild');
const change = Symbol('change');
const tagsSymbol = Symbol('tags');

class Adapter {
	constructor(instance) {
		this[instanceSymbol] = instance;
		this.id = instance.id;
	}

	[rebuild]() {
		const instance = this[instanceSymbol];
		return globalStorage.get('tinkerhub/' + instance.id + '/tags')
			.then(tags => {
				this[tagsSymbol] = tags || [];

				const metadata = Object.assign({}, instance.metadata);

				// First make sure the id of the instance is available in the metadata
				metadata.id = instance.id;

				// Always copy the name
				metadata.name = instance.metadata.name;

				// Create the tags of the instance
				metadata.tags = [ ...this[tagsSymbol] ];

				// If a parent is specified copy just the identifier
				if(metadata.parent) {
					metadata.parent = metadata.parent.id;
				}

				if(metadata.types) {
					for(const type of metadata.types) {
						metadata.tags.push('type:' + type);
					}
				}

				if(metadata.capabilities) {
					for(const cap of metadata.capabilities) {
						metadata.tags.push('cap:' + cap);
					}
				}

				if(! metadata.actions) {
					// Resolve all of the actions of the service being registered
					metadata.actions = {};
					for(const action of definition(instance)) {
						metadata.actions[action] = {};
					}
				}

				this.metadata = metadata;
			});
	}

	[change]() {
		return this[rebuild]()
			.then(() => this[module.exports.handle][metadataChanged]());
	}

	call(action, args) {
		args = values.fromJSON('array', args);
		switch(action) {
			case 'metadata:addTags':
			{
				const tags = this[tagsSymbol];
				for(const tag of args) {
					if(tags.indexOf(tag) === -1) {
						tags.push(tag);
					}
				}
				return globalStorage.set('tinkerhub/' + this[instanceSymbol].id + '/tags', tags)
					.then(() => this[change]());
			}
			case 'metadata:removeTags':
			{
				const tags = this[tagsSymbol];
				for(const tag of args) {
					const idx = tags.indexOf(tag);
					if(idx >= 0) {
						tags.splice(idx, 1);
					}
				}
				return globalStorage.set('tinkerhub/' + this[instanceSymbol].id + '/tags', tags)
					.then(() => this[change]());
			}
			default:
			{
				const instance = this[instanceSymbol];
				const func = instance[action];

				let promise;
				if(typeof func === 'undefined') {
					return Promise.reject(new Error('No action named ' + action));
				} else if(typeof func === 'function') {
					promise = Promise.resolve(func.apply(instance, args));
				} else {
					promise = Promise.resolve(func);
				}

				// Map all values through value converter
				return promise.then(r => values.toJSON('mixed', r));
			}
		}
	}
}

module.exports = function(instance) {
	const adapter = new Adapter(instance);
	return adapter[rebuild]()
		.then(() => adapter);
};

module.exports.handle = Symbol('handleSymbol');
module.exports.change = change;
