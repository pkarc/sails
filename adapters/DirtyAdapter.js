// Dependencies
var async = require('async');
var _ = require('underscore');
var dirty = require('dirty');
var parley = require('parley');
var uuid = require('node-uuid');

// ******************************************
// Poor man's auto-increment
// ******************************************
// In production, the transaction database should be set to something else 
// with true, database-side auto-increment capabilities
// This in-memory auto-increment will not scale to a multi-instance / cluster setup.
// ******************************************
var statusDb = {};

/*---------------------
	:: DirtyAdapter
	-> adapter

	*this refers to the adapter
---------------------*/

// This disk+memory adapter is for development only!
// Learn more: https://github.com/felixge/node-dirty
var adapter = module.exports = {

	config: {

		// Attributes are case insensitive by default
		// attributesCaseSensitive: false,
		// What persistence scheme is being used?  
		// Is the db dropped & recreated each time or persisted to disc?
		persistent: false,

		// File path for disk file output (in persistent mode)
		dbFilePath: './.waterline/dirty.db',

		// String to precede key name for schema defininitions
		schemaPrefix: 'sails_schema_',

		// String to precede key name for actual data in collection
		dataPrefix: 'sails_data_'
	},

	// Initialize the underlying data model
	initialize: function(cb) {
		var my = this;

		if(this.config.persistent) {
			// Check that dbFilePath file exists and build tree as necessary
			require('fs-extra').touch(this.config.dbFilePath, function(err) {
				if(err) return cb(err);
				my.db = new(dirty.Dirty)(my.config.dbFilePath);
				afterwards();
			});
		} else {
			this.db = new(dirty.Dirty)();
			afterwards();
		}

		function afterwards() {
			// Make logger easily accessible
			my.log = my.config.log;

			// Trigger callback with no error
			my.db.on('load', function() {
				cb();
			});
		}
	},

	// Tear down any remaining connections to the underlying data model
	teardown: function(cb) {
		this.db = null;
		cb && cb();
	},


	// Fetch the schema for a collection
	describe: function(collectionName, cb) {
		var schema, err;
		try {
			schema = this.db.get(this.config.schemaPrefix + collectionName);
		} catch(e) {
			err = e;
		}
		this.log(" DESCRIBING :: " + collectionName, {
			err: err,
			schema: schema
		});
		return cb(err, schema);
	},

	// Create a new collection
	define: function(collectionName, schema, cb) {
		this.log(" DEFINING " + collectionName, {
			as: schema
		});
		var self = this;

		// Write schema and status objects
		return self.db.set(this.config.schemaPrefix + collectionName, schema, function(err) {
			if(err) return cb(err);

			// Set auto-increment for this collection
			statusDb[collectionName] = {
				autoIncrement: 1
			};

			cb();
		});
	},

	// Drop an existing collection
	drop: function(collectionName, cb) {
		var self = this;
		self.log(" DROPPING " + collectionName);
		return self.db.rm(self.config.dataPrefix + collectionName, function(err) {
			if(err) return cb("Could not drop collection!");
			return self.db.rm(self.config.schemaPrefix + collectionName, cb);
		});
	},

	// Extend the schema for an existing collection
	alter: function(collectionName, newAttrs, cb) {
		this.log(" ALTERING " + collectionName);
		this.db.describe(collectionName, function(e0, existingSchema) {
			if(err) return cb(collectionName + " does not exist!");
			var schema = _.extend(existingSchema, newAttrs);
			return this.db.set(this.config.schemaPrefix + collectionName, schema, cb);
		});
	},



	// Create one or more new models in the collection
	create: function(collectionName, values, cb) {
		this.log(" CREATING :: " + collectionName, values);
		values = values || {};
		var dataKey = this.config.dataPrefix + collectionName;
		var data = this.db.get(dataKey);
		var self = this;


		// Auto increment fields that need it
		// console.log("Auto-incrementing...");
		values = self.autoIncrement(collectionName, values);

		// Verify constraints using Anchor
		// TODO: verify constraints
		// Populate default values
		self.describe(collectionName, function(err, description) {
			if(err) return cb(err);

			// Add updatedAt and createdAt
			if(description.createdAt) values.createdAt = new Date();
			if(description.updatedAt) values.updatedAt = new Date();

			// TODO: add other fields with default values
			// Create new model
			// (if data collection doesn't exist yet, create it)
			data = data || [];
			data.push(values);

			// Replace data collection and go back
			self.db.set(dataKey, data, function(err) {
				return cb(err, values);
			});
		});

	},

	// Find one or more models from the collection
	// using where, limit, skip, and order
	// In where: handle `or`, `and`, and `like` queries
	find: function(collectionName, options, cb) {

		var criteria = options.where;

		////////////////////////////////////////////////
		// TODO: Make this shit actually work
		var limit = options.limit;
		var skip = options.skip;
		var order = options.order;
		////////////////////////////////////////////////
		var dataKey = this.config.dataPrefix + collectionName;
		var data = this.db.get(dataKey);

		// Query and return result set using criteria
		cb(null, applyFilter(data, criteria));
	},

	// Update one or more models in the collection
	update: function(collectionName, options, values, cb) {
		this.log(" UPDATING :: " + collectionName, {
			options: options,
			values: values
		});
		var my = this;

		var criteria = options.where;

		////////////////////////////////////////////////
		// TODO: Make this shit actually work
		var limit = options.limit;
		var skip = options.skip;
		var order = options.order;
		////////////////////////////////////////////////
		var dataKey = this.config.dataPrefix + collectionName;
		var data = this.db.get(dataKey);

		// Query result set using criteria
		var resultIndices = [];
		_.each(data, function(row, index) {
			my.log('matching row/index', {
				row: row,
				index: index
			});
			my.log("against", criteria);
			my.log("with outcome", matchSet(row, criteria));

			if(matchSet(row, criteria)) resultIndices.push(index);
		});
		this.log("filtered indices::", resultIndices, 'criteria', criteria);

		// Update value(s)
		_.each(resultIndices, function(index) {
			data[index] = _.extend(data[index], values);
		});

		// Replace data collection and go back
		this.db.set(dataKey, data, function(err) {
			cb(err, values);
		});
	},

	// Delete one or more models from the collection
	destroy: function(collectionName, options, cb) {
		this.log(" DESTROYING :: " + collectionName, options);

		var criteria = options.where;

		////////////////////////////////////////////////
		// TODO: Make this shit actually work
		var limit = options.limit;
		var skip = options.skip;
		var order = options.order;
		////////////////////////////////////////////////
		var dataKey = this.config.dataPrefix + collectionName;
		var data = this.db.get(dataKey);

		// Query result set using criteria
		data = _.reject(data, function(row, index) {
			return matchSet(row, criteria);
		});

		// Replace data collection and go back
		this.db.set(dataKey, data, function(err) {
			cb(err);
		});
	},


	// Look for auto-increment fields, increment counters accordingly, and return refined values
	autoIncrement: function(collectionName, values) {
		// Lookup schema & status so we know all of the attribute names and the current auto-increment value
		var schema = this.db.get(this.config.schemaPrefix + collectionName);
		var self = this;

		// increment AI fields in values set
		var keys = _.keys(_.extend({}, schema, values));
		_.each(keys, function(attrName) {
			if(_.isObject(schema[attrName]) && schema[attrName].autoIncrement) {
				values[attrName] = statusDb[collectionName].autoIncrement;

				// Then, increment the auto-increment counter for this collection
				statusDb[collectionName].autoIncrement++;
			}
		});

		return values;
	},


	// Identity is here to facilitate unit testing
	// (this is optional and normally automatically populated based on filename)
	identity: 'dirty'
};



//////////////                 //////////////////////////////////////////
////////////// Private Methods //////////////////////////////////////////
//////////////                 //////////////////////////////////////////
// Run criteria query against data aset

function applyFilter(data, criteria) {
	if(criteria && data) {
		return _.filter(data, function(model) {
			return matchSet(model, criteria);
		});
	} else return data;
}


// Match a model against each criterion in a criteria query

function matchSet(model, criteria) {
	// Null WHERE query always matches everything
	if(!criteria) return true;

	// By default, treat entries as AND
	for(var key in criteria) {
		if(!matchItem(model, key, criteria[key])) return false;
	}
	return true;
}


function matchOr(model, disjuncts) {
	var outcome = false;
	_.each(disjuncts, function(criteria) {
		if(matchSet(model, criteria)) outcome = true;
	});
	return outcome;
}

function matchAnd(model, conjuncts) {
	var outcome = true;
	_.each(conjuncts, function(criteria) {
		if(!matchSet(model, criteria)) outcome = false;
	});
	return outcome;
}

function matchLike(model, criteria) {
	for(var key in criteria) {
		// Make attribute names case insensitive unless overridden in config
		if(!adapter.config.attributesCaseSensitive) key = key.toLowerCase();

		// Check that criterion attribute and is at least similar to the model's value for that attr
		if(!model[key] || (!~model[key].indexOf(criteria[key]))) {
			return false;
		}
	}
	return true;
}

function matchNot(model, criteria) {
	return !matchSet(model, criteria);
}

function matchItem(model, key, criterion) {
	// Make attribute names case insensitive unless overridden in config
	if(!adapter.config.attributesCaseSensitive) key = key.toLowerCase();

	if(key.toLowerCase() === 'or') {
		return matchOr(model, criterion);
	} else if(key.toLowerCase() === 'not') {
		return matchNot(model, criterion);
	} else if(key.toLowerCase() === 'and') {
		return matchAnd(model, criterion);
	} else if(key.toLowerCase() === 'like') {
		return matchLike(model, criterion);
	}
	// Otherwise this is an attribute name: ensure it exists and matches
	else if(!model[key] || (model[key] !== criterion)) {
		return false;
	}
	return true;
}

// Number of miliseconds since the Unix epoch Jan 1st, 1970

function epoch() {
	return(new Date()).getTime();
}

// Return the oldest lock in the collection

function getOldest(locks) {
	var currentLock;
	_.each(locks, function(lock) {
		if(!currentLock) currentLock = lock;
		else if(lock.timestamp < currentLock.timestamp) currentLock = lock;
	});
	return currentLock;
}