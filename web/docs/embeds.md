# Embedding exported Fork plots

Fork can export selected viewports as one standalone HTML page. The page contains only resolved
Plotly figure data and presentation metadata. It does not contain the dynamical-system model,
solver settings, Fork storage, WASM, or a Fork viewer application.

## Create an embed

1. Open **Systems**, select **Export** for the system, then choose **Create embed**.
2. Select one or more state-space scenes, event maps, or bifurcation diagrams.
3. Choose a fixed light or dark theme, header visibility, interaction, and iframe size.
4. Set the hosted HTML path and wait for every selected viewport to be ready.
5. Download the embed HTML and copy the generated iframe code.
6. Upload the HTML file to the website at the path used in the iframe.

The generated markup has this form:

```html
<iframe
  src="./Lorenz_embed.html"
  title="Lorenz visualization"
  style="display:block;width:100%;height:560px;border:0"
  loading="lazy"
></iframe>
```

The downloaded page loads Plotly.js 2.32.0 from Plotly's CDN and MathJax 3.2.2 from jsDelivr.
All selected figures and their saved viewport heights are stored directly in the HTML. Multiple
viewports form a vertical stack in their saved order.

## Behavior and compatibility

- Interactive exports retain Plotly pan, zoom, rotation, hover, legends, and the native modebar.
- Static-presentation exports disable Plotly interaction and the modebar.
- The selected light or dark theme is fixed at export time.
- Header visibility is resolved at export time; **Automatic** shows headers when several
  viewports are selected.
- The exported page is responsive to its iframe width and scrolls vertically when its content is
  taller than the iframe.

The page requires internet access to both CDNs. Websites with a restrictive Content Security
Policy must permit scripts from `https://cdn.plot.ly` and `https://cdn.jsdelivr.net`, as well as the
small inline bootstrap contained in the exported HTML.

Exported plot pages are public assets. Anyone who can open the HTML can inspect its plotted data,
including hover metadata included in the Plotly figure. Use the normal ZIP export separately when
you intend to share an editable Fork system.
