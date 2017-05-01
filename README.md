<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright 2017, Joyent, Inc.
-->

# node-moray-sandbox

This repository is part of the Joyent Manta and Triton projects. For
contribution guidelines, issues, and general documentation, visit the main
[Triton](https://github.com/joyent/triton) and
[Manta](https://github.com/joyent/manta) project pages.

## Overview

This is a node library for spinning up a temporary Moray server that can be
used for unit testing programs that depend on Moray. Before running, make
sure that you have at least Postgres 9.2 installed. On both Mac OS X and
SmartOS:

```
pkgin in postgresql92-client postgresql92-server
```

Each additional Moray connected to a Postgres instance maintains an additional
set of connections to the database. With enough Moray instances running, you
can hit Postgres' maximum connection limit, which will prevent spawning new
instances. This is normally not an issue, but can be easy to hit with Postgres
9.2 on Mac OS X, where the max is 20. If that happens to you, newer versions of
Postgres can help alleviate the issue.

## Examples

You can spawn a new temporary Moray instance by running:

```js
var mod_moray_sandbox = require('moray-sandbox');

mod_moray_sandbox.create(log, function (err, moray) {
    // Do what you need with the client, and then shutdown Moray:
    moray.stop();
});
```

If you need multiple Moray clients that point to the same server, you can
use the client's `.clone()` method to create a new one with the same
configuration:

```js
var clone1 = moray.clone();
var clone2 = moray.clone();
```

If you need to create multiple Moray instances, you can avoid the overhead
of initializing multiple Postgres instances by doing:

```js
var mod_moray_sandbox = require('moray-sandbox');

mod_moray_sandbox.createPG(log, function (err, pg) {
    pg.spawnMoray(function (err, moray1) {
        // Do what you need with the client of Moray instance #1
    });
    pg.spawnMoray(function (err, moray2) {
        // Do what you need with the client of Moray instance #2
    });
    // Once finished, call moray1.close(), moray2.close(), and pg.stop()
});
```

Note that the library consumer is responsible for calling `.close()` on every
client it creates via `.create()`, `.spawnMoray()`, and `.clone()` before
stopping Postgres. If there is only a single client, for convenience, you can
call `.stop()` on a client and it will handle closing the client for you before
stopping Postgres.

If you want to test your application's ability to handle errors, you can
inject a series of errors to be returned by future Moray client calls. For
example, to make the first call to `.batch()` actually call out to Moray,
and the second one return a fake error, you can do:

```js
moray.setMockErrors({ batch: [ null, fakeErr, fakeErr, null ] });
```

Passing in `null` in the array allows you to interleave successes and
failures. If you want to check that your errors have been dequeued, you can
get the remaining mock errors. For example, if `.batch()` should have only
been called three times after setting the mock errors earlier:

```js
var assert = require('assert-plus');

var remaining = moray.getMockErrors();
assert.deepEqual({ batch: [ null ] }, remaining, 'batch() called thrice');
```

You can clear out any remaining errors by calling the method with
an empty object:

```js
moray.setMockErrors({ });
```

Clients created using `.clone()` share mock errors with the original client.
