(function () {
  'use strict';

  var DEFAULT_TENANT = 'clearinsights.brightpattern.com';
  var DEFAULT_DESKTOP_PATH = '/agentdesktop/';
  var ADAPTER_PATH = '/agent/crmembedded/adapters/api.js';
  // Event registration functions follow either addXxxHandler(cb) or onXxx(cb).
  var HANDLER_PATTERN = /^(add\w*Handler|on[A-Z]\w*)$/;

  var $ = function (sel) { return document.querySelector(sel); };
  var registeredHandlers = {};

  // ---- config ------------------------------------------------------------

  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }

  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* ignore */ }
  }

  function readConfig() {
    var params = new URLSearchParams(window.location.search);
    var tenant = params.get('tenant') || storageGet('bp.tenant') || DEFAULT_TENANT;
    var desktopPath = params.get('desktop') || storageGet('bp.desktopPath') || DEFAULT_DESKTOP_PATH;
    tenant = tenant.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (desktopPath.charAt(0) !== '/') desktopPath = '/' + desktopPath;
    return { tenant: tenant, desktopPath: desktopPath, origin: 'https://' + tenant };
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

  function callbackFor(name) {
    return function () {
      var args = Array.prototype.slice.call(arguments);
      log('result', name, args.length === 1 ? args[0] : args);
    };
  }

  // ---- api access --------------------------------------------------------

  function getApi() {
    return window.bpspat && window.bpspat.api;
  }

  function listMethods(api) {
    var names = [];
    for (var key in api) {
      if (typeof api[key] === 'function') names.push(key);
    }
    return names.sort();
  }

  function invoke(name, args) {
    var api = getApi();
    if (!api) {
      log('error', name + ': bpspat.api is not available — adapter not loaded');
      return;
    }
    if (typeof api[name] !== 'function') {
      log('error', name + ': not a function on bpspat.api', listMethods(api));
      return;
    }
    var shown = args.map(function (a) { return typeof a === 'function' ? '<callback>' : a; });
    log('call', name, shown);
    try {
      var ret = api[name].apply(api, args);
      if (ret !== undefined) {
        if (ret && typeof ret.then === 'function') {
          ret.then(function (v) { log('result', name + ' (promise)', v); },
                   function (err) { log('error', name + ' (promise rejected)', String(err)); });
        } else {
          log('result', name + ' (return)', ret);
        }
      }
    } catch (err) {
      log('error', name + ' threw', String(err && err.stack || err));
    }
  }

  function registerHandlers(api) {
    var added = [];
    listMethods(api).forEach(function (name) {
      if (!HANDLER_PATTERN.test(name) || registeredHandlers[name]) return;
      try {
        api[name](function () {
          var args = Array.prototype.slice.call(arguments);
          log('event', name, args.length === 1 ? args[0] : args);
        });
        registeredHandlers[name] = true;
        added.push(name);
      } catch (err) {
        log('error', 'registering ' + name + ' threw', String(err));
      }
    });
    if (added.length) log('info', 'Registered event handlers', added);
    $('#handler-summary').textContent =
      Object.keys(registeredHandlers).length + ' handler(s) registered';
  }

  function populateMethodPicker(api) {
    var select = $('#generic-method');
    var current = select.value;
    select.innerHTML = '';
    listMethods(api).forEach(function (name) {
      var opt = document.createElement('option');
      opt.value = opt.textContent = name;
      select.appendChild(opt);
    });
    if (current) select.value = current;
  }

  function scanApi() {
    var api = getApi();
    if (!api) {
      log('error', 'bpspat.api not found on window after loading adapter',
          { bpspat: typeof window.bpspat });
      return;
    }
    log('info', 'bpspat.api methods', listMethods(api));
    populateMethodPicker(api);
    registerHandlers(api);
  }

  // ---- bootstrapping -----------------------------------------------------

  function setStatusBadge(text, state) {
    var badge = $('#adapter-status');
    badge.textContent = 'adapter: ' + text;
    badge.dataset.state = state;
  }

  function loadAdapter(config) {
    var src = config.origin + ADAPTER_PATH;
    log('info', 'Loading adapter', src);
    var script = document.createElement('script');
    script.src = src;
    script.onload = function () {
      setStatusBadge('loaded', 'ok');
      var api = getApi();
      if (api && typeof api.init === 'function') {
        invoke('init', [config.origin]);
      } else {
        log('error', 'bpspat.api.init is missing; cannot bind to Agent Desktop origin');
      }
      scanApi();
      $('#agent-desktop').src = config.origin + config.desktopPath;
    };
    script.onerror = function () {
      setStatusBadge('failed', 'error');
      log('error', 'Failed to load adapter script', src);
    };
    document.head.appendChild(script);
  }

  function valuesOf(selectors) {
    if (!selectors) return [];
    return selectors.split(',').map(function (sel) { return $(sel.trim()).value; })
      // Drop trailing empty optional args so the API sees them as omitted.
      .reduceRight(function (acc, v) {
        if (acc.length || v !== '') acc.unshift(v);
        return acc;
      }, []);
  }

  function wireControls(config) {
    $('#tenant').value = config.tenant;
    $('#desktop-path').value = config.desktopPath;

    $('#tenant-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var tenant = $('#tenant').value.trim() || DEFAULT_TENANT;
      var desktopPath = $('#desktop-path').value.trim() || DEFAULT_DESKTOP_PATH;
      storageSet('bp.tenant', tenant);
      storageSet('bp.desktopPath', desktopPath);
      var params = new URLSearchParams({ tenant: tenant, desktop: desktopPath });
      window.location.search = params.toString();
    });

    document.querySelectorAll('[data-call]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var name = btn.dataset.call;
        var args = valuesOf(btn.dataset.args);
        if (btn.hasAttribute('data-callback')) args.push(callbackFor(name));
        invoke(name, args);
      });
    });

    $('#set-status').addEventListener('click', function () {
      invoke('setStatus', valuesOf('#status,#reason'));
    });

    $('#generic-call').addEventListener('click', function () {
      var name = $('#generic-method').value;
      if (!name) { log('error', 'No method selected'); return; }
      var raw = $('#generic-args').value.trim();
      var args = [];
      if (raw) {
        try {
          args = JSON.parse(raw);
        } catch (err) {
          log('error', 'Args are not valid JSON', String(err));
          return;
        }
        if (!Array.isArray(args)) args = [args];
      }
      if ($('#generic-callback').checked) args.push(callbackFor(name));
      invoke(name, args);
    });

    $('#rescan').addEventListener('click', scanApi);
    $('#clear-log').addEventListener('click', function () { $('#log').innerHTML = ''; });
  }

  var config = readConfig();
  wireControls(config);
  loadAdapter(config);
})();
