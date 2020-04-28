/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018 Joyent, Inc.
 */

/*
 * Library for standing up temporary Moray instances.
 *
 * To stand up a new Moray instance, we go through the following steps:
 *
 * 1. Initialize a new DB directory w/ initdb.
 * 2. Start Postgres listening on a Unix socket.
 * 3. Create a new DB to back our Moray instance.
 * 4. Start the Moray server in standalone mode (no Manatee).
 * 5. Set up the "buckets_config" table in our new DB.
 */

'use strict';

var assert = require('assert-plus');
var mod_forkexec = require('forkexec');
var mod_fs = require('fs');
var mod_jsprim = require('jsprim');
var mod_moray_server = require('moray-server');
var mod_os = require('os');
var mod_uid_number = require('uid-number');
var mod_util = require('util');
var mod_vasync = require('vasync');
var VError = require('verror');


// --- Globals

var BIND_IP = '127.0.0.1';

var PG_CONFIG = [
    'logging_collector = on',
    'log_filename = \'postgresql.log\'',
    'listen_addresses = \'\'',
    'fsync = off',
    'synchronous_commit = off',
    'full_page_writes = off'
].join('\n');

var mkTableSQL = 'CREATE TABLE IF NOT EXISTS buckets_config ( ' +
    'name text PRIMARY KEY, ' +
    'index text NOT NULL, ' +
    'pre text NOT NULL, ' +
    'post text NOT NULL, ' +
    'options text, ' +
    'mtime timestamp without time zone DEFAULT now() NOT NULL' +
');';

var POSTGRES = 'postgres';

// --- Internal


function mkMorayConfig(log, port, connstr) {
    assert.object(log, 'log');
    assert.number(port, 'port');
    assert.string(connstr, 'connstr');

    return {
        server: {
            log: log,
            name: 'moray-sandbox',
            port: port,
            bindip: BIND_IP,
            server_uuid: '00000000-0000-0000-0000-000000000000',
            datacenter: 'sandbox',
            standalone: {
                pg: {
                    maxQueueLength: 2000,
                    maxConnections: 5
                },
                url: connstr
            }
        },
        client: {
            host: BIND_IP,
            port: port
        }
    };
}


function MoraySandbox(log, baseDir, cleanup) {
    this.log      = log;
    this.baseDir  = baseDir;
    this.dbDir    = mod_util.format('%s/db', baseDir);
    this.unixDir  = mod_util.format('%s/unix', baseDir);
    this._cleanup = cleanup;
    this.stopping = false;
    this.pg_child = null;
    this.servers  = {};
    // set to 'root' by default, we'll override these in getUserId later
    this.uid      = 0;
    this.gid      = 0;
    this.user     = null;
    this.useSu    = false;

    Object.seal(this);
}

function _chownDbDirs(self)  {
    assert.string(self.baseDir, 'self.baseDir');
    assert.string(self.unixDir, 'self.unixDir');
    assert.string(self.dbDir, 'self.dbDir');
    assert.number(self.uid, 'self.uid');
    assert.number(self.gid, 'self.gid');

    // Make and chown all directories we need.
    [self.baseDir, self.unixDir, self.dbDir].forEach(function mkdir(path) {
        if (!mod_fs.existsSync(path)) {
            mod_fs.mkdirSync(path);
        }
        mod_fs.chownSync(path, self.uid, self.gid);
    });
}

MoraySandbox.prototype._getUserId = function getUserId(callback) {
    var self = this;
    var userInfo = mod_os.userInfo();
    // if we're already running as non-root, there's no more work to do.
    if (userInfo.uid !== 0) {
        self.uid = userInfo.uid;
        self.gid = userInfo.gid;
        self.user = userInfo.username;
        // Moray's config schema won't allow us to add a user to the pg connect
        // config when running standalone, so just set this in the environment
        // instead.
        process.env.PGUSER = self.user;
        self.log.info('Already running as non-root, using uid ' + self.uid);
        _chownDbDirs(self);
        callback();
        return;
    }
    // lookup an unprivileged user, save its uid/gid, chown our basedir
    mod_uid_number(POSTGRES, function getUid(err, uid, gid) {
        if (err !== null) {
            callback(err);
            return;
        }
        self.uid = uid;
        self.gid = gid;
        self.user = POSTGRES;
        process.env.PGUSER = self.user;
        self.useSu = true;
        self.log.info(
            'We are root, so using ' + POSTGRES + ' uid ' + self.uid);
        _chownDbDirs(self);
        callback();
    });
};

MoraySandbox.prototype._initDB = function initDB(callback) {
    var self = this;
    var args = [];
    var initdb = ['initdb', '-D', self.dbDir, '-E', 'UNICODE', '-A', 'trust'];
    if (self.useSu) {
        // passing the uid/gid to forkExecWait isn't sufficient for initdb,
        // so use the bigger hammer of su to run as a non-root user.
        args = ['/usr/bin/su', self.user, '-c', initdb.join(' ')];
    } else {
        args = initdb;
    }
    self.log.info({
            cmd: args[0],
            argv: args,
            uid: self.uid,
            gid: self.gid
        }, 'Executing command');
    mod_forkexec.forkExecWait({ argv: args }, function (err, info) {
        self.log.info(info, 'Finished initdb');
        if (err) {
            callback(err);
            return;
        }

        var cfg = mod_util.format('%s/postgresql.conf', self.dbDir);
        var cfgTxt = mod_util.format('%s\nlog_directory = \'%s\'',
            PG_CONFIG, self.baseDir);
        mod_fs.appendFile(cfg, cfgTxt, function (fErr) {
            if (fErr) {
                callback(new VError(fErr, 'Failed to append to PG config'));
                return;
            }
            callback();
        });
    });
};


MoraySandbox.prototype._startPG = function startPG(callback) {
    var self = this;
    // postgres will do the right thing, no need to use su here
    var args = [ 'postgres', '-D', self.dbDir, '-k', self.unixDir];
    self.log.info({
            cmd: args[0],
            argv: args,
            uid: self.uid,
            gid: self.gid
        }, 'Executing command');
    self.pg_child = mod_forkexec.forkExecWait({
        argv: args,
        uid: self.uid,
        gid: self.gid,
        maxBuffer: 1024 * 500
    }, function (err, info) {
        if (err) {
            self.log.error(info, 'Postgres exited with an error');
        } else {
            self.log.info(info, 'Postgres exited non-fatally');
        }
        self._cleanup();
    });
    callback();
};


MoraySandbox.prototype._createDB = function createDB(req_id, callback) {
    var self = this;
    var attempt = 1;
    // postgres will do the right thing, no need to use su here
    var args = [ 'createdb', '-E', 'UNICODE', '-h', self.unixDir, req_id ];
    function retry() {
        self.log.info({
                cmd: args[0],
                argv: args,
                uid: self.uid,
                gid: self.gid,
            }, 'Executing command');
        mod_forkexec.forkExecWait({ argv: args, uid: self.uid, gid: self.gid },
            function (err, info) {
            if (err) {
                if (attempt < 5) {
                    // If PG is slow to start, createdb will fail the first time
                    self.log.error(info,
                        'Failed to create moray database; retrying');
                    attempt += 1;
                    retry();
                    return;
                } else {
                    self.log.error(info,
                        'Failed to create moray database; aborting');
                }
            } else {
                self.log.info('Created moray database');
            }
            callback(err, self.unixDir + ' ' + req_id);
        });
    }

    retry();
};


MoraySandbox.prototype._startMoray = function startMoray(opts, callback) {
    var self = this;
    var config = mkMorayConfig(self.log, opts.port, opts.connstr);
    var server = mod_moray_server.createServer(config.server);

    server.on('error', function onError(err) {
        callback(new VError(err, 'Failed to start Moray server'));
    });

    server.on('ready', function setupDB() {
        server.db_conn.pg(function (cErr, pg) {
            if (cErr) {
                callback(cErr);
                return;
            }

            pg.setRequestId(opts.req_id);

            var q = pg.query(mkTableSQL);

            q.once('error', function (err) {
                self.log.error(err, 'Error setting up database and tables');
                pg.release();
                callback(err);
            });

            q.once('end', function () {
                self.log.info('Database and tables ready');
                pg.release();
                callback(null, config.client);
            });
        });
    });
    server.listen();
    self.servers[opts.req_id] = server;
};


MoraySandbox.prototype.startDB = function startDB(req_id, port, callback) {
    var self = this;

    self._createDB(req_id, function (err, connstr) {
        if (err) {
            callback(err);
            return;
        }

        self._startMoray({
            req_id: req_id,
            connstr: connstr,
            port: port
        }, callback);
    });
};

MoraySandbox.prototype.stopDB = function stopDB(req_id, callback) {
    var server = this.servers[req_id];
    delete this.servers[req_id];

    server.on('close', callback);
    server.close();
};


MoraySandbox.prototype.stop = function stopAll() {
    var self = this;
    if (self.stopping) {
        return;
    }

    self.stopping = true;

    function killPostgres() {
        self.log.info('Killing off Postgres children');

        // Send SIGTERM to process group.
        process.kill(-process.pid, 'SIGTERM');

        // Give Postgres time to shut down before removing its files.
        setTimeout(self._cleanup, 5000);
    }

    function stopMorays() {
        var barrier = mod_vasync.barrier();
        barrier.on('drain', killPostgres);
        mod_jsprim.forEachKey(self.servers, function (req_id, server) {
            barrier.start(req_id);
            server.on('close', function () {
                barrier.done(req_id);
            });
            server.close();
        });
        self.servers = {};
    }

    if (self.pg_child !== null) {
        if (mod_jsprim.isEmpty(self.servers)) {
            killPostgres();
        } else {
            stopMorays();
        }
    } else {
        self._cleanup();
    }
};


module.exports = MoraySandbox;
