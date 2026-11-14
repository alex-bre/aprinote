import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, Laptop, Maximize2, Monitor, Smartphone, Tablet } from 'lucide-react'
import docCss from '@/styles/doc.css?raw'
import { DEVICE_WIDTH, deviceWidth, useSession, type Device } from '@/store/sessionStore'
import { useVault } from '@/store/vaultStore'
import { assetMime, assetsReferencedBy, inlineAssets } from '@/vault/assets'
import { serializePage } from '@/vault/page'
import { ASSETS_DIR, join } from '@/vault/paths'
import { followLink } from './linkTarget'
import styles from './PreviewPane.module.css'

const DEVICES: { device: Device; Icon: typeof Monitor; label: string }[] = [
  { device: 'fit', Icon: Maximize2, label: 'Fit' },
  { device: 'desktop', Icon: Monitor, label: String(DEVICE_WIDTH.desktop) },
  { device: 'laptop', Icon: Laptop, label: String(DEVICE_WIDTH.laptop) },
  { device: 'tablet', Icon: Tablet, label: String(DEVICE_WIDTH.tablet) },
  { device: 'mobile', Icon: Smartphone, label: String(DEVICE_WIDTH.mobile) },
]

/** The message a preview click sends its way out. Namespaced; the window hears everything. */
const LINK_MESSAGE = 'aprinote:preview-link'

/**
 * Hand link clicks back to the app.
 *
 * A relative `href` inside a `srcdoc` frame resolves against the *app's* URL, so
 * following one navigates the frame to a page of the app that does not exist —
 * a 404, or behind a forwarded port a "connecting…" screen that never resolves and
 * has no way back. So nothing is followed in here: the click is reported, and the
 * app decides whether it means a page, a tab, or nothing.
 *
 * Capturing, so a click is intercepted before anything in the page handles it, and
 * left alone when the page already did.
 */
const LINK_BRIDGE = `<script>
(function () {
  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0) return;
    var node = event.target;
    var anchor = node && node.closest ? node.closest('a[href], a[data-aprinote]') : null;
    if (!anchor) return;
    var href = anchor.getAttribute('href') || '';
    if (href.charAt(0) === '#') return;
    event.preventDefault();
    parent.postMessage(
      { type: '${LINK_MESSAGE}', id: anchor.getAttribute('data-aprinote'), href: href },
      '*'
    );
  }, true);
})();
</script>`

/**
 * A transparent pixel, for a reference with no bytes behind it. It must still not
 * become a request against the app's own origin — behind a forwarded port that is
 * the slow "connecting…" page, fetched once per broken image.
 */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/** Base64 through `FileReader`, retyped by extension so the URI declares an image. */
function toDataUri(blob: Blob, name: string): Promise<string> {
  const mime = assetMime(name) || blob.type
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => resolve('')
    reader.readAsDataURL(mime && mime !== blob.type ? new Blob([blob], { type: mime }) : blob)
  })
}

/**
 * The page's assets, read once per *set of references* — not per edit. A keystroke
 * rewrites the document but almost never changes which images are in it, and
 * re-reading every one of them on every keystroke is not a thing preview should do.
 */
function useAssetUris(document: string | undefined): Record<string, string> {
  const [uris, setUris] = useState<Record<string, string>>({})
  const key = useMemo(
    () => (document ? assetsReferencedBy(document).sort().join('\n') : ''),
    [document],
  )

  useEffect(() => {
    const names = key ? key.split('\n') : []
    const { adapter } = useVault.getState()
    if (!adapter || names.length === 0) {
      setUris({})
      return
    }

    let live = true
    void Promise.all(
      names.map(async (name) => {
        const blob = await adapter.readBinary(join(ASSETS_DIR, name)).catch(() => null)
        return [name, blob ? await toDataUri(blob, name) : ''] as const
      }),
    ).then((entries) => {
      // A missing file keeps no entry, so it renders as the blank pixel rather
      // than as a request the frame cannot make.
      if (live) setUris(Object.fromEntries(entries.filter(([, uri]) => uri)))
    })

    return () => {
      live = false
    }
  }, [key])

  return uris
}

/** Put tags in the document's head, wherever the document happens to have one. */
function injectHead(html: string, tags: string): string {
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${tags}\n</head>`)
  if (/<body[^>]*>/i.test(html)) return html.replace(/<body[^>]*>/i, (body) => body + tags)
  return tags + html
}

/**
 * Inline the stylesheet the served vault would resolve from `_vault/site.css` —
 * the *raw* sheet, not the `@scope`-wrapped one the editor gets, because this is a
 * real document in its own iframe and needs no scoping. Theme tokens deliberately
 * stay outside, so a dark app chrome never leaks into the page a reader sees.
 */
function toSrcDoc(
  document: string,
  fragment: string,
  siteCss: string,
  assets: Record<string, string>,
): string {
  // The reset goes *first*, so the sheet's own `body { margin: 0 auto }` wins over
  // it — after the sheet, it pinned the page to the left edge of every preview.
  const inline = `<style>html,body{margin:0;color-scheme:light}\n${siteCss || docCss}</style>`
  // `stamp: false` matters more than it looks: restamping `aprinote-edited` would make
  // this a different string on every render, React would rewrite the `srcdoc`
  // attribute, and the iframe would restart loading — sometimes landing blank.
  // Preview the fragment as it stands, so unsaved edits are visible.
  const page = serializePage(document, fragment, { stamp: false })
  const styled = /<link rel="stylesheet"[^>]*>/.test(page)
    ? page.replace(/<link rel="stylesheet"[^>]*>/, inline)
    : injectHead(page, inline)
  return injectHead(inlineAssets(styled, assets, BLANK), LINK_BRIDGE)
}

export function PreviewPane() {
  const device = useSession((s) => s.device)
  const setDevice = useSession((s) => s.setDevice)
  const page = useVault((s) => s.page)
  const siteCss = useVault((s) => s.siteCss)
  const cssToken = useVault((s) => s.cssToken)
  const stageRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const assets = useAssetUris(page?.document)

  /**
   * The other half of the bridge. The frame has an opaque origin — it is sandboxed
   * without `allow-same-origin` — so its `origin` is the string "null" and worth
   * nothing as a check; identity is the frame's own window. The payload is treated
   * as what it is, untrusted text from a document the app did not write: it is only
   * ever looked up in the index, never acted on directly.
   */
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return
      const data = event.data as { type?: unknown; id?: unknown; href?: unknown } | null
      if (!data || data.type !== LINK_MESSAGE) return

      followLink({
        id: typeof data.id === 'string' ? data.id : null,
        href: typeof data.href === 'string' ? data.href : null,
      })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  /**
   * Measure the stage's *content box*, which excludes its padding — so there are
   * no magic padding constants to keep in step with the stylesheet.
   *
   * Two things keep this from oscillating, which is what made large device widths
   * flicker: the stage never scrolls (the frame it holds is sized to fit by
   * construction, and the page scrolls inside the iframe instead), and the update
   * is deferred to an animation frame and ignored when nothing moved by a whole
   * pixel. A ResizeObserver that resizes what it observes is a feedback loop.
   */
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    // Measure before the first paint, so the frame is never rendered at a
    // placeholder size and then resized — that resize is a second render, and a
    // second render is what used to restart the iframe's load.
    const first = stage.getBoundingClientRect()
    if (first.width > 0) {
      const style = getComputedStyle(stage)
      setBox({
        width: first.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        height: first.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      })
    }

    let frame = 0
    const observer = new ResizeObserver(([entry]) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const { width, height } = entry.contentRect
        setBox((previous) =>
          Math.abs(previous.width - width) < 1 && Math.abs(previous.height - height) < 1
            ? previous
            : { width, height },
        )
      })
    })
    observer.observe(stage)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  const width = deviceWidth(device, box.width)
  // Never magnify: a 390px page shown at 390px is the point, not a blown-up one.
  const fit = box.width > 0 ? Math.min(1, box.width / width) : 1
  const frameHeight = Math.max(320, Math.round((box.height || 600) / fit))
  const scaled = fit < 1

  // Stable across resizes, so changing the device width never reloads the frame.
  const srcDoc = useMemo(
    () => (page ? toSrcDoc(page.document, page.fragment, siteCss, assets) : ''),
    [page, siteCss, assets],
  )

  return (
    <div className={styles.pane}>
      <div className={styles.bar}>
        <div className={styles.devices}>
          {DEVICES.map(({ device: d, Icon, label }) => (
            <button
              key={d}
              className={`${styles.device} ${device === d ? styles.on : ''}`}
              onClick={() => setDevice(d)}
              title={d === 'fit' ? 'Fit the pane' : `${label}px wide`}
            >
              <Icon size={14} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className={styles.meta}>
          <span>
            {width}px · {Math.round(fit * 100)}%
          </span>
          <span className={styles.open}>
            <ExternalLink size={13} />
            open in browser
          </span>
        </div>
      </div>

      <div className={styles.stage} ref={stageRef}>
        <div
          className={styles.scaler}
          style={{ width: Math.floor(width * fit), height: Math.floor(frameHeight * fit) }}
        >
          <iframe
            /* Remounting on the token is the cache bust: a saved stylesheet
               repaints every open preview. */
            key={cssToken}
            ref={frameRef}
            className={styles.frame}
            title={`${page?.meta.title ?? 'Preview'} at ${width}px`}
            /* `allow-scripts` without `allow-same-origin`: the frame keeps an
               opaque origin — no reach into the app's DOM, storage or vault — but
               can run the click bridge above, and with it the scripts a reader's
               browser would run, embeds included. */
            sandbox="allow-scripts"
            /* No transform at all when nothing is being scaled — the default
               "Fit" case. A no-op `scale(1)` still forces a compositing layer,
               which is a well-worn way to get an iframe that never paints. */
            style={{
              width,
              height: frameHeight,
              transform: scaled ? `scale(${fit})` : undefined,
            }}
            srcDoc={srcDoc}
          />
        </div>
      </div>
    </div>
  )
}
