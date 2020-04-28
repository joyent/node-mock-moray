/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016, Joyent, Inc.
 */

/*
 * This file is run in its own process via child_process.fork(), and
 * communicates with its parent via process.on('message', ...) and
 * process.send(). See pg-server.js for further details on how the
 * two interact.
 */

'use strict';

var assert = require('assert-plus');
var MoraySandbox = require('./sandbox');
var mod_bunyan = require('bunyan');
var mod_tmp = require('tmp');
var mod_vasync = require('vasync');

var fmt = require('util').format;

// --- Globals

var ORIGINAL_REQ = process.argv[2];

var LOG_FILE =
    (process.env.TMPDIR || '/tmp') + '/moray-sandbox-log-' + process.pid;

var sandbox;
var log = mod_bunyan.createLogger({
    name: 'moray-sandbox',
    streams: [ {
        level: (process.env.LOG_LEVEL || 'info'),
        path: LOG_FILE
    } ]
});


function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min)) + min;
}


function getRandomPort() {
    return getRandomInt(2000, 10000);
}


function haltPG() {
    if (sandbox) {
        sandbox.stop();
    }
}

process.on('disconnect', haltPG);
process.on('SIGTERM', haltPG);

process.send({ type: 'log-file', path: LOG_FILE });

// Create a temporary directory under $TMPDIR (or /tmp when it's not present).
mod_tmp.dir({ unsafeCleanup: true }, function (dErr, path, cleanup) {
    if (dErr) {
        process.send({
            type: 'error',
            req_id: ORIGINAL_REQ,
            err: dErr.stack,
            message: dErr.message
        });
        return;
    }
    sandbox = new MoraySandbox(log, path, cleanup);
    log.info('Starting up sandboxed Moray instance');
    mod_vasync.pipeline({
        'funcs': [
            function (_, cb) { sandbox._getUserId(cb); },
            function (_, cb) { sandbox._initDB(cb); },
            function (_, cb) { sandbox._startPG(cb); }
        ]
    }, function (err) {
        if (err) {
            log.error(err, 'Postgres setup failed');
            process.send({
                type: 'error',
                req_id: ORIGINAL_REQ,
                err: err.stack,
                message: err.message
            });
            sandbox.stop();
        } else {
            // We've successfully set up Postgres. Start listening to incoming
            // messages and reply to the parent.
            log.info('Moray/Postgres setup succeeded');
            process.on('message', function (message) {
                switch (message.type) {
                case 'createdb':
                    createdb(message.req_id, message.port || getRandomPort());
                    return;
                case 'stopdb':
                    stopdb(message.req_id);
                    return;
                default:
                    log.error(message,
                        'Child received unknown message from parent');
                    process.send({
                        type: 'error',
                        req_id: message.req_id,
                        message: fmt('Unknown message type: %j', message.type)
                    });
                    return;
                }
            });
            process.send({
                type: 'up',
                req_id: ORIGINAL_REQ,
                unixDir: sandbox.unixDir
            });
        }
    });
});


function createdb(req_id, port) {
    assert.uuid(req_id, 'req_id');
    assert.number(port, 'port');

    sandbox.startDB(req_id, port, function (err, params) {
        if (err) {
            log.error(err, 'Creating new Moray instance failed');
            process.send({
                type: 'error',
                req_id: req_id,
                err: err.stack,
                message: err.message
            });
        } else {
            process.send({
                type: 'client-info',
                req_id: req_id,
                config: params
            });
        }
    });
}


function stopdb(req_id) {
    assert.uuid(req_id, 'req_id');
    sandbox.stopDB(req_id, function () {
        log.info({ req_id: req_id }, 'stopped moray instance');
    });
}
