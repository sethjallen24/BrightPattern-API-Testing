# Bright Pattern API Testing

A browser test harness for the Bright Pattern CRM embedded (Comm.Widget) adapter:

```html
<script src="https://clearinsights.brightpattern.com/agent/crmembedded/adapters/api.js"></script>
```

## How the adapter works

Based on the adapter source (`api.js`):

- The script exports an adapter **class**. You create it with `new Adapter(options)`. The
  constructor:
  - adds a hidden `…/agent/crmembedded/adapters/api-proxy.html` iframe, which carries all messages;
  - mounts the Agent Desktop Comm.Widget iframe (`…/agent/crmembedded/` + `location.search`),
    unless `adcFrame` or `thinClient` is given.
- The tenant origin is the origin of the `api.js` URL. An `?adcUrl=` query parameter on the host
  page overrides it.
- Constructor options:

  | Option | Effect |
  | --- | --- |
  | `mountRoot` | Element to mount the widget iframe in (default `document.body`) |
  | `adcFrame` | Use an existing `<iframe>` (must have a `src`) instead of creating one |
  | `thinClient` | Don't create a widget iframe when no `mountRoot` is given |
  | `standalone` | Hidden widget iframe using `…/agent/crmembedded/no-ui/` |
  | `adaptiveWidth` | Widget iframe width `100%` instead of `500px` |
  | `disableNewInteractionPopup` | Passed to the widget in the handshake |
  | `integrationKey` | Passed to the widget in the handshake (random UUID by default) |

- Every API method returns a Promise. It resolves with `{ status: "success" | "error", … }`,
  or with error code 6 (`api_not_answer`) if the widget doesn't answer within 20 s. Calls made
  before the widget connects are queued.
- Events: subscribe with `adapter.on("ON_NEW_INTERACTION", handler)` and unsubscribe with
  `adapter.remove(name, handler)`. Some events (`ON_REQUEST_TRANSFER_DATA`,
  `ON_WEB_SCREEN_POP_CUSTOM`, `ON_SAVE_ACTIVITY_RECORD`, `ON_REQUEST_RECORD_INFO`, …) expect a
  response. For those, the adapter sends the last non-`undefined` value (or resolved promise)
  returned by the handlers back to the widget.
- `adapter.injectMessageLogger((type, params) => …)` receives every protocol packet, and
  `adapter.onCommWidgetReady(cb)` fires once the widget has loaded.

## What the harness does

- Loads `api.js` from the tenant. The adapter's global name isn't in the part of the source we
  have, so the harness finds the export by looking for a new global (or a property one level
  below it) that has `apiCall` and `on` methods. You can name it explicitly with
  `#global=Some.Path`.
- Creates the adapter with `mountRoot` set to the left-hand pane and the options you choose in
  the header.
- Registers a message logger. It logs every event (not only the ones you'd subscribe to) and
  marks the ones that expect a response. The harness doesn't call `.on()` itself, so it never
  changes how the adapter answers those events. Tick "raw protocol traffic" to see every packet.
- Has quick buttons for common calls, and an "Any method" picker listing every public method on
  the adapter instance. Each argument gets its own field. Methods the harness doesn't know about
  are listed too.

The adapter's method argument names are minified. The field labels only name the arguments
that are obvious (`interactionId`, `state`, `reason`); the rest are `arg1…`. A `[]` in a label
means the adapter wraps a single value in an array for that argument.

## Running

```sh
python3 -m http.server 8080
# open http://localhost:8080/
```

Serve the page over HTTP; don't open it as a `file://` URL. The widget loads inside the
left-hand pane. Log in there, then use the controls on the right.

Harness settings live in the URL **hash**, for example
`http://localhost:8080/#tenant=example.brightpattern.com&noPopup=1`. They aren't in the query
string because the adapter forwards `location.search` to the widget.

| Hash key | Meaning | Default |
| --- | --- | --- |
| `tenant` | Tenant host serving `api.js` and the widget | `clearinsights.brightpattern.com` |
| `adaptive=0` | Turn `adaptiveWidth` off | on |
| `noPopup=1` | `disableNewInteractionPopup` | off |
| `standalone=1` | `standalone` (hidden, no-UI widget) | off |
| `integrationKey` | Fixed integration key | random |
| `global` | Path of the adapter export on `window` | auto-detect |

If the widget refuses to load in the iframe, the tenant probably doesn't allow your page's
origin. Add the origin in the tenant's CRM/embedded integration settings.

## Files

- `index.html`: layout and controls
- `app.js`: adapter loading and discovery, method calls, event logging
- `styles.css`: styles
