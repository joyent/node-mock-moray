/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016, Joyent, Inc.
 */

/*
 * Mock client object for accessing a temporary Moray instance
 */

'use strict';

var assert = require('assert-plus');
var clone = require('clone');
var EventEmitter = require('events').EventEmitter;
var mod_moray_client = require('moray');
var VError = require('verror');


// --- Internals


function emitFakeErr(err) {
    var res = new EventEmitter();
    setImmediate(function () {
        res.emit('error', err);
    });
    return res;
}


// --- Exports


function MockMorayClient(opts) {
    assert.object(opts, 'opts');
    assert.object(opts.log, 'opts.log');
    assert.object(opts.pgmgr, 'opts.pgmgr');
    assert.object(opts.stack, 'opts.stack');
    assert.object(opts.config, 'opts.config');
    assert.string(opts.morayID, 'opts.morayID');
    assert.optionalObject(opts.mock_errors, 'opts.mock_errors');

    this.closed = false;
    this.stack = opts.stack;
    this.morayID = opts.morayID;

    this._pgmgr = opts.pgmgr;
    this._config = opts.config;
    this._config.log = opts.log;
    this._client = mod_moray_client.createClient(this._config);
    this.log = opts.log;

    if (opts.mock_errors) {
        this._mock_errors = opts.mock_errors;
    } else {
        this._mock_errors = {
           last_moray_error: null,
           errors: {}
        };
    }

    this._pgmgr.addClient(this);

    Object.seal(this);
}


/**
 * If there's an error in _mock_errors for the given operation, return it.
 */
MockMorayClient.prototype._getNextError = function (op, details) {
    var mock_errors = this._mock_errors;
    if (!mock_errors.errors.hasOwnProperty(op) ||
        !Array.isArray(mock_errors.errors[op]) ||
        mock_errors.errors[op].length === 0) {
        return null;
    }

    var morayErr = mock_errors.errors[op].shift();

    // Allow passing null in the array to allow interleaving successes
    // and errors.
    if (morayErr === null) {
        return null;
    }

    mock_errors.last_moray_error = clone(details);
    mock_errors.last_moray_error.op = op;
    mock_errors.last_moray_error.msg = morayErr.message;

    return morayErr;
};


MockMorayClient.prototype.getMockErrors = function getMockErrors() {
    return this._mock_errors.errors;
};


MockMorayClient.prototype.setMockErrors = function setMockErrors(errors) {
    assert.object(errors, 'errors');
    this._mock_errors.errors = errors;
};


MockMorayClient.prototype.getLastMockError = function getLastMockError() {
    return this._mock_errors.last_moray_error;
};


MockMorayClient.prototype.batch = function batchProxy(data, opts, callback) {
    var cb = (typeof (opts) === 'function' ? opts : callback);
    var err = this._getNextError('batch', { batch: data });
    if (err) {
        cb(err);
        return;
    }

    this._client.batch.apply(this._client, arguments);
};


MockMorayClient.prototype.close = function closeProxy() {
    if (!this.closed) {
        this._pgmgr.removeClient(this);
    }

    this.closed = true;
    this._client.close.apply(this._client, arguments);
};


MockMorayClient.prototype.createBucket =
    function createBucketProxy(bucket, schema, opts, callback) {
    var cb = (typeof (opts) === 'function' ? opts : callback);
    var details = { bucket: bucket, schema: schema };
    var err = this._getNextError('createBucket', details);
    if (err) {
        cb(err);
        return;
    }

    this._client.createBucket.apply(this._client, arguments);
};


MockMorayClient.prototype.delBucket =
    function deleteBucketProxy(bucket, opts, callback) {
    var cb = (typeof (opts) === 'function' ? opts : callback);
    var err = this._getNextError('delBucket', { bucket: bucket });
    if (err) {
        cb(err);
        return;
    }

    this._client.delBucket.apply(this._client, arguments);
};
MockMorayClient.prototype.deleteBucket = MockMorayClient.prototype.delBucket;


MockMorayClient.prototype.listBuckets =
    function listBucketsProxy(opts, callback) {
    var cb = (typeof (opts) === 'function' ? opts : callback);
    var err = this._getNextError('listBuckets', {});
    if (err) {
        cb(err);
        return;
    }

    this._client.listBuckets.apply(this._client, arguments);
};


MockMorayClient.prototype.delObject =
    function delObjectProxy(bucket, key, opts, callback) {
    var cb = (typeof (opts) === 'function' ? opts : callback);
    var err = this._getNextError('delObject',
        { bucket: bucket, key: key });
    if (err) {
        cb(err);
        return;
    }

    this._client.delObject.apply(this._client, arguments);
};
MockMorayClient.prototype.deleteObject = MockMorayClient.prototype.delObject;


MockMorayClient.prototype.deleteMany =
    function deleteManyProxy(bucket, filter, opts, callback) {
    var cb = (typeof (opts) === 'function' ? opts : callback);
    var err = this._getNextError('deleteMany',
        { bucket: bucket, filter: filter });
    if (err) {
        cb(err);
        return;
    }

    this._client.deleteMany.apply(this._client, arguments);
};


MockMorayClient.prototype.findObjects =
    function findObjectsProxy(bucket, filter) {
    var details = { bucket: bucket, filter: filter };
    var err = this._getNextError('findObjects', details);
    if (err) {
        return emitFakeErr(err);
    }

    return this._client.findObjects.apply(this._client, arguments);
};
MockMorayClient.prototype.find = MockMorayClient.prototype.findObjects;


MockMorayClient.prototype.getBucket =
    function getBucketProxy(bucket, opts, callback) {
    var cb = (typeof (opts) === 'function' ? opts : callback);
    var err = this._getNextError('getBucket', { bucket: bucket });
    if (err) {
        cb(err);
        return;
    }

    this._client.getBucket.apply(this._client, arguments);
};


MockMorayClient.prototype.getObject =
    function getObjectProxy(bucket, key, opts, callback) {
    var cb = (typeof (opts) === 'function' ? opts : callback);
    var err = this._getNextError('getObject', { bucket: bucket, key: key });
    if (err) {
        cb(err);
        return;
    }

    this._client.getObject.apply(this._client, arguments);
};


MockMorayClient.prototype.putObject =
    function putObjectProxy(bucket, key, value, opts, callback) {
    var cb = (typeof (opts) === 'function' ? opts : callback);
    var details = { bucket: bucket, key: key, value: value };
    var err = this._getNextError('putObject', details);
    if (err) {
        cb(err);
        return;
    }

    this._client.putObject.apply(this._client, arguments);
};


MockMorayClient.prototype.reindexObjects =
    function reindexObjectsProxy(bucket, count, opts, callback) {
    var cb = (typeof (opts) === 'function' ? opts : callback);
    var details = { bucket: bucket, count: count };
    var err = this._getNextError('reindexObjects', details);
    if (err) {
        cb(err);
        return;
    }

    this._client.reindexObjects.apply(this._client, arguments);
};


MockMorayClient.prototype.sql = function sqlProxy(sql, args) {
    var err = this._getNextError('sql', { sql: sql, args: args });
    if (err) {
        return emitFakeErr(err);
    }

    return this._client.sql.apply(this._client, arguments);
};


MockMorayClient.prototype.updateBucket =
    function updateBucketProxy(bucket, schema, opts, callback) {
    var cb = (typeof (opts) === 'function' ? opts : callback);
    var err = this._getNextError('updateBucket',
        { bucket: bucket, schema: schema });
    if (err) {
        cb(err);
        return;
    }

    this._client.updateBucket.apply(this._client, arguments);
};


MockMorayClient.prototype.putBucket =
    function putBucketProxy(bucket, schema, opts, callback) {
    var cb = (typeof (opts) === 'function' ? opts : callback);
    var err = this._getNextError('putBucket',
        { bucket: bucket, schema: schema });
    if (err) {
        cb(err);
        return;
    }

    this._client.putBucket.apply(this._client, arguments);
};


MockMorayClient.prototype.updateObjects =
    function updateObjectsProxy(bucket, fields, filter, opts, callback) {
    var cb = (typeof (opts) === 'function' ? opts : callback);
    var err = this._getNextError('updateObjects',
        { bucket: bucket, fields: fields, filter: filter });
    if (err) {
        cb(err);
        return;
    }

    this._client.updateObjects.apply(this._client, arguments);
};


MockMorayClient.prototype.versionInternal =
    function versionInternalProxy(opts, callback) {
    var cb = (typeof (opts) === 'function' ? opts : callback);
    var err = this._getNextError('versionInternal', { });
    if (err) {
        cb(err);
        return;
    }

    this._client.versionInternal.apply(this._client, arguments);
};


MockMorayClient.prototype.on = function onProxy() {
    this._client.on.apply(this._client, arguments);
};


MockMorayClient.prototype.once = function onceProxy() {
    this._client.once.apply(this._client, arguments);
};


MockMorayClient.prototype.removeListener = function removeListenerProxy() {
    this._client.removeListener.apply(this._client, arguments);
};


/**
 * Create a clone of this client that shares the same mock errors. This means
 * that they use different versions of the real Moray client, so .close() will
 * only affect one and not the other.
 */
MockMorayClient.prototype.clone = function duplicateClient() {
    return new MockMorayClient({
        log: this.log,
        pgmgr: this._pgmgr,
        config: this._config,
        morayID: this.morayID,
        mock_errors: this._mock_errors,
        stack: getOpenStack()
    });
};


MockMorayClient.prototype.stop = function destroyPG() {
    this.close();
    this._pgmgr.stop();
};


function getOpenStack() {
    return new VError({
        name: 'PGStopError',
        constructorOpt: getOpenStack
    }, 'Cannot stop PG until all clients are closed; client opened at:');
}


module.exports = {
    getOpenStack: getOpenStack,
    MockMorayClient: MockMorayClient
};
