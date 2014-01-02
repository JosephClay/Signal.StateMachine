/**
 * State Machine
 * Altered from https://github.com/jakesgordon/javascript-state-machine
 */
(function(Signal, _, undefined) {

	var _ASYNC = 'async',
		_WILDCARD = '*',
		_error = {
			INVALID_TRANSITION: 100, // caller tried to fire an event that was innapropriate in the current state
			PENDING_TRANSITION: 200, // caller tried to fire an event while an async transition was still pending
			INVALID_CALLBACK:   300 // caller provided callback function threw an exception
		},
		_result = {
			SUCCEEDED:    1, // the event transitioned successfully from one state to another
			NOTRANSITION: 2, // the event was successfull but no state transition was necessary
			CANCELLED:    3, // the event was cancelled by the caller in a beforeEvent callback
			PENDING:      4  // the event is asynchronous and the caller is in control of when the transition occurs
		};

	var StateMachine = Signal.core.extend(function(config, target) {

		this.current = 'none';
		// Allow user to handle error if configured
		this.error = config.error || this.error;
		// Assign a terminal state if one doesn't exists
		this.terminal = config.terminal || config['final'];
		
		var self = this,
			// Allow for a simple string, or an object with { state: 'foo', event: 'setup', defer: true|false }
			initial = this.initial = (_.isString(config.initial)) ? { state: config.initial } : config.initial,
			map = this.map = {};

		if (initial) {
			initial.event = initial.event || 'startup';
			this._add({ name: initial.event, from: 'none', to: initial.state });
		}

		_.each(config.events, function(event) {
			self._add(event);
		});

		_.each(map, function(config, eventname) {
			self[eventname] = self._buildEvent(eventname, map[eventname]);
		});

		if (initial && !initial.defer) {
			this[initial.event]();
		}

	}, {

		_add: function(e) {
			// Allow 'wildcard' transition if 'from' is not specified
			var from = _.isArray(e.from) ? e.from : (e.from ? [e.from] : [_WILDCARD]),
				map = this.map;

			// Make sure the object exists
			map[e.name] = map[e.name] || {};

			var idx = 0, length = from.length;
			for (; idx < length; idx++) {
				// allow no-op transition if 'to' is not specified
				map[e.name][from[idx]] = e.to || from[idx];
			}
		},

		can: function(event) {
			return !this.transition && (this.map[event][this.current] || this.map[event][_WILDCARD]);
		},
		
		cannot: function(event) {
			return !this.can(event);
		},

		isFinished: function() {
			return (_.isArray(this.terminal)) ? (this.terminal.indexOf(this.current) >= 0) : (this.current === this.terminal);
		},

		getState: function() {
			return this.current;
		},

		// Default behavior when something unexpected happens is to throw an exception, 
		// but caller can override this behavior if desired
		error: function(name, from, to, args, error, msg) {
			throw new Error(msg);
		},
		
		//===========================================================================

		_beforeEvent: function(name, from, to, args) {
			if (this.trigger('before:' + name, from, to, args) === false ||
				this.trigger('beforeEvent', name, from, to, args) === false) {
				return false;
			}
		},

		_afterEvent: function(name, from, to, args) {
			this.trigger('after:' + name, from, to, args);
			this.trigger('afterEvent', name, from, to, args);
		},

		_leaveState: function(name, from, to, args) {
			var specific = this.trigger('leave:' + from, name, from, to, args),
				general  = this.trigger('leaveState', name, from, to, args);

			if (specific === false || general === false) {
				return false;
			}

			if (specific === _ASYNC || general === _ASYNC) {
				return _ASYNC;
			}

			return true;
		},

		_enterState: function(name, from, to, args) {
			this.trigger('enter:' + name, from, to, args);
			this.trigger('enterState', name, from, to, args);
		},

		//===========================================================================

		_buildEvent: function(name, eventmap) {
			return function event() {

				var from = this.current,
					to = eventmap[from] || eventmap[_WILDCARD] || from,
					args = _.toArray(arguments);

				if (event.transition) {
					return this.error(name, from, to, args, _error.PENDING_TRANSITION, 'event ' + name + ' inappropriate because previous transition did not complete');
				}

				if (this.cannot(name)) {
					return this.error(name, from, to, args, _error.INVALID_TRANSITION, 'event ' + name + ' inappropriate in current state ' + this.current);
				}

				if (this._beforeEvent(name, from, to, args) === false) {
					return _result.CANCELLED;
				}

				if (from === to) {
					this._afterEvent(name, from, to, args);
					return _result.NOTRANSITION;
				}

				// prepare a transition method for use EITHER lower down,
				// or by caller if they want an async transition
				// (indicated by an ASYNC return value from leaveState)
				var self = this;
				event.transition = function() {
					event.transition = null;
					self.current = to;
					self.trigger(name, from, to, args);
					self._enterState(name, from, to, args);
					self.trigger('changeState', name, from, to, args);
					self._afterEvent(name, from, to, args);
					return _result.SUCCEEDED;
				};

				// provide a way for caller to cancel async transition if desired
				event.transition.cancel = function() {
					event.transition = null;
					self._afterEvent(name, from, to, args);
				};

				// Need to check in case user manually called transition()
				// but forgot to return StateMachine.ASYNC
				var leave = this._leaveState(name, from, to, args);
				if (leave === false) {
					event.transition = null;
					return _result.CANCELLED;
				}

				if (leave === _ASYNC) {
					return _result.PENDING;
				}

				if (event.transition) {
					return event.transition();
				}
			}.bind(this);
		}
	});

	// Expose static variables
	StateMachine.ASYNC = _ASYNC;
	StateMachine.WILDCARD = _WILDCARD;
	StateMachine.Result = _result;
	StateMachine.Error = _error;

	Signal.StateMachine = StateMachine;

}(Signal, _));
