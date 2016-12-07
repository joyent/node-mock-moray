/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016, Joyent, Inc.
 */

/*
 * Unit tests for basic usage
 */

'use strict';

var log = require('../lib/log');
var mod_mock_moray = require('../../lib');
var util = require('util');
var test = require('tape');


// --- Globals


var pg1, client1; // Client we store data in
var client2; // Same PG server as client 1, shouldn't see data
var client3; // Different PG server than clients 1 & 2, shouldn't see data

var BUCKET = 'test_bucket';
var BUCKET_SCHEMA = {
    name: BUCKET,
    index: {
        email: {
            type: 'string',
            unique: true
        },
        subnet: {
            type: 'subnet'
        }
    },
    options: {
        version: 1
    },
    post: [],
    pre: []
};

var OBJECT_KEY1 = 'test_key1';
var OBJECT_VALUE1 = {
    email: 'contact@example.com',
    subnet: 'fd0e::/64'
};

var OBJECT_KEY2 = 'test_key2';
var OBJECT_VALUE2 = {
    email: 'sales@example.com',
    subnet: 'fe80::/64'
};

var SQL_STR = 'SELECT * FROM %s WHERE subnet >> inet(\'fd0e::1:234\');';


// --- Setup tests


test('Initial startup', function (t) {
    t.plan(3);
    t.test('Start client 1', function (t2) {
        mod_mock_moray.create(log, function (err, mock, pg) {
            t2.ifError(err, 'Creation should succeed');
            t2.ok(mock, 'Should receive client 1');
            client1 = mock;
            pg1 = pg;
            t2.end();
        });
    });
    t.test('Start client 2', function (t2) {
        pg1.spawnMoray(function (err, mock) {
            t2.ifError(err, 'Creation should succeed');
            t2.ok(mock, 'Should receive client 1');
            client2 = mock;
            t2.end();
        });
    });
    t.test('Start client 3', function (t2) {
        mod_mock_moray.create(log, function (err, mock) {
            t2.ifError(err, 'Creation should succeed');
            t2.ok(mock, 'Should receive client 2');
            client3 = mock;
            t2.end();
        });
    });
});


// --- Client tests


test('Create and get bucket', function (t) {
    t.plan(7);
    t.test('Create bucket in client 1', function (t2) {
        client1.createBucket(BUCKET, BUCKET_SCHEMA, function (err) {
            t2.ifError(err, 'Bucket creation should succeed');
            t2.end();
        });
    });
    t.test('Get bucket from client 1', function (t2) {
        client1.getBucket(BUCKET, function (err, bucket) {
            t2.ifError(err, 'Bucket fetch should succeed');
            BUCKET_SCHEMA.mtime = bucket.mtime;
            t2.deepEqual(BUCKET_SCHEMA, bucket, 'Bucket values equal');
            t2.end();
        });
    });
    t.test('Client 2 shouldn\'t have bucket', function (t2) {
        client2.getBucket(BUCKET, function (err, bucket) {
            t2.ok(err, 'Bucket fetch should fail');
            t2.deepEqual(undefined, bucket, 'Bucket is undefined');
            t2.end();
        });
    });
    t.test('Client 3 shouldn\'t have bucket', function (t2) {
        client3.getBucket(BUCKET, function (err, bucket) {
            t2.ok(err, 'Bucket fetch should fail');
            t2.deepEqual(undefined, bucket, 'Bucket is undefined');
            t2.end();
        });
    });
    t.test('List buckets from client 1', function (t2) {
        client1.listBuckets(function (err, buckets) {
            t2.ifError(err, 'Bucket fetch should succeed');
            t2.deepEqual(buckets, [ BUCKET_SCHEMA ],
                'There should only be one bucket');
            t2.end();
        });
    });
    t.test('Client 2 shouldn\'t have any buckets', function (t2) {
        client2.listBuckets(function (err, buckets) {
            t2.ifError(err, 'Bucket fetch should succeed');
            t2.deepEqual(buckets, [ ],
                'There should only be zero buckets');
            t2.end();
        });
    });
    t.test('Client 3 shouldn\'t have any buckets', function (t2) {
        client3.listBuckets(function (err, buckets) {
            t2.ifError(err, 'Bucket fetch should succeed');
            t2.deepEqual(buckets, [ ],
                'There should only be zero buckets');
            t2.end();
        });
    });
});


test('Store and get objects', function (t) {
    t.plan(4);
    t.test('Put object 1 in bucket', function (t2) {
        client1.putObject(BUCKET, OBJECT_KEY1, OBJECT_VALUE1, function (err) {
            t2.ifError(err, 'Put should succeed');
            t2.end();
        });
    });
    t.test('Put object 2 in bucket', function (t2) {
        client1.putObject(BUCKET, OBJECT_KEY2, OBJECT_VALUE2, function (err) {
            t2.ifError(err, 'Put should succeed');
            t2.end();
        });
    });
    t.test('Get object 1 from bucket', function (t2) {
        client1.getObject(BUCKET, OBJECT_KEY1, function (err, obj) {
            t2.ifError(err, 'Get should succeed');
            t2.deepEqual(obj.value, OBJECT_VALUE1, 'Objects should be equal');
            t2.end();
        });
    });
    t.test('Get object 2 from bucket', function (t2) {
        client1.getObject(BUCKET, OBJECT_KEY2, function (err, obj) {
            t2.ifError(err, 'Get should succeed');
            t2.deepEqual(obj.value, OBJECT_VALUE2, 'Objects should be equal');
            t2.end();
        });
    });
});


test('Use SQL on bucket', function (t) {
    var res = client1.sql(util.format(SQL_STR, BUCKET));
    t.plan(1);
    res.on('record', function (r) {
        t.deepEqual(JSON.parse(r._value), OBJECT_VALUE1,
            'Objects should be equal');
    });
    res.on('error', function (err) {
        t.ifError(err, 'SQL shouldn\'t fail');
        t.end();
    });
    res.on('end', function () {
        t.end();
    });
});


test('Delete objects from bucket', function (t) {
    t.plan(2);
    t.test('Delete object 1 from bucket', function (t2) {
        client1.delObject(BUCKET, OBJECT_KEY1, function (err) {
            t2.ifError(err, 'Delete should succeed');
            t2.end();
        });
    });
    t.test('Delete object 2 from bucket', function (t2) {
        client1.delObject(BUCKET, OBJECT_KEY2, function (err) {
            t2.ifError(err, 'Delete should succeed');
            t2.end();
        });
    });
});


// --- Mock errors tests


test('Fake deleteMany() errors', function (t) {
    var client1clone = client1.clone();

    var filter = '(email=*)';

    var msg1 = 'first fake error';
    var msg2 = 'second fake error';
    var msg3 = 'unused fake error';

    var err1 = new Error(msg1);
    var err2 = new Error(msg2);
    var err3 = new Error(msg3);

    err1.name = 'FirstError';
    err2.name = 'SecondError';
    err3.name = 'UnusedError';

    var errors = {
        deleteMany: [ err1, err2 ],
        batch: [ err3 ]
    };

    t.test('set and get fake errors', function (t2) {
        client1.setMockErrors(errors);
        t2.deepEqual(client1clone.getMockErrors(), errors,
            'Clone has same errors');
        t2.end();
    });

    t.test('client1.deleteMany() returns err1', function (t2) {
        client1.deleteMany(BUCKET, filter, function (err) {
            t2.equal(err, err1, 'Error passed to callback');
            var last = {
                bucket: BUCKET,
                filter: filter,
                msg: 'first fake error',
                op: 'deleteMany'
            };
            t2.deepEqual(client1.getLastMockError(), last,
                'client1.getLastMockError()');
            t2.deepEqual(client1clone.getLastMockError(), last,
                'client1clone.getLastMockError()');
            t2.end();
        });
    });

    t.test('client1clone.deleteMany() returns err2', function (t2) {
        client1clone.deleteMany(BUCKET, filter, function (err) {
            t2.equal(err, err2, 'Correct error');
            var last = {
                bucket: BUCKET,
                filter: filter,
                msg: 'second fake error',
                op: 'deleteMany'
            };
            t2.deepEqual(client1.getLastMockError(), last,
                'client1.getLastMockError()');
            t2.deepEqual(client1clone.getLastMockError(), last,
                'client1clone.getLastMockError()');
            t2.end();
        });
    });

    t.test('no more mock deleteMany() errors', function (t2) {
        client1.deleteMany(BUCKET, filter, function (err) {
            t2.equal(err, null, 'No callback error');
            t2.end();
        });
    });

    t.test('cleanup', function (t2) {
        client1.setMockErrors({});
        client1clone.close();
        t2.end();
    });
});


test('Fake findObjects() errors w/ interleaved success', function (t) {
    var filter = '(email=contact@example.com)';

    var err1 = new Error('first fake error');
    var err2 = new Error('second fake error');
    var err3 = new Error('unused fake error');

    err1.name = 'FirstError';
    err2.name = 'SecondError';
    err3.name = 'UnusedError';

    var errors = {
        findObjects: [ err1, null, err2 ],
        batch: [ err3 ]
    };

    t.test('put object in bucket', function (t2) {
        client1.putObject(BUCKET, OBJECT_KEY1, OBJECT_VALUE1, function (err) {
            t2.ifError(err, 'putObject() error');
            t2.end();
        });
    });

    t.test('set and get fake errors', function (t2) {
        client1.setMockErrors(errors);
        t2.deepEqual(client1.getMockErrors(), errors,
            'Client returns set errors');
        t2.end();
    });

    function failedFind(expErr) {
        return function (t2) {
            var res = client1.findObjects(BUCKET, filter);
            res.on('record', function (r) {
                t2.equal(r, {}, 'Unexpected record returned');
            });
            res.on('error', function (err) {
                t2.equal(expErr, err, 'Correct error emitted');
                t2.deepEqual(client1.getLastMockError(), {
                    bucket: BUCKET,
                    filter: filter,
                    msg: expErr.message,
                    op: 'findObjects'
                }, 'client1.getLastMockError()');
                t2.end();
            });
            res.on('end', function () {
                t2.fail('findObjects() should not emit "end"');
                t2.end();
            });
        };
    }

    function successfulFind(t2) {
        var count = 0;
        var res = client1.findObjects(BUCKET, filter);
        res.on('record', function (r) {
            t2.ok(r, 'Record returned');
            t2.deepEqual(r.key, OBJECT_KEY1, 'Record has correct key');
            t2.deepEqual(r.value, OBJECT_VALUE1, 'Record has correct value');
            count += 1;
        });
        res.on('error', function (err) {
            t2.equal(err, {}, 'Unexpected error emitted');
            t2.end();
        });
        res.on('end', function () {
            t2.equal(count, 1, 'One record returned');
            t2.end();
        });
    }

    t.test('client1.findObjects() emits err1', failedFind(err1));
    t.test('client1.findObjects() uses interleaved null', successfulFind);
    t.test('client1.findObjects() emits err2', failedFind(err2));
    t.test('no more findObjects() errors', successfulFind);

    t.test('cleanup', function (t2) {
        client1.setMockErrors({});
        client1.delObject(BUCKET, OBJECT_KEY1, function (err) {
            t2.ifError(err, 'delObject() error');
            t2.end();
        });
    });
});


// --- deleteBucket() tests


test('Delete bucket', function (t) {
    t.plan(3);
    t.test('Delete invalid bucket with client 2', function (t2) {
        client2.delBucket(BUCKET, function (err) {
            t2.ok(err, 'Deleting should fail');
            t2.end();
        });
    });
    t.test('Delete invalid bucket with client 3', function (t2) {
        client3.delBucket(BUCKET, function (err) {
            t2.ok(err, 'Deleting should fail');
            t2.end();
        });
    });
    t.test('Delete valid bucket with client 1', function (t2) {
        client1.delBucket(BUCKET, function (err) {
            t2.ifError(err, 'Deleting should succeed');
            t2.end();
        });
    });
});


// --- Teardown tests


test('Shutdown server', function (t) {
    client1.close();
    client2.close();
    pg1.stop();
    client3.stop();
    t.end();
});
