const COLORS = ["#f59e0b", "#38bdf8", "#fb7185", "#4ade80"];

function defaultSeriesKey(entry) {
  return entry.key ?? "";
}

function formatTick(value) {
  const magnitude = Math.abs(value);
  if (magnitude >= 1000) {
    return value.toFixed(0);
  }
  if (magnitude >= 100) {
    return value.toFixed(1);
  }
  if (magnitude >= 1) {
    return value.toFixed(2);
  }
  return value.toFixed(3);
}

export class SChartBase extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.gridCanvas = document.createElement("canvas");
    this.plotCanvas = document.createElement("canvas");
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          min-height: 320px;
          background:
            radial-gradient(circle at top left, rgba(255, 186, 73, 0.22), transparent 28%),
            linear-gradient(135deg, #0f172a, #111827 55%, #1f2937);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 16px;
          overflow: hidden;
        }

        canvas {
          position: absolute;
          inset: 0;
          display: block;
          width: 100%;
          height: 100%;
        }

        .stack {
          position: relative;
          width: 100%;
          height: 100%;
        }
      </style>
      <div class="stack"></div>
    `;
    this.shadowRoot.querySelector(".stack").append(this.gridCanvas, this.plotCanvas);
    this.series = [];
    this.lastLayoutKey = "";
    this.lastDataKey = "";
    this.resizeObserver = new ResizeObserver(() => this.render());
  }

  connectedCallback() {
    this.resizeObserver.observe(this);
    this.render();
  }

  disconnectedCallback() {
    this.resizeObserver.disconnect();
  }

  set data(value) {
    this.series = Array.isArray(value) ? value : [];
    this.render();
  }

  getSeriesKey(entry) {
    return defaultSeriesKey(entry);
  }

  isSeriesPersistent(_entry) {
    return false;
  }

  getSeriesConfig(entry) {
    const xMin = Number.isFinite(entry.xMin)
      ? entry.xMin
      : (entry.includeX === true ? entry.xMin : 0);
    const xMax = Number.isFinite(entry.xMax)
      ? entry.xMax
      : (entry.includeX === true ? entry.xMax : Math.max(1, entry.points.length - 1));
    return {
      key: this.getSeriesKey(entry),
      includeX: entry.includeX === true,
      xMin,
      xMax,
      yMin: entry.yMin,
      yMax: entry.yMax,
      persistent: this.isSeriesPersistent(entry)
    };
  }

  renderSeries(_ctx, _layout, _entry, _seriesIndex, _startIndex) {
    throw new Error("renderSeries must be implemented");
  }

  shouldClearPlotOnUpdate(_entry) {
    return true;
  }

  render() {
    const width = Math.max(320, this.clientWidth || 640);
    const height = Math.max(240, this.clientHeight || 360);
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    const scaleX = pixelWidth / width;
    const scaleY = pixelHeight / height;
    const layout = {
      width,
      height,
      pixelWidth,
      pixelHeight,
      scaleX,
      scaleY,
      left: 48,
      top: 20,
      plotWidth: width - 66,
      plotHeight: height - 48
    };
    const layoutKey = `${width}:${height}:${pixelWidth}:${pixelHeight}`;
    const dataKey = JSON.stringify(this.series.map((entry) => this.getSeriesConfig(entry)));
    const requiresFullRedraw = layoutKey !== this.lastLayoutKey || dataKey !== this.lastDataKey;

    [this.gridCanvas, this.plotCanvas].forEach((canvas) => {
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
    });

    const grid = this.gridCanvas.getContext("2d");
    grid.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    if (requiresFullRedraw) {
      this.drawGrid(grid, layout);
    }

    const plot = this.plotCanvas.getContext("2d");
    plot.setTransform(scaleX, 0, 0, scaleY, 0, 0);

    if (requiresFullRedraw) {
      plot.clearRect(0, 0, width, height);
      this.series.forEach((entry, seriesIndex) => this.drawSeries(plot, layout, entry, seriesIndex, 0));
    } else {
      if (this.series.some((entry) => this.shouldClearPlotOnUpdate(entry))) {
        plot.clearRect(0, 0, width, height);
      }
      this.series.forEach((entry, seriesIndex) => this.drawSeries(plot, layout, entry, seriesIndex, 0));
    }

    this.lastLayoutKey = layoutKey;
    this.lastDataKey = dataKey;
  }

  drawGrid(ctx, layout) {
    const { width, height, left, top, plotWidth, plotHeight } = layout;
    const primarySeries = this.series[0];
    const xMin = primarySeries
      ? (Number.isFinite(primarySeries.xMin) ? primarySeries.xMin : (primarySeries.includeX === true ? primarySeries.xMin : 0))
      : 0;
    const xMax = primarySeries
      ? (Number.isFinite(primarySeries.xMax) ? primarySeries.xMax : (primarySeries.includeX === true ? primarySeries.xMax : Math.max(1, primarySeries.points.length - 1)))
      : 1;
    const yMin = primarySeries ? primarySeries.yMin : 0;
    const yMax = primarySeries ? primarySeries.yMax : 1;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(255, 255, 255, 0.02)";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = top + (plotHeight * i) / 4;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + plotWidth, y);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left, top + plotHeight);
    ctx.lineTo(left + plotWidth, top + plotHeight);
    ctx.stroke();

    ctx.fillStyle = "rgba(226, 232, 240, 0.85)";
    ctx.font = '12px "Iosevka Aile", "IBM Plex Sans", sans-serif';
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";

    for (let i = 0; i <= 4; i += 1) {
      const y = top + (plotHeight * i) / 4;
      const value = yMax - ((yMax - yMin) * i) / 4;
      ctx.fillText(formatTick(value), left - 8, y);
    }

    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    for (let i = 0; i <= 4; i += 1) {
      const x = left + (plotWidth * i) / 4;
      const value = xMin + ((xMax - xMin) * i) / 4;
      ctx.fillText(formatTick(value), x, top + plotHeight + 8);
    }
  }

  drawSeries(ctx, layout, entry, seriesIndex, startIndex) {
    if (!entry.points.length || startIndex >= entry.points.length) {
      return;
    }

    this.renderSeries(ctx, layout, entry, seriesIndex, startIndex, COLORS[seriesIndex % COLORS.length]);
  }
}
