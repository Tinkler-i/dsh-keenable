# Keenable for DeepSeek Harness

Web search and page reading for DeepSeek Harness through [Keenable](https://keenable.ai), with **no API key and no account**. It works with whatever model you run in Harness, local models included.

The plugin points Harness's built-in `web_search` and `web_fetch` tools at Keenable. It adds no new tools: the model asks for a query or a URL exactly as before, and Keenable answers.

## Why

The search provider Harness ships with needs a DeepSeek account or a DeepSeek API key. With a local or third-party model and neither of those, `web_search` fails. Keenable's public endpoints need no key, so search works on a fresh install:

- `web_search` returns ranked web results with an excerpt of each page and its publication date, when known.
- `web_fetch` returns a page as markdown. The page is retrieved on Keenable's servers, so a URL the model chose is never requested from the machine running Harness, and private or internal hosts are refused.

An API key is optional. It only lifts the rate limit described [below](#limits-and-the-optional-api-key).

## Install

Requires DeepSeek Harness 0.1.7-rc.2 or later and Node.js 22.12 or later.

**From Harness:** open **Plugins → Add plugin**, enter `@keenable/dsh-keenable`, then **Install → Enable now**.

**From the terminal:** install into the profile you use, then restart Harness:

```sh
npx @deepseek-ai/dsh plugin --profile web add @keenable/dsh-keenable
npx @deepseek-ai/dsh web
```

Profiles are separate: `web`, `tui` and `headless` each need their own install. Replace `web` with the profile you run.

Then ask your model to search the web. No further setup is needed. The plugin adds a **Configure** control to its row on the **Plugins** page; that is where the optional API key goes.

## Limits and the optional API key

Without a key, requests go to Keenable's public endpoints, limited to 10 requests per second and 1,000 per hour per IP address. Search and fetch are counted separately. Everyone behind the same network address shares the limit, so a busy office or CI runner can reach it; the tool error then says so.

A key lifts the limit. Create one in the [Keenable console](https://app.keenable.ai/console), then either:

- open **Plugins → @keenable/dsh-keenable**, use the **Configure** control on the `keenable` row, and save the key there, or
- set `KEENABLE_API_KEY` in the environment Harness starts in.

The provider resolves its key from the row's `config.apiKey` first, and from the `KEENABLE_API_KEY` reference second — the reference the page writes, and the one the launching environment supplies. So a key saved on the page is used **only when the row's `config` sets no `apiKey`**: if you set one there, remove it for the page's key to take over. Either way the key is saved to the credentials domain rather than to the settings file, so its literal never appears in a settings response. The provider resolves the reference when it activates, so restart Harness — or switch the plugin off and on — after saving, for the new key to be used.

## Settings

Only the key has a page control. The other four are profile configuration, read once when the plugin activates: put them under the row's `config` in your profile's `cordis.patch.yml`, beside `apiKey` if you set the key there instead. A page that wrote them could not make them take effect without a restart.

| Setting | Where | Default | Meaning |
| --- | --- | --- | --- |
| `apiKey` | **Configure** control, or `config` | `$KEENABLE_API_KEY` | Optional. Switches both tools to the authenticated endpoints. A value under `config` wins over the reference the page writes. |
| `maxSnippetChars` | `config` | `500` | Excerpt length per search result, 180 to 10,000 characters. |
| `fetchLive` | `config` | `true` | Fetch pages live from the source. When off, `web_fetch` returns Keenable's indexed copy and fails for pages it has not indexed. |
| `maxBodyChars` | `config` | `100000` | Maximum characters of page text `web_fetch` returns. Longer pages are cut and marked as truncated. |
| `baseURL` | `config` | `https://api.keenable.ai` | API origin. HTTPS only. |

## Keeping the local fetch provider

The plugin pins both capabilities to Keenable. To keep Harness's local HTTP fetch provider and use Keenable for search only, override the web row in your profile's `cordis.patch.yml`:

```yaml
- id: web
  config:
    searchProvider: keenable
    fetchProvider: http
```

Both fields are needed: a config patch replaces the row's whole config object.

## Privacy

Search queries and fetched URLs are sent to Keenable, even when your model runs locally. Requests identify the plugin with an `X-Keenable-Title: dsh-keenable` header, which the public endpoints require. Results are external content, and Harness marks them as untrusted data for the model.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `WEB_PROVIDER_CONFIGURED_MISSING` | The plugin is not loaded in this profile. Install it into the profile you run, and restart Harness. |
| "requests share a per-IP limit" | The keyless limit was reached. Wait, or set an API key. |
| "Fetching from private/internal hosts is not allowed" | Keenable does not fetch `localhost` or private addresses. Use the local HTTP fetch provider for those (see above). |
| Search still asks for DeepSeek credentials | Another patch layer pins `searchProvider` back. Check the composed profile with `npx @deepseek-ai/dsh --profile web --dump-config`. |
| The row has no **Configure** control | The browser half has not loaded. It ships inside the package and loads with the Harness app, so restart Harness after installing or updating the plugin. |
| A key saved on the page is not used yet | The provider resolves `KEENABLE_API_KEY` when it activates. Restart Harness, or switch the plugin off and on, after saving. |
| A key saved on the page is never used | The row's `config` sets `apiKey`, which wins over the reference the page writes. Remove it from the profile's `cordis.patch.yml`, or keep the key there instead. |

## Development

```sh
npm ci
npm test            # offline: providers, plugin registration, model-facing tools, manifest, browser half
npm run test:live   # real Keenable API, no key
```

The tests load the plugin into a real Cordis context with Harness's own `dsh-web` seam and `web_search`/`web_fetch` tools. The browser half is covered too: `test/client.test.js` evaluates the artifact the way the Client module table does, with a stubbed `react` and Client context, so the slot registration, the credential read, and the save path run under Node. The code is plain JavaScript and needs no build step.

## License

MIT
