/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016, Joyent, Inc.
 */

/*
 * Bunyan logger for tests
 */

'use strict';

module.exports = require('bunyan').createLogger({
    name: 'sandbox-test',
    level: (process.env.LOG_LEVEL || 'fatal'),
    stream: process.stderr
});
