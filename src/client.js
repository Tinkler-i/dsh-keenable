/**
 * `@keenable/dsh-keenable`, browser half: the configuration page of the row the
 * bundle patch inserts, so the optional API key can be entered from Harness's
 * Plugins page instead of a hand-edited profile patch.
 *
 * The artifact is not an ES module and is not imported by the Host: the Client
 * module table evaluates it, so it registers itself into the Plugins page's
 * `plugins.row.config` slot under `<package name>#<row id>`. That registration is
 * what gives the row a Configure control — the page draws that control only for
 * the keys some browser half registered, and draws no form of its own.
 *
 * Only the key is editable here. The key is the one documented setting that does
 * not live in the row's config: it lives in the credentials domain, under the
 * `KEENABLE_API_KEY` reference the provider already resolves from the launch
 * environment, so a page can write it without touching the profile. The provider
 * resolves that reference once, when it activates, so the page says so after a
 * save rather than pretending the change is already in force. The row's own
 * `config.apiKey` wins over this reference, and the launching environment
 * supplies it too, so the page stays about the one reference it manages and never
 * claims to be the provider's effective key.
 * `maxSnippetChars`, `fetchLive`, `maxBodyChars` and `baseURL` stay profile
 * configuration on purpose: the provider reads them once at activation too, so a
 * page that wrote them would report a save that changes nothing until the next
 * launch.
 * @module @keenable/dsh-keenable/client
 */

/** The package name, which is both the artifact id and the bundle half of the row key. */
const PACKAGE_NAME = '@keenable/dsh-keenable'

window.__ModuleLoader__.load({
  id: PACKAGE_NAME,
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')

    /** The row id the bundle patch declares. */
    const ROW_ID = 'keenable'
    /** The `plugins.row.config` key the Plugins page looks the row's page up under. */
    const ROW_CONFIG_KEY = `${PACKAGE_NAME}#${ROW_ID}`
    /** The credential reference the provider resolves when the row's config names no key. */
    const API_KEY_REF = 'KEENABLE_API_KEY'
    /** Dictionary namespace owned by this page. */
    const NS = 'keenable'
    /** Document id of the key input, so the label points at it. */
    const INPUT_ID = 'keenable-api-key'
    /** Required Client services. */
    const inject = ['slots', 'locale', 'remote', 'remote.credentials']

    /** English copy. */
    const en = {
      summary: 'Optional API key for Keenable search and fetch.',
      apiKey: 'API key',
      hint: 'Saved in the credentials domain, not in the settings file. The provider uses this reference only when the row sets no apiKey of its own.',
      configured: 'A key is saved for this reference.',
      unconfigured: 'No key is saved for this reference. A profile apiKey, or the environment Harness starts in, can still supply one.',
      unavailable: 'The Host did not answer for this credential, so its state is unknown here.',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved. Restart Harness, or switch this plugin off and on, to apply it.',
      blank: 'Enter a key before saving.',
      failed: 'The Host did not accept the key; nothing was saved.',
      readOnly: 'This deployment stores credentials read-only.',
    }

    /** Simplified Chinese copy. */
    const zh = {
      summary: 'Keenable 搜索与抓取的可选 API Key。',
      apiKey: 'API Key',
      hint: '存入凭据域，不写入设置文件。仅当该行自己没有配置 apiKey 时，提供方才会用这个引用。',
      configured: '该引用已保存密钥。',
      unconfigured: '该引用未保存密钥。profile 里的 apiKey，或 Harness 启动环境，仍可能提供密钥。',
      unavailable: 'Host 未返回该凭据的状态，此处无法判断。',
      save: '保存',
      saving: '保存中…',
      saved: '已保存。重启 Harness，或把本插件关掉再打开，即可生效。',
      blank: '请先填入密钥。',
      failed: 'Host 没有接受该密钥，未保存。',
      readOnly: '本部署的凭据为只读。',
    }

    /** Page container and controls, in the host's own tokens where they exist. */
    const styles = {
      page: { display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '8px', maxWidth: '520px' },
      label: { color: 'var(--dsw-alias-label-primary, inherit)', fontSize: '13px', fontWeight: 500 },
      input: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '6px 10px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35))',
        background: 'var(--dsw-alias-bg-layer-1, transparent)',
        color: 'var(--dsw-alias-label-primary, inherit)',
        fontSize: '13px',
      },
      hint: { margin: 0, color: 'var(--dsw-alias-label-caption, #8a8a8a)', fontSize: '12px', lineHeight: 1.5 },
      state: { margin: 0, color: 'var(--dsw-alias-label-secondary, inherit)', fontSize: '12px', lineHeight: 1.5 },
      error: { margin: 0, color: 'var(--dsw-alias-state-error-primary, #d03050)', fontSize: '12px', lineHeight: 1.5 },
      success: { margin: 0, color: 'var(--dsw-alias-state-success-primary, #2f9e44)', fontSize: '12px', lineHeight: 1.5 },
      action: { display: 'flex', justifyContent: 'flex-start' },
      button: {
        padding: '5px 14px',
        borderRadius: '6px',
        cursor: 'pointer',
        border: '1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35))',
        background: 'var(--dsw-alias-button-primary-fill, #4b6bfb)',
        color: '#ffffff',
        fontSize: '13px',
      },
    }

    /**
     * The row's page: one secret field over the credential the provider resolves.
     *
     * It holds its own draft and renders its own save control, because the Plugins
     * page only supplies a `form` for rows whose config namespace the Host serves —
     * and this row's config is not editable at runtime (see the module note).
     */
    class KeenableKeyForm extends React.Component {
      constructor(props) {
        super(props)
        this.state = { value: '', configured: false, writable: true, loading: true, unavailable: false, status: 'idle', detail: '' }
      }

      /**
       * Read the credential once, and again whenever the Host reports a write to
       * the reference this page watches — the key can also be set from outside
       * this page.
       */
      componentDidMount() {
        this.dispose = this.props.ctx.remote.$on('credentials/reference-updated', (ref) => {
          if (ref === API_KEY_REF) void this.refresh()
        })
        void this.refresh()
      }

      /** Release the Host subscription. */
      componentWillUnmount() {
        if (typeof this.dispose === 'function') this.dispose()
      }

      /**
       * Ask the credentials domain about {@link API_KEY_REF}. A reference the Host
       * has never seen is reported as unwritten rather than unwritable, matching
       * the page the Harness installation ships for its own provider.
       * @returns once the read has been folded into the state.
       */
      async refresh() {
        let response
        try {
          response = await this.props.ctx.remote.credentials.describe([API_KEY_REF])
        } catch {
          this.setState({ loading: false, unavailable: true })
          return
        }
        if (response?.ok === false) {
          this.setState({ loading: false, unavailable: true })
          return
        }
        const view = response?.value?.[API_KEY_REF]
        this.setState({
          loading: false,
          unavailable: false,
          configured: view?.configured ?? false,
          writable: view?.writable ?? true,
        })
      }

      /**
       * Write the staged key, then re-read what the Host holds. The field is
       * cleared only after the Host accepted the write, so a refusal leaves the
       * typed key in place for the user to correct.
       * @returns once the write and the re-read have settled.
       */
      async save() {
        const key = this.state.value.trim()
        if (key.length === 0) {
          this.setState({ status: 'blank', detail: '' })
          return
        }
        this.setState({ status: 'saving', detail: '' })
        let rejected = false
        let detail = ''
        try {
          const response = await this.props.ctx.remote.credentials.set(API_KEY_REF, key)
          if (response?.ok === false) {
            rejected = true
            detail = response.message ?? ''
          }
        } catch (error) {
          rejected = true
          detail = error instanceof Error ? error.message : String(error)
        }
        if (rejected) {
          this.setState({ status: 'failed', detail })
          return
        }
        this.setState({ value: '', status: 'saved', detail: '' })
        await this.refresh()
      }

      /**
       * @param {object} props
       * @param {'summary' | 'page'} props.view - the view the Plugins page asks for.
       * @param {(key: string) => string} props.t - the page's locale reader.
       * @returns the one-liner, or the form.
       */
      render() {
        const { t, view } = this.props
        if (view === 'summary') return t('summary')
        const { value, configured, writable, loading, unavailable, status, detail } = this.state
        const note = status === 'saved' ? { text: t('saved'), style: styles.success }
          : status === 'failed' ? { text: `${t('failed')}${detail === '' ? '' : ` (${detail})`}`, style: styles.error }
            : status === 'blank' ? { text: t('blank'), style: styles.error }
              : undefined
        return React.createElement('div', { style: styles.page, 'data-keenable-key': true },
          React.createElement('label', { htmlFor: INPUT_ID, style: styles.label }, t('apiKey')),
          React.createElement('input', {
            id: INPUT_ID,
            type: 'password',
            autoComplete: 'off',
            spellCheck: false,
            value,
            disabled: !writable,
            'aria-describedby': `${INPUT_ID}-hint`,
            style: styles.input,
            onChange: (event) => this.setState({ value: event.target.value, status: 'idle', detail: '' }),
            onKeyDown: (event) => {
              if (event.key === 'Enter') void this.save()
            },
          }),
          React.createElement('p', { id: `${INPUT_ID}-hint`, style: styles.hint }, t('hint')),
          loading ? null : React.createElement('p', { style: styles.state },
            unavailable ? t('unavailable') : configured ? t('configured') : t('unconfigured')),
          note === undefined ? null : React.createElement('p', { style: note.style }, note.text),
          React.createElement('div', { style: styles.action },
            React.createElement('button', {
              type: 'button',
              disabled: !writable || loading || status === 'saving' || value.trim().length === 0,
              style: styles.button,
              onClick: () => void this.save(),
            }, status === 'saving' ? t('saving') : t('save'))),
          writable ? null : React.createElement('p', { style: styles.hint }, t('readOnly')),
        )
      }
    }

    /**
     * Mount the row's configuration page while the Plugins page's slot exists.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'keenable: dictionaries')
      ctx.effect(() => ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
        name: 'plugins.row.config',
        key: ROW_CONFIG_KEY,
        locale: NS,
        order: 50,
      }, props => React.createElement(KeenableKeyForm, { ...props, ctx, t }))), 'keenable: row configuration page')
    }

    exports.API_KEY_REF = API_KEY_REF
    exports.KeenableKeyForm = KeenableKeyForm
    exports.NS = NS
    exports.ROW_CONFIG_KEY = ROW_CONFIG_KEY
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
