/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016, Joyent, Inc.
 */

/*
 * Object for tracking PG server state and spawning new Moray instances.
 *
 * Each instance of TemporaryPostgres spawns a new child run.js program,
 * which will take care of initializing and managing the Postgres server.
 * There are several kinds of messages that we can receive from the child:
 *
 *     - "log-file", specifying where to find the child's log
 *     - "up", indicating that Postgres is running and initialized
 *     - "error", indicating a failure in the child process
 *     - "client-info", containing a new Moray instance's configuration
 *
 * All of these but "log_file" contain a "req_id" field indicating what
 * request from TemporaryPostgres resulted in the failure.
 *
 * Message types that get sent to the child are:
 *
 *     - "createdb", which requests that a new Moray instance be started
 *       and identified by the "req_id" value
 *     - "stopdb", which requests that the instance identified by "req_id"
 *       be stopped
 *
 * The child is the session leader of its own process group, and handles
 * cleanup of the Postgres processes by signalling the group. This ensures
 * that Postgres gets terminated and its files removed even when the parent
 * terminates fatally. (This does not protect against a bug crashing run.js,
 * though; ctrun(1) can be used to wrap the parent node process, run.js and
 * Postgres in their own process contract.)
 */

'use strict';

var assert = require('assert-plus');
var mod_child = require('child_process');
var mod_client = require('./client');
var mod_uuid = require('uuid');

var getOpenStack = mod_client.getOpenStack;
var MockMorayClient = mod_client.MockMorayClient;

function TemporaryPostgres(log, callback) {
    this.clients = [];

    // Set up internal state
    this._original = mod_uuid.v4();
    this._log = log;

    // Callbacks for messages received from the child process
    this._cbs = { };
    this._cbs[this._original] = callback;

    // Stack traces to show who constructed a client
    this._stacks = { };

    // Reference counts for Moray instances
    this._refs = { };

    // Start child process
    this._child = mod_child.fork('run.js', [ this._original ], {
        cwd: __dirname,
        detached: true
    });
    this._child.on('message', this._processResponse.bind(this));

    Object.seal(this);
}


TemporaryPostgres.prototype._processResponse =
    function processResponse(response) {
    switch (response.type) {
    case 'error':
        this._log.error(response, 'Error message from Moray or Postgres');
        this._cbs[response.req_id](response);
        return;
    case 'up':
        this._log.info(response, 'Postgres server is up and running');
        this._cbs[response.req_id](null, this);
        return;
    case 'client-info':
        this._log.info(response, 'New Moray server ready');
        var client = new MockMorayClient({
            log: this._log,
            pgmgr: this,
            config: response.config,
            morayID: response.req_id,
            stack: this._stacks[response.req_id]
        });
        this._cbs[response.req_id](null, client);
        delete this._cbs[response.req_id];
        delete this._stacks[response.req_id];
        return;
    case 'log-file':
        this._log.info('Child will log to the file ' + response.path);
        return;
    default:
        this._log.error(response, 'Uknown message received from child');
        return;
    }
};


TemporaryPostgres.prototype._spawnMoray =
    function spawnNewMorayInternal(stack, callback) {
    assert.object(stack, 'stack');
    assert.func(callback, 'callback');

    var req_id = mod_uuid.v4();
    assert.ok(!this._cbs.hasOwnProperty(req_id), 'unique req_id');
    assert.ok(!this._refs.hasOwnProperty(req_id), 'unique req_id');
    assert.ok(!this._stacks.hasOwnProperty(req_id), 'unique req_id');

    this._cbs[req_id] = callback;
    this._stacks[req_id] = stack;
    this._refs[req_id] = 0;
    this._child.send({ req_id: req_id, type: 'createdb' });
};


TemporaryPostgres.prototype.spawnMoray = function spawnNewMoray(callback) {
    this._spawnMoray(getOpenStack(), callback);
};


TemporaryPostgres.prototype.addClient = function addClient(client) {
    this._refs[client.morayID] += 1;
    this.clients.push(client);
};


TemporaryPostgres.prototype.removeClient = function removeClient(client) {
    assert.number(this._refs[client.morayID], 'valid moray id');
    assert.ok(this._refs[client.morayID] > 0, 'nonzero reference count');

    this._refs[client.morayID] -= 1;

    if (this._refs[client.morayID] === 0) {
        this._child.send({ req_id: client.morayID, type: 'stopdb' });
    }
};


TemporaryPostgres.prototype.stop = function stopPostgres() {
    this.clients.forEach(function (client) {
        if (!client.closed) {
            throw client.stack;
        }
    });

    this._child.disconnect();
};


module.exports = {
    TemporaryPostgres: TemporaryPostgres
};
