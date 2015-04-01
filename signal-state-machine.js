var signal = require('signal-js');
	extend = function(base) {
	    var args = arguments,
	        idx = 1, length = args.length,
	        key, merger;
	    for (; idx < length; idx++) {
	        merger = args[idx];

	        for (key in merger) {
	            base[key] = merger[key];
	        }
	    }

	    return base;
	};

var ASYNC = 'async',
	WILDCARD = '*',
	error = {
		INVALID_TRANSITION: 100, // caller tried to fire an event that was innapropriate in the current state
		PENDING_TRANSITION: 200, // caller tried to fire an event while an async transition was still pending
		INVALID_CALLBACK:   300  // caller provided callback function threw an exception
	},
	result = {
		SUCCEEDED:    1, // the event transitioned successfully from one state to another
		NOTRANSITION: 2, // the event was successfull but no state transition was necessary
		CANCELLED:    3, // the event was cancelled by the caller in a beforeEvent callback
		PENDING:      4  // the event is asynchronous and the caller is in control of when the transition occurs
	};

var stateMachine = function(config) {

	// configuration ==========

	var opts = config || {};

	var api = signal();

	var current = 'none';
	// Allow user to handle error if configured
	// otherwise use the default behavior when something unexpected happens
	var error = opts.error || function(name, from, to, args, error, msg) { throw msg; };

	// Assign a terminal state if one doesn't exists
	var terminal = opts.terminal || opts.final;

	// Allow for a simple string, or an object with { state: 'foo', event: 'setup', defer: true|false }
	var initial = typeof opts.initial === 'string' ? { state: opts.initial } : opts.initial,
		map = {};

	// private ==========
	
	var _beforeEvent = function(name, from, to, args) {
		if (api.trigger('before' + name, name, from, to, args) === false ||
			api.trigger('beforeEvent', name, from, to, args) === false) {
			return false;
		}
	};

	var _afterEvent = function(name, from, to, args) {
		api.trigger('afterThisEvent', name, from, to, args);
		api.trigger('afterAnyEvent', name, from, to, args);
	};

	var _leaveState = function(name, from, to, args) {
		var specific = api.trigger('leave' + from, name, from, to, args),
			general  = api.trigger('leaveState', name, from, to, args);

		if (specific === false || general === false) {
			return false;
		}

		if (specific === ASYNC || general === ASYNC) {
			return ASYNC;
		}

		return true;
	};

	var _enterState = function(name, from, to, args) {
		api.trigger('enterThisState', name, from, to, args);
		api.trigger('enterAnyState', name, from, to, args);
	};

	// builders ==========

	var _add = function(e) {
		// Allow 'wildcard' transition if 'from' is not specified
		var from = Array.isArray(e.from) ? e.from : (e.from ? [e.from] : [WILDCARD]);

		// Make sure the object exists
		map[e.name] = map[e.name] || {};

		var idx = 0, length = from.length;
		for (; idx < length; idx++) {
			// allow no-op transition if 'to' is not specified
			map[e.name][from[idx]] = e.to || from[idx];
		}
	};

	var _buildEvent = function(name, eventmap) {
		return function event() {

	        // prevent this function from being de-optimized
	        // because of using the arguments:
	        // http://reefpoints.dockyard.com/2014/09/22/javascript-performance-for-the-win.html
	        var a = arguments,
	            length = a.length,
	            args;

	        if (length) {
	            var idx = 0;
	            args = new Array(length);
	            for (; idx < length; idx += 1) {
	                args[idx] = a[idx];
	            }
	        } else {
	        	args = [];
	        }

			var from = current,
				to   = eventmap[from] || eventmap[WILDCARD] || from;

			if (event.transition) {
				return error(name, from, to, args, error.PENDING_TRANSITION, 'event ' + name + ' inappropriate because previous transition did not complete');
			}

			if (api.cannot(name)) {
				return error(name, from, to, args, error.INVALID_TRANSITION, 'event ' + name + ' inappropriate in current state ' + current);
			}

			if (_beforeEvent(name, from, to, args) === false) {
				return result.CANCELLED;
			}

			if (from === to) {
				_afterEvent(name, from, to, args);
				return result.NOTRANSITION;
			}

			// prepare a transition method for use EITHER lower down,
			// or by caller if they want an async transition
			// (indicated by an ASYNC return value from leaveState)
			event.transition = function() {
				event.transition = null;
				current = to;
				api.trigger(name, from, to, args);
				_enterState(name, from, to, args);
				api.trigger('changeState', name, from, to, args);
				_afterEvent(name, from, to, args);
				return result.SUCCEEDED;
			};

			// provide a way for caller to cancel async transition if desired
			event.transition.cancel = function() {
				event.transition = null;
				_afterEvent(name, from, to, args);
			};

			// Need to check in case user manually called transition()
			// but forgot to return stateMachine.ASYNC
			var leave = this._leaveState(name, from, to, args);
			if (leave === false) {
				event.transition = null;
				return result.CANCELLED;
			}

			if (leave === ASYNC) {
				return result.PENDING;
			}

			if (event.transition) {
				return event.transition();
			}
		};
	};

	// api setup ==========
	
	if (initial) {
		initial.event = initial.event || 'startup';
		_add({ name: initial.event, from: 'none', to: initial.state });
	}

	(config.events || []).forEach(_add);

	Object.keys(map).forEach(function(eventname) {
		api[eventname] = _buildEvent(eventname, map[eventname]);
	});

	if (initial && !initial.defer) {
		api[initial.event]();
	}

	// public api ==========

	return extend(api, {
		can: function(event) {
			return !transition && (map[event][current] || map[event][WILDCARD]);
		},

		cannot: function(event) {
			return !can(event);
		},

		isFinished: function() {
			return Array.isArray(terminal) ? (terminal.indexOf(current) >= 0) : (current === terminal);
		},

		state: function() {
			return current;
		}
	});
};

// Protect and expose static variables
module.exports = extend(stateMachine, {
	ASYNC:    ASYNC + '',
	WILDCARD: WILDCARD + '',
	result:   extend({}, result),
	error:    extend({}, error)
});