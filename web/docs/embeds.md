# Embedding exported Fork systems

Fork embeds are static, read-only views backed by the same ZIP produced by the web UI's system
export. Fork Dynamics hosts the viewer code, while the publisher hosts the exported system file.
No system data is uploaded to Fork Dynamics.

## Create an embed

1. Open the system in Fork and select **Embed** in the toolbar.
2. Choose one or more state-space scenes, event maps, or bifurcation diagrams.
3. Set the hosted ZIP path and viewer options.
4. Download the system ZIP and copy the generated embed code.
5. Upload the ZIP to the website at the path used in the embed code.

The generated markup has this form:

```html
<script defer src="https://www.forkdynamics.com/embed/v1.js"></script>

<fork-embed
  src="./Lorenz.zip"
  viewports="scene_abc,diagram_xyz"
  theme="auto"
  headers="auto"
  interaction="plot"
  controls="reset fullscreen"
  style="display:block;width:100%;height:560px"
></fork-embed>
```

The loader runs in the publisher's page, so a relative `src` is fetched from the same website as
the page. It then transfers the ZIP bytes to an isolated Fork viewer iframe. This avoids requiring
CORS headers on the ZIP for the normal same-origin setup. A cross-origin `src` can be used only when
that file host permits the publisher page to read it with CORS.

## Public options

- `src`: HTTP(S) URL for the exported system ZIP, resolved relative to the publisher page.
- `viewports`: comma- or space-separated viewport IDs. The builder supplies stable exported IDs.
- `theme`: `auto`, `light`, or `dark`.
- `headers`: `auto`, `show`, or `hide`.
- `interaction`: `plot` for rotate/pan/zoom/hover, or `none` for a static presentation.
- `controls`: any combination of `reset` and `fullscreen`; an empty value hides both.

Size the custom element with normal CSS. If several viewports are selected, they retain their
saved order and form a vertical stack inside the element.

## Security and compatibility

Embedded ZIPs are public assets: visitors can retrieve the file even when no download button is
shown. The viewer never imports the system into the visitor's Fork storage and never exposes
editing, solver, or continuation actions. Only bounded calculations needed to reproduce saved
viewports are available.

The v1 loader accepts archive schema 1 with a 64 MiB compressed and 256 MiB expanded limit. Invalid,
unsupported, or inconsistent archives show an error inside the embed instead of opening the full
application.

Websites with a restrictive Content Security Policy must allow `https://www.forkdynamics.com` in
both `script-src` and `frame-src`. Fullscreen also depends on the embedding page allowing the
fullscreen permission.
