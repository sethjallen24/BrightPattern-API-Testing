# Bright Pattern API Testing

A browser test harness for the Bright Pattern CRM embedded adapter:

```html
<script src="https://clearinsights.brightpattern.com/agent/crmembedded/adapters/api.js"></script>
```

The page loads that adapter, calls `bpspat.api.init(origin)`, embeds Agent Desktop in an
iframe from the same tenant, and gives you buttons for the documented
[Embedded Agent Desktop API](https://help.brightpattern.com/latest:Embedded-agent-desktop-api-specification/GeneralInformation)
methods. Calls, callback results and events all show up in the log panel and in the browser console.

## Running

The adapter talks to the Agent Desktop iframe with `postMessage`, so serve the page over HTTP
rather than opening it as a `file://` URL:

```sh
python3 -m http.server 8080
# open http://localhost:8080/
```

Log in to Agent Desktop inside the iframe, then use the controls on the right.

If Agent Desktop refuses to load in the iframe, the tenant probably doesn't allow your page's
origin. Add it to the CRM/embedded integration settings in the Bright Pattern Contact Center
Administrator, or host the page on an origin that's already allowed.

## Configuration

| Setting | Query parameter | Default |
| --- | --- | --- |
| Tenant host | `tenant` | `clearinsights.brightpattern.com` |
| Agent Desktop path | `desktop` | `/agentdesktop/` |

Example: `http://localhost:8080/?tenant=example.brightpattern.com`. The header form sets these
and remembers them in `localStorage`.

## What's covered

| Group | Methods |
| --- | --- |
| Agent state | `getState(callback)`, `setStatus(status, reason)` |
| Dialing & transfer | `dialNumber`, `selectService`, `singleStepTransfer`, `singleStepConference`, `mergeAllCallsIntoConference` |
| Complete & terminate | `setDisposition`, `terminateInteraction`, `completeInteraction`, `completeInteractionWithDisp` |
| Call recording | `startCallRecording`, `stopCallRecording`, `muteCallRecording`, `unmuteCallRecording` |

The adapter's exact surface can differ between Bright Pattern releases. So the harness also:

- lists every function it finds on `window.bpspat.api` in the "Any method" picker. You can call
  any of them with a JSON argument array and, optionally, an extra logging callback on the end.
- registers a logging callback for every function named `add…Handler` or `on…` (for example
  `addInteractionRenderedHandler`, `addInteractionCompletedHandler`), so every event the adapter
  emits is logged.

"Rescan API" repeats the discovery step if the adapter adds methods after `init`.

## Files

- `index.html`: page layout and controls
- `app.js`: adapter loading, `init`, method calls, handler registration and logging
- `styles.css`: styles
