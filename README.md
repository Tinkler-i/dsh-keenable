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

Then ask your model to search the web. No further setup is needed.

## Limits and the optional API key

Without a key, requests go to Keenable's public endpoints, limited to 10 requests per second and 1,000 per hour per IP address. Search and fetch are counted separately. Everyone behind the same network address shares the limit, so a busy office or CI runner can reach it; the tool error then says so.

A key lifts the limit. Create one in the [Keenable console](https://app.keenable.ai/console), then either:

- set `KEENABLE_API_KEY` in the environment Harness starts in, or
- enter it as **apiKey** in this plugin's settings on the **Plugins** page.

A key in the settings wins over the environment variable.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `apiKey` | `$KEENABLE_API_KEY` | Optional. Switches both tools to the authenticated endpoints. |
| `maxSnippetChars` | `500` | Excerpt length per search result, 180 to 10,000 characters. |
| `fetchLive` | `true` | Fetch pages live from the source. When off, `web_fetch` returns Keenable's indexed copy and fails for pages it has not indexed. |
| `maxBodyChars` | `100000` | Maximum characters of page text `web_fetch` returns. Longer pages are cut and marked as truncated. |
| `baseURL` | `https://api.keenable.ai` | API origin. HTTPS only. |

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

## Development

```sh
npm ci
npm test            # offline: providers, plugin registration, model-facing tools, manifest
npm run test:live   # real Keenable API, no key
```

The tests load the plugin into a real Cordis context with Harness's own `dsh-web` seam and `web_search`/`web_fetch` tools. The code is plain JavaScript and needs no build step.

## License

MIT
