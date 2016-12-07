/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016, Joyent, Inc.
 */

/*
 * Library for standing up temporary Moray instances
 */

'use strict';

var assert = require('assert-plus');
var getOpenStack = require('./client').getOpenStack;
var TemporaryPostgres = require('./pg-server').TemporaryPostgres;


// --- Exports


function createMockPostgres(log, callback) {
    assert.object(log, 'log');
    assert.func(callback, 'callback');
    return new TemporaryPostgres(log, callback);
}


function createMockMorayAndPG(log, callback) {
    assert.object(log, 'log');
    assert.func(callback, 'callback');

    var stack = getOpenStack();

    createMockPostgres(log, function (pErr, pg) {
        if (pErr) {
            callback(pErr);
            return;
        }
        pg._spawnMoray(stack, function (err, moray) {
            callback(err, moray, pg);
        });
    });
}


module.exports = {
    createPG: createMockPostgres,
    create: createMockMorayAndPG
};
