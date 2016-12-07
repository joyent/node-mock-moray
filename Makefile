#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright 2016, Joyent, Inc.
#

#
# Mock Moray Makefile
#

#
# Tools
#

ISTANBUL	:= node_modules/.bin/istanbul
FAUCET		:= node_modules/.bin/faucet
NPM		:= npm

#
# Files
#

JS_FILES	:= $(shell find lib test -name '*.js')
JSL_CONF_NODE	= tools/jsl.node.conf
JSL_FILES_NODE	= $(JS_FILES)
JSSTYLE_FILES	= $(JS_FILES)
JSSTYLE_FLAGS	= -f tools/jsstyle.conf
ESLINT		= ./node_modules/.bin/eslint
ESLINT_CONF	= tools/eslint.node.conf
ESLINT_FILES	= $(JS_FILES)

include ./tools/mk/Makefile.defs
include ./tools/mk/Makefile.smf.defs

#
# Repo-specific targets
#

.PHONY: all
all: $(TAPE)
	$(NPM) rebuild

$(ESLINT): | $(NPM_EXEC)
	$(NPM) install

$(ISTANBUL): | $(NPM_EXEC)
	$(NPM) install

$(FAUCET): | $(NPM_EXEC)
	$(NPM) install

CLEAN_FILES += ./node_modules/

.PHONY: test
test: $(ISTANBUL) $(FAUCET)
	$(ISTANBUL) cover --print none test/unit/run.js | $(FAUCET)

.PHONY: check
check:: $(ESLINT)
	$(ESLINT) -c $(ESLINT_CONF) $(ESLINT_FILES)

include ./tools/mk/Makefile.deps
include ./tools/mk/Makefile.targ
