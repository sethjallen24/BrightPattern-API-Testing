(function () {
  'use strict';

  var DEFAULT_TENANT = 'clearinsights.brightpattern.com';
  var ADAPTER_PATH = '/agent/crmembedded/adapters/api.js';

  // Public methods of the adapter class, taken from the adapter source. Each wraps
  // apiCall(COMMAND, args) and resolves with {status: 'success' | 'error', ...}.
  // Argument names are minified in the source, so only the obvious ones are named;
  // "[]" marks arguments the adapter wraps into an array when a single value is passed.
  var METHODS = {
    getLoginState: [], openLogin: [], logout: [],
    getAgentState: [], setAgentState: ['state', 'reason'], getAgentNotReadyReasons: [],
    getInteractionsState: [],
    acceptInteraction: ['interactionId'], rejectInteraction: ['interactionId'],
    startCall: ['arg1', 'arg2 []', 'arg3'],
    startChat: ['arg1', 'arg2', 'arg3 []', 'arg4'],
    startEmail: ['arg1', 'arg2 []', 'arg3'],
    sendDtmf: ['arg1', 'arg2'],
    consultCall: ['arg1'],
    blindTransfer: ['arg1', 'arg2', 'arg3'],
    transfer: ['arg1'],
    leaveInteraction: ['interactionId'],
    completeInteraction: ['interactionId'],
    leaveAndCompleteInteraction: ['interactionId', 'arg2', 'arg3'],
    switchActiveInteraction: ['interactionId'],
    inviteToCallConference: ['arg1', 'arg2', 'arg3'],
    removeFromCallConference: ['arg1', 'arg2'],
    destroyCallConference: ['arg1'],
    inviteToChatConference: ['arg1', 'arg2'],
    removeFromChatConference: ['arg1', 'arg2'],
    mergeAllCallsIntoConference: ['arg1'],
    getTeams: [], getTeamMembers: ['arg1'],
    getServicesList: [], getService: [], setService: ['service'],
    getDIDNumbersList: [], getDIDNumber: [], setDIDNumber: ['did'],
    getDispositionsList: ['arg1'], setDisposition: ['arg1', 'arg2'],
    addNote: ['arg1', 'arg2'], updateNote: ['arg1', 'arg2'], replaceNote: ['arg1', 'arg2'],
    setRescheduleWindow: ['arg1', 'arg2'],
    getConfig: [],
    setVariable: ['arg1', 'arg2', 'arg3'], getVariables: ['arg1', 'arg2'],
    addInteractionAssociatedObject: ['arg1', 'arg2'],
    setInteractionActiveScreen: ['arg1', 'arg2'],
    getPhoneDevicesList: [], getPhoneDevice: [], setPhoneDevice: ['device'],
    setCallHold: ['arg1', 'arg2'], setCallRecording: ['arg1', 'arg2'], setCallMute: ['arg1', 'arg2'],
    setCallRecordingMute: ['arg1', 'arg2'],
    setScreenRecordingMute: ['arg1'], getScreenRecordingState: [],
    setWidgetMinimized: ['minimized'],
    sendChatMessage: ['arg1', 'arg2'], suggestChatMessage: ['arg1', 'arg2', 'arg3'],
    activatePage: [],
    setDialCandidates: ['arg1'],
    getChatTranscript: ['arg1'], getVoiceTranscript: ['arg1']
  };

  // Events the adapter accepts in .on(name, handler). needResponse events expect the
  // handler's return value (or promise) to be sent back to Agent Desktop.
  var EVENTS = {
    ON_LOGIN: false, ON_LOGOUT: false, ON_NEW_INTERACTION: false, ON_INTERACTION_REMOVED: false,
    ON_INTERACTION_STATE_CHANGE: false, ON_ACTIVE_INTERACTION_SWITCHED: false,
    ON_AGENT_STATE_CHANGE: false, ON_REQUEST_TRANSFER_DATA: true, ON_LOAD_TRANSFER_DATA: false,
    ON_GET_KNOWLEDGE_BASE_FOLDER: true, ON_SEARCH_KNOWLEDGE_BASE: true,
    ON_GET_KNOWLEDGE_BASE_ARTICLE: true, ON_OPEN_RECORD: false, ON_SEARCH_RECORDS: false,
    ON_SHOW_SCREEN: false, ON_SCREEN_RECORDING_STATE_CHANGE: false,
    ON_WIDGET_MINIMIZED_CHANGE: false, ON_SERVER_ERROR: false, ON_SOFTPHONE_STATUS_CHANGE: false,
    ON_AUDIO_DEVICE_CHANGE: false, ON_PHONE_CAPABILITIES_CHANGE: false,
    ON_CALL_AUDIO_QUALITY_ALERT: false, ON_SUMMARY_GENERATION_STARTED: false,
    ON_SUMMARY_GENERATION_COMPLETED: false, ON_WEB_SCREEN_POP_CUSTOM: true,
    ON_SAVE_ACTIVITY_RECORD: true, ON_VALIDATE_ASSOCIATED_RECORDS: true,
    ON_REQUEST_RECORD_INFO: true, ON_REQUEST_RECORD_ON_SCREEN: true,
    ON_VOICE_TRANSCRIPT_MESSAGE: false
  };

  // Adapter prototype members that are plumbing rather than API calls.
  var INTERNAL = ['constructor', 'log', 'injectMessageLogger', 'onCommWidgetReady',
    'prepareApiProxyIframe', 'prepareAdcIframe', 'handleIncomingMessage', 'isDuplicateEvent',
    'registerListeners', 'runResponseTimeoutWatch', 'sendPacketToCommWidget', 'postAPIMessage',
    'apiCall', 'on', 'remove'];

  var $ = function (sel) { return document.querySelector(sel); };
  var adapter = null;
  var showRaw = false;

  // ---- config (kept in the URL hash: the adapter forwards location.search to the widget) --

  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }

  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* ignore */ }
  }

  function readConfig() {
    var hash = new URLSearchParams(window.location.hash.slice(1));
    var tenant = hash.get('tenant') || storageGet('bp.tenant') || DEFAULT_TENANT;
    tenant = tenant.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    return {
      tenant: tenant,
      origin: 'https://' + tenant,
      standalone: hash.get('standalone') === '1',
      disableNewInteractionPopup: hash.get('noPopup') === '1',
      adaptiveWidth: hash.get('adaptive') !== '0',
      integrationKey: hash.get('integrationKey') || '',
      globalName: hash.get('global') || ''
    };
  }

  // ---- logging -----------------------------------------------------------

  function format(value) {
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value, null, 2); } catch (e) { return String(value); }
  }

  function log(kind, title, payload) {
    var item = document.createElement('li');
    item.className = 'log-' + kind;
    var head = document.createElement('div');
    head.className = 'log-head';
    head.textContent = new Date().toLocaleTimeString() + '  [' + kind + ']  ' + title;
    item.appendChild(head);
    if (arguments.length > 2) {
      var pre = document.createElement('pre');
      pre.textContent = format(payload);
      item.appendChild(pre);
    }
    $('#log').prepend(item);
    if (window.console) console.log('[bp ' + kind + ']', title, payload);
  }

  // Receives every protocol packet the adapter sends or receives, as (type, params).
  function messageLogger(type, params) {
    if (Object.prototype.hasOwnProperty.call(EVENTS, type)) {
      log('event', type + (EVENTS[type] ? ' (expects response)' : ''),
          params.length === 1 ? params[0] : params);
    } else if (type === 'ready' || type === 'comm-widget-ready') {
      log('info', 'widget: ' + type);
      if (type === 'comm-widget-ready') setBadge('widget ready', 'ok');
    } else if (showRaw) {
      log('raw', type, params);
    }
  }

  // ---- adapter discovery ---------------------------------------------------

  function isAdapterClass(v) {
    return typeof v === 'function' && v.prototype &&
      typeof v.prototype.apiCall === 'function' && typeof v.prototype.on === 'function';
  }

  function isAdapterInstance(v) {
    return v && typeof v === 'object' && typeof v.apiCall === 'function' && typeof v.on === 'function';
  }

  function resolvePath(path) {
    return path.split('.').reduce(function (obj, key) { return obj == null ? obj : obj[key]; }, window);
  }

  // The adapter's global name isn't documented, so look for a new global (or one level
  // below it) that has the adapter's shape. ?#global=Some.Path overrides the search.
  function findAdapter(globalsBefore, globalName) {
    if (globalName) {
      var v = resolvePath(globalName);
      return (isAdapterClass(v) || isAdapterInstance(v)) ? { path: globalName, value: v } : null;
    }
    var fresh = Object.getOwnPropertyNames(window).filter(function (k) { return !globalsBefore[k]; });
    for (var i = 0; i < fresh.length; i++) {
      var top = safeGet(window, fresh[i]);
      if (isAdapterClass(top) || isAdapterInstance(top)) return { path: fresh[i], value: top };
      if (top && (typeof top === 'object' || typeof top === 'function')) {
        var keys = Object.keys(top);
        for (var j = 0; j < keys.length; j++) {
          var inner = safeGet(top, keys[j]);
          if (isAdapterClass(inner) || isAdapterInstance(inner)) {
            return { path: fresh[i] + '.' + keys[j], value: inner };
          }
        }
      }
    }
    return null;
  }

  function safeGet(obj, key) {
    try { return obj[key]; } catch (e) { return undefined; }
  }

  function prototypeMethods(instance) {
    var names = [];
    for (var proto = Object.getPrototypeOf(instance); proto && proto !== Object.prototype;
         proto = Object.getPrototypeOf(proto)) {
      Object.getOwnPropertyNames(proto).forEach(function (n) {
        if (typeof proto[n] === 'function' && INTERNAL.indexOf(n) === -1 && names.indexOf(n) === -1) {
          names.push(n);
        }
      });
    }
    return names.sort();
  }

  // ---- calling -------------------------------------------------------------

  function invoke(name, args) {
    if (!adapter) {
      log('error', name + ': adapter is not initialised');
      return;
    }
    if (typeof adapter[name] !== 'function') {
      log('error', name + ': not a method of the adapter');
      return;
    }
    log('call', name, args);
    var ret;
    try {
      ret = adapter[name].apply(adapter, args);
    } catch (err) {
      log('error', name + ' threw', String(err && err.stack || err));
      return;
    }
    if (ret && typeof ret.then === 'function') {
      ret.then(function (res) {
        var failed = res && res.status === 'error';
        log(failed ? 'error' : 'result', name + (failed ? ' → error' : ' → ' + (res && res.status)), res);
      }, function (err) {
        log('error', name + ' rejected', String(err));
      });
    } else if (ret !== undefined) {
      log('result', name + ' (return)', ret);
    }
  }

  // Values that look like JSON objects/arrays/strings/booleans/null are parsed; anything
  // else (including numbers, so phone numbers keep leading zeros) stays a string.
  function parseArg(raw) {
    var s = raw.trim();
    if (/^[\[{"]/.test(s) || s === 'true' || s === 'false' || s === 'null') {
      try { return JSON.parse(s); } catch (e) { /* fall through to string */ }
    }
    return raw;
  }

  // Empty fields become undefined; trailing undefined args are dropped.
  function collectArgs(values) {
    var args = values.map(function (v) { return v === '' ? undefined : parseArg(v); });
    while (args.length && args[args.length - 1] === undefined) args.pop();
    return args;
  }

  // ---- UI ------------------------------------------------------------------

  function setBadge(text, state) {
    var badge = $('#adapter-status');
    badge.textContent = 'adapter: ' + text;
    badge.dataset.state = state;
  }

  function renderMethodPicker(names) {
    var select = $('#method');
    select.innerHTML = '';
    names.forEach(function (name) {
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name + (METHODS[name] ? '' : '  (not in spec)');
      select.appendChild(opt);
    });
    renderArgFields();
  }

  function renderArgFields() {
    var name = $('#method').value;
    var params = METHODS[name] || ['arg1', 'arg2', 'arg3'];
    var box = $('#method-args');
    box.innerHTML = '';
    if (!params.length) {
      box.innerHTML = '<span class="muted">no arguments</span>';
      return;
    }
    params.forEach(function (p) {
      var input = document.createElement('input');
      input.type = 'text';
      input.spellcheck = false;
      input.placeholder = p;
      box.appendChild(input);
    });
  }

  function renderEvents() {
    var list = $('#event-list');
    Object.keys(EVENTS).forEach(function (name) {
      var li = document.createElement('li');
      li.textContent = name + (EVENTS[name] ? ' *' : '');
      list.appendChild(li);
    });
  }

  function wireControls(config) {
    $('#tenant').value = config.tenant;
    $('#opt-standalone').checked = config.standalone;
    $('#opt-no-popup').checked = config.disableNewInteractionPopup;
    $('#opt-adaptive').checked = config.adaptiveWidth;
    $('#opt-key').value = config.integrationKey;

    $('#tenant-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var tenant = $('#tenant').value.trim() || DEFAULT_TENANT;
      storageSet('bp.tenant', tenant);
      var hash = new URLSearchParams({ tenant: tenant });
      if ($('#opt-standalone').checked) hash.set('standalone', '1');
      if ($('#opt-no-popup').checked) hash.set('noPopup', '1');
      if (!$('#opt-adaptive').checked) hash.set('adaptive', '0');
      if ($('#opt-key').value.trim()) hash.set('integrationKey', $('#opt-key').value.trim());
      if (config.globalName) hash.set('global', config.globalName);
      window.location.hash = hash.toString();
      window.location.reload();
    });

    document.querySelectorAll('[data-call]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var selectors = btn.dataset.args ? btn.dataset.args.split(',') : [];
        invoke(btn.dataset.call, collectArgs(selectors.map(function (s) { return $(s.trim()).value; })));
      });
    });

    $('#method').addEventListener('change', renderArgFields);
    $('#method-call').addEventListener('click', function () {
      var values = Array.prototype.map.call($('#method-args').querySelectorAll('input'),
        function (i) { return i.value; });
      invoke($('#method').value, collectArgs(values));
    });

    $('#show-raw').addEventListener('change', function (e) { showRaw = e.target.checked; });
    $('#clear-log').addEventListener('click', function () { $('#log').innerHTML = ''; });
  }

  // ---- bootstrapping -------------------------------------------------------

  function start(config, found) {
    var options = {
      mountRoot: $('#widget-root'),
      standalone: config.standalone,
      disableNewInteractionPopup: config.disableNewInteractionPopup,
      adaptiveWidth: config.adaptiveWidth
    };
    if (config.integrationKey) options.integrationKey = config.integrationKey;

    if (isAdapterClass(found.value)) {
      log('info', 'Creating adapter: new ' + found.path + '(options)',
          Object.assign({}, options, { mountRoot: '#widget-root' }));
      adapter = new found.value(options);
    } else {
      log('info', 'Using existing adapter instance at ' + found.path +
          ' (constructor options above were not applied)');
      adapter = found.value;
    }

    if (typeof adapter.injectMessageLogger === 'function') {
      adapter.injectMessageLogger(messageLogger);
    } else {
      log('error', 'Adapter has no injectMessageLogger; events will not be logged');
    }
    if (typeof adapter.onCommWidgetReady === 'function') {
      adapter.onCommWidgetReady(function () { setBadge('widget ready', 'ok'); });
    }

    var methods = prototypeMethods(adapter);
    var missing = Object.keys(METHODS).filter(function (m) { return methods.indexOf(m) === -1; });
    var extra = methods.filter(function (m) { return !METHODS[m]; });
    log('info', 'Adapter methods: ' + methods.length +
        (missing.length ? ', missing from spec: ' + missing.join(', ') : '') +
        (extra.length ? ', not in spec: ' + extra.join(', ') : ''));
    renderMethodPicker(methods);
    setBadge('waiting for widget', 'pending');
  }

  function loadAdapter(config) {
    var src = config.origin + ADAPTER_PATH;
    var globalsBefore = {};
    Object.getOwnPropertyNames(window).forEach(function (k) { globalsBefore[k] = true; });

    log('info', 'Loading adapter', src);
    var script = document.createElement('script');
    script.src = src;
    script.onload = function () {
      var found = findAdapter(globalsBefore, config.globalName);
      if (!found) {
        setBadge('not found', 'error');
        log('error', 'Adapter script loaded but no adapter class/instance was found on window. ' +
            'Pass its global path in the hash, e.g. #global=SomeName',
            Object.getOwnPropertyNames(window).filter(function (k) { return !globalsBefore[k]; }));
        return;
      }
      try {
        start(config, found);
      } catch (err) {
        setBadge('failed', 'error');
        log('error', 'Adapter initialisation threw', String(err && err.stack || err));
      }
    };
    script.onerror = function () {
      setBadge('load failed', 'error');
      log('error', 'Failed to load adapter script', src);
    };
    document.head.appendChild(script);
  }

  var config = readConfig();
  wireControls(config);
  renderEvents();
  loadAdapter(config);
})();
